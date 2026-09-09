'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { io } = require('socket.io-client');
const { createNetplayServer } = require('../src/netplay-server');

function waitFor(socket, eventName) {
  return new Promise((resolve) => socket.once(eventName, resolve));
}

async function waitUntil(predicate, timeout = 1000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for server cleanup.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function emitAck(socket, eventName, payload) {
  return new Promise((resolve) => socket.emit(eventName, payload, (...args) => resolve(args)));
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      rejectUnauthorized: false,
      extraHeaders: { Origin: 'rom-room://player' }
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(urlPath, {
      rejectUnauthorized: false,
      headers: { Origin: 'rom-room://player' }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}

function player(sessionid, userid, player_name, overrides = {}) {
  return {
    sessionid,
    userid,
    player_name,
    room_name: 'Couch co-op',
    domain: 'player',
    game_id: '12345',
    ...overrides
  };
}

test('implements room discovery, passwords, capacity, forwarding, chat, and ownership cleanup', async (context) => {
  const server = createNetplayServer({ logger: { warn() {} } });
  const address = await server.start();
  const url = `https://127.0.0.1:${address.port}`;
  const sockets = [];
  context.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.stop();
  });

  const owner = await connect(url);
  const guest = await connect(url);
  const third = await connect(url);
  sockets.push(owner, guest, third);

  assert.deepEqual(await emitAck(owner, 'open-room', {
    extra: player('room-1', 'owner', 'Host', { custom: 'preserved' }),
    password: 'secret',
    maxPlayers: 2
  }), [null]);
  assert.equal(server.roomCount, 1);
  assert.deepEqual(await emitAck(third, 'open-room', {
    extra: player('room-1', 'other-owner', 'Other')
  }), ['Room already exists']);

  const listed = await getJson(`${url}/list?domain=player&game_id=12345`);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.value['room-1'], {
    room_name: 'Couch co-op',
    current: 1,
    max: 2,
    player_name: 'Host',
    hasPassword: true,
    gameId: '12345'
  });
  assert.deepEqual((await getJson(`${url}/list?domain=other&game_id=12345`)).value, {});

  assert.deepEqual(await emitAck(guest, 'join-room', {
    extra: player('room-1', 'guest', 'Guest'),
    password: 'wrong'
  }), ['Incorrect password']);
  const joined = await emitAck(guest, 'join-room', {
    extra: player('room-1', 'guest', 'Guest'),
    password: 'secret'
  });
  assert.equal(joined[0], null);
  assert.equal(joined[1].owner.custom, 'preserved');
  assert.deepEqual(await emitAck(third, 'join-room', {
    extra: player('room-1', 'third', 'Third'),
    password: 'secret'
  }), ['Room full']);
  assert.deepEqual((await getJson(`${url}/list?domain=player&game_id=12345`)).value, {});

  const inputReceived = waitFor(guest, 'input');
  owner.emit('input', { buttons: [1, 0, 1] });
  assert.deepEqual(await inputReceived, { buttons: [1, 0, 1] });

  const signalReceived = waitFor(guest, 'webrtc-signal');
  owner.emit('webrtc-signal', { target: guest.id, offer: { type: 'offer', sdp: 'bounded-test' } });
  assert.deepEqual(await signalReceived, {
    sender: owner.id,
    offer: { type: 'offer', sdp: 'bounded-test' }
  });

  const chatReceived = waitFor(guest, 'chat-message');
  assert.deepEqual(await emitAck(owner, 'chat-message', { message: 'hello room' }), [{ ok: true }]);
  assert.equal((await chatReceived).message, 'hello room');
  assert.deepEqual(await emitAck(owner, 'chat-message', { message: 'too fast' }), [{ ok: false, error: 'Slow down' }]);

  const usersUpdated = waitFor(guest, 'users-updated');
  owner.disconnect();
  const remaining = await usersUpdated;
  assert.deepEqual(Object.keys(remaining), ['guest']);
  assert.equal(server.roomCount, 1);

  guest.disconnect();
  await waitUntil(() => server.roomCount === 0);
  assert.equal(server.roomCount, 0);
});

test('server shutdown disconnects clients and clears rooms', async () => {
  const server = createNetplayServer({ logger: { warn() {} } });
  const address = await server.start();
  const socket = await connect(`https://127.0.0.1:${address.port}`);
  await emitAck(socket, 'open-room', { extra: player('room-2', 'owner', 'Host') });
  const disconnected = waitFor(socket, 'disconnect');
  await server.stop();
  await disconnected;
  assert.equal(server.roomCount, 0);
});
