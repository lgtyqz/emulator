'use strict';

const https = require('node:https');
const selfsigned = require('selfsigned');
const { Server } = require('socket.io');

const APP_ORIGINS = new Set(['rom-room://player', 'null']);
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_CHAT_LENGTH = 300;

function safeString(value, maxLength, fallback = '') {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength) || fallback;
}

function normalizePassword(value) {
  const password = safeString(value, 20);
  return !password || password.toLowerCase() === 'none' ? null : password;
}

function payloadFits(value, limit = MAX_MESSAGE_BYTES) {
  try {
    return Buffer.byteLength(JSON.stringify(value)) <= limit;
  } catch {
    return false;
  }
}

function generateCertificate() {
  return selfsigned.generate(
    [
      { name: 'commonName', value: 'ROM Room NetPlay' },
      { name: 'organizationName', value: 'ROM Room' }
    ],
    {
      algorithm: 'sha256',
      days: 7,
      keySize: 2048,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' }
          ]
        }
      ]
    }
  );
}

function createNetplayServer(options = {}) {
  const logger = options.logger || console;
  const rooms = new Map();
  const socketIndex = new Map();
  const credentials = options.credentials || generateCertificate();
  let httpServer = null;
  let io = null;
  let cleanupTimer = null;
  let listenAddress = null;

  function roomSocketIds(room) {
    return [...room.players.values()].map((player) => player.socketId).filter(Boolean);
  }

  function publicPlayers(room) {
    return Object.fromEntries([...room.players].map(([id, player]) => [id, { ...player }]));
  }

  function broadcastPlayers(room) {
    if (!io) return;
    io.to(room.id).emit('users-updated', publicPlayers(room));
  }

  function removeSocket(socket) {
    const indexed = socketIndex.get(socket.id);
    if (!indexed) return;

    socketIndex.delete(socket.id);
    const room = rooms.get(indexed.roomId);
    if (!room) return;

    room.players.delete(indexed.playerId);
    room.peers = room.peers.filter((peer) => peer.source !== socket.id && peer.target !== socket.id);
    socket.leave(room.id);

    if (room.players.size === 0) {
      rooms.delete(room.id);
      return;
    }

    if (room.owner === socket.id) {
      const nextOwner = room.players.values().next().value;
      room.owner = nextOwner.socketId;
      for (const target of roomSocketIds(room).filter((socketId) => socketId !== room.owner)) {
        io.to(room.owner).emit('webrtc-signal', { target, requestRenegotiate: true });
      }
    }
    broadcastPlayers(room);
  }

  function playerFromExtra(extra, socketId) {
    const sessionId = safeString(extra?.sessionid, 100);
    const playerId = safeString(extra?.userid ?? extra?.playerId, 100);
    if (!sessionId || !playerId) return null;
    let player = {};
    try {
      player = JSON.parse(JSON.stringify(extra));
    } catch {}
    return {
      sessionId,
      playerId,
      player: {
        ...player,
        domain: safeString(extra?.domain, 200, 'unknown'),
        game_id: safeString(extra?.game_id, 32, 'default'),
        room_name: safeString(extra?.room_name, 20, `Room ${sessionId.slice(0, 8)}`),
        player_name: safeString(extra?.player_name, 20, 'Unknown'),
        userid: playerId,
        sessionid: sessionId,
        socketId
      }
    };
  }

  function handleRequest(request, response) {
    const requestUrl = new URL(request.url, 'https://localhost');
    const origin = request.headers.origin;
    if (origin && !APP_ORIGINS.has(origin)) {
      response.statusCode = 403;
      response.end('Forbidden');
      return;
    }
    response.setHeader('access-control-allow-origin', origin || '*');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('content-type', 'application/json; charset=utf-8');

    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/games') {
      response.end('{}');
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/list') {
      const domain = safeString(requestUrl.searchParams.get('domain'), 200);
      const gameId = safeString(requestUrl.searchParams.get('game_id'), 32);
      const result = {};
      if (domain && gameId) {
        for (const room of rooms.values()) {
          if (room.domain !== domain || room.gameId !== gameId || room.players.size >= room.maxPlayers) continue;
          const owner = [...room.players.values()].find((player) => player.socketId === room.owner);
          result[room.id] = {
            room_name: room.name,
            current: room.players.size,
            max: room.maxPlayers,
            player_name: owner?.player_name || 'Unknown',
            hasPassword: Boolean(room.password),
            gameId: room.gameId
          };
        }
      }
      response.end(JSON.stringify(result));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  }

  function installSocketHandlers(socket) {
    socket.on('open-room', (data = {}, callback = () => {}) => {
      try {
        if (!payloadFits(data, 16 * 1024)) return callback('Room data is too large');
        const parsed = playerFromExtra(data.extra, socket.id);
        if (!parsed) return callback('Invalid data: sessionId and playerId required');
        if (rooms.has(parsed.sessionId)) return callback('Room already exists');
        removeSocket(socket);

        const requestedMax = Number(data.maxPlayers);
        const maxPlayers = Number.isInteger(requestedMax) && requestedMax >= 2 && requestedMax <= 4
          ? requestedMax
          : 4;
        const room = {
          id: parsed.sessionId,
          owner: socket.id,
          players: new Map([[parsed.playerId, parsed.player]]),
          peers: [],
          name: parsed.player.room_name,
          domain: parsed.player.domain,
          gameId: parsed.player.game_id,
          password: normalizePassword(data.password),
          maxPlayers
        };
        rooms.set(room.id, room);
        socketIndex.set(socket.id, { roomId: room.id, playerId: parsed.playerId, lastChatAt: 0 });
        socket.join(room.id);
        callback(null);
        broadcastPlayers(room);
      } catch (error) {
        logger.warn?.('Could not open NetPlay room:', error);
        callback('Could not create room');
      }
    });

    socket.on('join-room', (data = {}, callback = () => {}) => {
      try {
        if (!payloadFits(data, 16 * 1024)) return callback('Room data is too large');
        const parsed = playerFromExtra(data.extra, socket.id);
        if (!parsed) return callback('Invalid data: sessionId and playerId required');
        const room = rooms.get(parsed.sessionId);
        if (!room) return callback('Room not found');
        if (room.password && room.password !== normalizePassword(data.password)) return callback('Incorrect password');
        if (room.players.size >= room.maxPlayers) return callback('Room full');
        if (room.players.has(parsed.playerId)) return callback('Player already joined');
        if (parsed.player.domain !== room.domain || parsed.player.game_id !== room.gameId) {
          return callback('Game does not match room');
        }
        removeSocket(socket);

        room.players.set(parsed.playerId, parsed.player);
        socketIndex.set(socket.id, { roomId: room.id, playerId: parsed.playerId, lastChatAt: 0 });
        socket.join(room.id);
        const players = publicPlayers(room);
        callback(null, players);
        broadcastPlayers(room);
      } catch (error) {
        logger.warn?.('Could not join NetPlay room:', error);
        callback('Could not join room');
      }
    });

    socket.on('leave-room', () => removeSocket(socket));
    socket.on('disconnect', () => removeSocket(socket));

    socket.on('chat-message', (data = {}, callback = () => {}) => {
      const indexed = socketIndex.get(socket.id);
      const room = indexed && rooms.get(indexed.roomId);
      if (!indexed || !room) return callback({ ok: false, error: 'Not in a room' });
      const now = Date.now();
      if (now - indexed.lastChatAt < 400) return callback({ ok: false, error: 'Slow down' });
      indexed.lastChatAt = now;

      const message = safeString(typeof data === 'string' ? data : data.message, MAX_CHAT_LENGTH);
      if (!message) return callback({ ok: false, error: 'Empty message' });
      const to = safeString(typeof data === 'object' ? data.to : '', 100, 'all');
      const from = room.players.get(indexed.playerId);
      const payload = {
        ts: now,
        to,
        userid: indexed.playerId,
        player_name: from?.player_name || 'Unknown',
        message
      };

      const targetSocket = room.players.get(to)?.socketId
        || (roomSocketIds(room).includes(to) ? to : '');
      if (to !== 'all' && to !== indexed.playerId && targetSocket) {
        socket.emit('chat-message', payload);
        io.to(targetSocket).emit('chat-message', payload);
      } else {
        io.to(room.id).emit('chat-message', { ...payload, to: 'all' });
      }
      callback({ ok: true });
    });

    socket.on('webrtc-signal', (data = {}) => {
      if (!payloadFits(data, 256 * 1024)) return;
      const indexed = socketIndex.get(socket.id);
      const room = indexed && rooms.get(indexed.roomId);
      const target = safeString(data.target, 100);
      if (!room || !target || !roomSocketIds(room).includes(target)) return;

      if (data.offer && !room.peers.some((peer) => peer.source === socket.id && peer.target === target)) {
        room.peers.push({ source: socket.id, target });
      }
      const payload = { sender: socket.id };
      if (data.requestRenegotiate === true) payload.requestRenegotiate = true;
      if (data.candidate) payload.candidate = data.candidate;
      if (data.offer) payload.offer = data.offer;
      if (data.answer) payload.answer = data.answer;
      io.to(target).emit('webrtc-signal', payload);
    });

    for (const eventName of ['data-message', 'snapshot', 'input']) {
      socket.on(eventName, (data) => {
        if (!payloadFits(data)) return;
        const indexed = socketIndex.get(socket.id);
        if (indexed && rooms.has(indexed.roomId)) socket.to(indexed.roomId).emit(eventName, data);
      });
    }
  }

  async function start() {
    if (httpServer) return listenAddress;
    httpServer = https.createServer({ key: credentials.private, cert: credentials.cert }, handleRequest);
    io = new Server(httpServer, {
      maxHttpBufferSize: MAX_MESSAGE_BYTES,
      cors: {
        origin(origin, callback) {
          callback(null, !origin || APP_ORIGINS.has(origin));
        },
        credentials: false,
        methods: ['GET', 'POST']
      }
    });
    io.on('connection', installSocketHandlers);

    cleanupTimer = setInterval(() => {
      for (const [id, room] of rooms) if (room.players.size === 0) rooms.delete(id);
    }, 60000);
    cleanupTimer.unref();

    try {
      await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(options.port || 0, options.host || '0.0.0.0', () => {
          httpServer.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      await stop();
      throw error;
    }
    listenAddress = httpServer.address();
    return listenAddress;
  }

  async function stop() {
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = null;
    rooms.clear();
    socketIndex.clear();
    const activeIo = io;
    const activeServer = httpServer;
    io = null;
    httpServer = null;
    listenAddress = null;
    if (activeIo) await new Promise((resolve) => activeIo.close(resolve));
    if (activeServer?.listening) await new Promise((resolve) => activeServer.close(resolve));
  }

  return {
    credentials,
    get address() {
      return listenAddress;
    },
    get roomCount() {
      return rooms.size;
    },
    start,
    stop
  };
}

module.exports = {
  APP_ORIGINS,
  MAX_CHAT_LENGTH,
  createNetplayServer,
  generateCertificate,
  normalizePassword,
  payloadFits,
  safeString
};
