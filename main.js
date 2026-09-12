'use strict';

const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { detectSystem, getSystem, normalizeSystem } = require('./src/systems');
const { createNetplayServer } = require('./src/netplay-server');
const { createTunnelManager } = require('./src/netplay-tunnel');
const {
  HASH_PATTERN,
  ensureGameHash: ensureStoredGameHash,
  findMatchingGame
} = require('./src/netplay-library');
const {
  certificateFingerprintFromData,
  certificateMatches,
  decodeInvite,
  encodeInvite,
  invitationCodeFromInput,
  inviteLink,
  netplayGameId,
  normalizeFingerprint,
  playerCsp
} = require('./src/netplay-shared');

const APP_SCHEME = 'rom-room';
const RESOURCE_SCHEME = 'emu-rom';
const rendererRoot = path.join(__dirname, 'src');
const resources = new Map();
const playerSessions = new Map();
const pendingInvites = new Map();
const trustedNetplayCertificates = new Map();
const allowedPlayerPermissions = new Set(['fullscreen', 'pointerLock', 'keyboardLock', 'screen-wake-lock']);
const INTERNET_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.nextcloud.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
];
let library = [];
let libraryVersion = 2;
let mainWindow = null;
let activeNetplay = null;
let pendingDeepLink = null;
let isQuitting = false;

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true
    }
  },
  {
    scheme: RESOURCE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

function randomToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function isTrustedRendererEvent(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  return senderUrl.startsWith(`${APP_SCHEME}://bundle/`);
}

function trustedHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedRendererEvent(event)) throw new Error('Untrusted application request.');
    return handler(event, ...args);
  });
}

function emitNetplayStatus(state, detail = '') {
  const status = {
    state,
    detail,
    role: activeNetplay?.role || null,
    reach: activeNetplay?.reach || null
  };
  if (activeNetplay) activeNetplay.status = status;
  mainWindow?.webContents.send('netplay:status', status);
  return status;
}

function queueDeepLink(value) {
  try {
    const code = invitationCodeFromInput(value);
    pendingDeepLink = code;
    if (mainWindow && !mainWindow.webContents.isLoadingMainFrame()) {
      mainWindow.webContents.send('netplay:invite', code);
      pendingDeepLink = null;
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  } catch (error) {
    console.warn('Ignored invalid NetPlay invitation link:', error.message);
  }
}

function invitationFromArguments(argv) {
  return argv.find((argument) => typeof argument === 'string' && argument.startsWith('rom-room://join')) || null;
}

if (hasInstanceLock) {
  app.on('second-instance', (_event, argv) => {
    const invitation = invitationFromArguments(argv);
    if (invitation) queueDeepLink(invitation);
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    queueDeepLink(url);
  });
}

function addTrustedCertificate(hostname, fingerprint) {
  const normalized = normalizeFingerprint(fingerprint);
  if (!hostname || !normalized) return;
  if (!trustedNetplayCertificates.has(hostname)) trustedNetplayCertificates.set(hostname, new Set());
  trustedNetplayCertificates.get(hostname).add(normalized);
}

function certificateIsTrusted(hostname, certificate) {
  const trusted = trustedNetplayCertificates.get(hostname);
  const fingerprint = certificateFingerprintFromData(certificate?.data);
  return Boolean(trusted && fingerprint
    && [...trusted].some((expected) => certificateMatches(expected, fingerprint)));
}

function localIpv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && !addresses.includes(entry.address)) addresses.push(entry.address);
    }
  }
  return addresses;
}

function cloudflaredPath() {
  const executable = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  if (app.isPackaged) return path.join(process.resourcesPath, 'cloudflared', executable);
  return path.join(__dirname, '.cache', 'cloudflared', `${process.platform}-${process.arch}`, executable);
}

async function ensureGameHash(game) {
  return ensureStoredGameHash(game, async (version) => {
    libraryVersion = version;
    await saveLibrary();
  });
}

function inviteEndpoint(payload, label) {
  const code = encodeInvite(payload);
  return {
    connection: payload.connection,
    label,
    serverUrl: payload.serverUrl,
    code,
    link: inviteLink(code)
  };
}

function publicNetplaySession(value = activeNetplay) {
  if (!value) return null;
  return {
    id: value.id,
    role: value.role,
    reach: value.reach,
    game: publicGame(value.game),
    core: value.core,
    status: value.status,
    endpoints: value.endpoints || []
  };
}

function libraryPath() {
  return path.join(app.getPath('userData'), 'library.json');
}

function idForPath(filePath) {
  return crypto.createHash('sha256').update(path.resolve(filePath)).digest('hex').slice(0, 24);
}

function numericGameId(id) {
  return Number.parseInt(id.slice(0, 8), 16) || 1;
}

function resourceUrl(id, fileName) {
  return `${RESOURCE_SCHEME}://game/${id}/${encodeURIComponent(fileName)}`;
}

function isTrustedAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === `${APP_SCHEME}:` && (url.host === 'bundle' || url.host === 'player');
  } catch {
    return false;
  }
}

function publicGame(game) {
  return {
    id: game.id,
    name: game.name,
    extension: game.extension,
    size: game.size,
    system: game.system,
    lastPlayed: game.lastPlayed || null
  };
}

async function saveLibrary() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(libraryPath(), JSON.stringify({ version: libraryVersion, games: library }, null, 2), 'utf8');
}

async function loadLibrary() {
  try {
    const contents = await fs.readFile(libraryPath(), 'utf8');
    const saved = JSON.parse(contents);
    libraryVersion = saved.version === 2 ? 2 : 1;
    const games = Array.isArray(saved.games) ? saved.games : [];
    const available = [];

    for (const game of games) {
      try {
        const stats = await fs.stat(game.path);
        if (!stats.isFile()) continue;

        const normalized = {
          id: idForPath(game.path),
          path: path.resolve(game.path),
          name: path.basename(game.path),
          extension: path.extname(game.path).slice(1).toLowerCase(),
          size: stats.size,
          system: normalizeSystem(game.system) || detectSystem(game.path),
          contentHash: HASH_PATTERN.test(game.contentHash || '') ? game.contentHash : null,
          lastPlayed: game.lastPlayed || null
        };
        resources.set(normalized.id, normalized.path);
        available.push(normalized);
      } catch {
        // Missing files quietly disappear from recents.
      }
    }

    library = available.slice(0, 40);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not load library:', error);
    library = [];
    libraryVersion = 2;
  }
}

async function registerFile(filePath, kind = 'rom') {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('The selected file path is invalid.');
  }

  const resolvedPath = path.resolve(filePath);
  const stats = await fs.stat(resolvedPath);
  if (!stats.isFile()) throw new Error('Please choose a file, not a folder.');

  const id = idForPath(resolvedPath);
  resources.set(id, resolvedPath);

  if (kind === 'bios') {
    return {
      id,
      name: path.basename(resolvedPath),
      size: stats.size
    };
  }

  const existing = library.find((game) => game.id === id);
  const game = {
    id,
    path: resolvedPath,
    name: path.basename(resolvedPath),
    extension: path.extname(resolvedPath).slice(1).toLowerCase(),
    size: stats.size,
    system: existing?.system || detectSystem(resolvedPath),
    contentHash: existing?.contentHash || null,
    lastPlayed: existing?.lastPlayed || null
  };

  library = [game, ...library.filter((entry) => entry.id !== id)].slice(0, 40);
  await saveLibrary();
  return publicGame(game);
}

function fileFilters(kind) {
  if (kind === 'bios') {
    return [
      { name: 'BIOS and firmware', extensions: ['bin', 'rom', 'bios', 'zip', '7z'] },
      { name: 'All files', extensions: ['*'] }
    ];
  }

  return [
    {
      name: 'Game ROMs',
      extensions: [
        'nes', 'fds', 'unf', 'unif', 'smc', 'sfc', 'fig', 'swc', 'bsx',
        'gb', 'gbc', 'gba', 'n64', 'z64', 'v64', 'nds', '3ds', 'cci', 'cia',
        'cxi', 'app', 'md', 'gen', 'smd',
        'sg', 'sms', 'gg', '32x', 'a26', 'a52',
        'a78', 'lnx', 'j64', 'jag', 'vb', 'vboy', 'col', 'cv', 'pce', 'ngp',
        'ngc', 'ws', 'wsc', 'd64', 't64', 'prg', 'adf', 'adz', 'dms', 'zip',
        '7z', 'cue', 'iso', 'chd', 'pbp', 'cso', 'bin', 'exe'
      ]
    },
    { name: 'All files', extensions: ['*'] }
  ];
}

async function pickFile(kind = 'rom') {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: kind === 'bios' ? 'Choose a BIOS file' : 'Choose a game ROM',
    properties: ['openFile'],
    filters: fileFilters(kind)
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return registerFile(result.filePaths[0], kind);
}

async function stopNetplayInternal() {
  const previous = activeNetplay;
  if (!previous) return null;
  emitNetplayStatus('stopping', 'Closing NetPlay session…');
  activeNetplay = null;
  playerSessions.clear();
  if (previous.tunnel) await previous.tunnel.stop().catch((error) => console.warn('Could not stop tunnel:', error));
  if (previous.tunnelConfigPath) await fs.rm(previous.tunnelConfigPath, { force: true }).catch(() => {});
  if (previous.server) await previous.server.stop().catch((error) => console.warn('Could not stop NetPlay server:', error));
  for (const trusted of previous.trustedCertificates || []) {
    const fingerprints = trustedNetplayCertificates.get(trusted.hostname);
    fingerprints?.delete(trusted.fingerprint);
    if (fingerprints?.size === 0) trustedNetplayCertificates.delete(trusted.hostname);
  }
  return emitNetplayStatus('stopped', 'NetPlay session closed.');
}

async function hostNetplay(gameId, reach) {
  if (reach !== 'lan' && reach !== 'internet') throw new Error('Choose LAN or internet hosting.');
  const game = library.find((entry) => entry.id === gameId);
  if (!game || !resources.has(gameId)) throw new Error('Launch a local game before hosting NetPlay.');
  const core = normalizeSystem(game.system);
  if (!core) throw new Error('Choose the game console before hosting NetPlay.');

  await stopNetplayInternal();
  emitNetplayStatus('hashing', 'Verifying the local ROM…');
  const gameHash = await ensureGameHash(game);
  const ejsGameId = netplayGameId(gameHash);
  emitNetplayStatus('server-starting', 'Starting the local NetPlay server…');

  const server = createNetplayServer();
  const address = await server.start();
  const port = address.port;
  const fingerprint = normalizeFingerprint(new crypto.X509Certificate(server.credentials.cert).fingerprint256);
  const trustedCertificates = [];
  const trustHost = (hostname) => {
    addTrustedCertificate(hostname, fingerprint);
    trustedCertificates.push({ hostname, fingerprint });
  };
  trustHost('127.0.0.1');
  trustHost('localhost');

  const localAddresses = localIpv4Addresses();
  if (reach === 'lan' && localAddresses.length === 0) {
    await server.stop();
    throw new Error('No active local network address is available for LAN hosting.');
  }
  for (const addressValue of localAddresses) trustHost(addressValue);
  const localServerUrl = `https://127.0.0.1:${port}`;
  const baseInvite = {
    v: 1,
    gameHash,
    gameId: ejsGameId,
    core,
    gameName: game.name
  };
  const endpoints = localAddresses.map((addressValue) => inviteEndpoint({
    ...baseInvite,
    connection: 'lan',
    serverUrl: `https://${addressValue}:${port}`,
    certificateFingerprint: fingerprint
  }, `Same network · ${addressValue}`));

  const id = randomToken();
  activeNetplay = {
    id,
    role: 'host',
    reach,
    game,
    core,
    gameHash,
    ejsGameId,
    netplayServer: localServerUrl,
    iceServers: reach === 'internet' ? INTERNET_ICE_SERVERS : [],
    endpoints,
    server,
    tunnel: null,
    tunnelConfigPath: '',
    trustedCertificates,
    status: null
  };

  if (reach === 'internet') {
    emitNetplayStatus('tunnel-starting', 'Starting Cloudflare Quick Tunnel…');
    const tunnelConfigPath = path.join(app.getPath('temp'), `rom-room-cloudflared-${id}.yml`);
    try {
      await fs.writeFile(tunnelConfigPath, '# Isolated ROM Room Quick Tunnel configuration.\n', { mode: 0o600 });
    } catch (error) {
      await stopNetplayInternal();
      throw new Error(`Could not prepare the internet tunnel: ${error.message}`);
    }
    activeNetplay.tunnelConfigPath = tunnelConfigPath;
    const tunnel = createTunnelManager({
      binaryPath: cloudflaredPath(),
      configPath: tunnelConfigPath,
      onStatus(status) {
        if (activeNetplay?.id !== id) return;
        if (status.state === 'disconnected') {
          activeNetplay.endpoints = activeNetplay.endpoints.filter((endpoint) => endpoint.connection !== 'internet');
        }
        emitNetplayStatus(`tunnel-${status.state}`, status.detail);
      }
    });
    activeNetplay.tunnel = tunnel;
    try {
      const publicUrl = await tunnel.start(localServerUrl);
      activeNetplay.endpoints.unshift(inviteEndpoint({
        ...baseInvite,
        connection: 'internet',
        serverUrl: publicUrl
      }, 'Internet · Cloudflare Quick Tunnel'));
    } catch (error) {
      emitNetplayStatus('tunnel-error', `${error.message} LAN sharing is still available.`);
      if (activeNetplay.endpoints.length === 0) {
        await stopNetplayInternal();
        throw new Error(`${error.message} No LAN address is available as a fallback.`);
      }
    }
  }

  emitNetplayStatus('ready', reach === 'internet' && activeNetplay.endpoints.some((endpoint) => endpoint.connection === 'internet')
    ? 'Internet and LAN invitations are ready.'
    : 'LAN invitation is ready.');
  return publicNetplaySession();
}

async function resolveNetplayInvite(input) {
  const invite = decodeInvite(input);
  const core = normalizeSystem(invite.core);
  if (!core) throw new Error('The invitation requests an unsupported emulator core.');
  invite.core = core;

  const matched = await findMatchingGame(library, invite.gameHash, invite.gameName, ensureGameHash);

  const inviteId = randomToken();
  pendingInvites.clear();
  pendingInvites.set(inviteId, invite);
  return {
    inviteId,
    gameName: invite.gameName,
    core: invite.core,
    connection: invite.connection,
    serverHost: new URL(invite.serverUrl).host,
    matchedGame: matched ? publicGame(matched) : null
  };
}

async function joinNetplay(inviteId, gameId) {
  const invite = pendingInvites.get(inviteId);
  if (!invite) throw new Error('That NetPlay invitation has expired. Paste it again.');
  const game = library.find((entry) => entry.id === gameId);
  if (!game || !resources.has(gameId)) throw new Error('Choose your local copy of the invited game.');

  emitNetplayStatus('hashing', 'Checking that the ROM matches the invitation…');
  const gameHash = await ensureGameHash(game);
  if (gameHash !== invite.gameHash) {
    throw new Error('That ROM does not exactly match the host’s game. Choose another local copy.');
  }

  await stopNetplayInternal();
  const trustedCertificates = [];
  if (invite.connection === 'lan') {
    const hostname = new URL(invite.serverUrl).hostname;
    addTrustedCertificate(hostname, invite.certificateFingerprint);
    trustedCertificates.push({ hostname, fingerprint: invite.certificateFingerprint });
  }

  const id = randomToken();
  activeNetplay = {
    id,
    role: 'guest',
    reach: invite.connection,
    game,
    core: invite.core,
    gameHash,
    ejsGameId: invite.gameId,
    netplayServer: invite.serverUrl,
    iceServers: invite.connection === 'internet' ? INTERNET_ICE_SERVERS : [],
    endpoints: [],
    server: null,
    tunnel: null,
    trustedCertificates,
    status: null
  };
  pendingInvites.delete(inviteId);
  emitNetplayStatus('ready', 'Invitation verified. Open the globe menu after the game starts.');
  return publicNetplaySession();
}

function setupIpc() {
  trustedHandle('library:list', () => library.map(publicGame));
  trustedHandle('file:pick', (_event, kind) => pickFile(kind === 'bios' ? 'bios' : 'rom'));
  trustedHandle('file:register', (_event, filePath, kind) => registerFile(filePath, kind === 'bios' ? 'bios' : 'rom'));

  trustedHandle('game:launch', async (_event, id, requestedSystem, biosId, netplaySessionId) => {
    const game = library.find((entry) => entry.id === id);
    if (!game || !resources.has(id)) throw new Error('That ROM is no longer available.');

    let netplayConfig = null;
    if (netplaySessionId) {
      if (!activeNetplay || activeNetplay.id !== netplaySessionId || activeNetplay.game.id !== id) {
        throw new Error('That NetPlay launch is no longer active.');
      }
      netplayConfig = activeNetplay;
    } else if (activeNetplay) {
      await stopNetplayInternal();
    }

    const system = normalizeSystem(netplayConfig?.core || requestedSystem || game.system);
    if (!system || !getSystem(system)) throw new Error('Choose a supported console before launching.');
    if (netplayConfig && system !== netplayConfig.core) throw new Error('The NetPlay invitation requires a different emulator core.');

    game.system = system;
    game.lastPlayed = new Date().toISOString();
    library = [game, ...library.filter((entry) => entry.id !== id)];
    await saveLibrary();

    const biosPath = biosId ? resources.get(biosId) : null;
    playerSessions.clear();
    const playerSessionId = randomToken();
    playerSessions.set(playerSessionId, {
      core: system,
      romUrl: resourceUrl(game.id, game.name),
      biosUrl: biosPath ? resourceUrl(biosId, path.basename(biosPath)) : '',
      gameName: path.basename(game.name, path.extname(game.name)),
      gameId: netplayConfig?.ejsGameId || numericGameId(game.id),
      dataPath: netplayConfig
        ? 'https://cdn.emulatorjs.org/4.3.0-pre/data/'
        : 'https://cdn.emulatorjs.org/4.2.3/data/',
      netplayServer: netplayConfig?.netplayServer || '',
      iceServers: netplayConfig?.iceServers || []
    });
    return {
      ...publicGame(game),
      playerSessionId,
      netplay: Boolean(netplayConfig)
    };
  });

  trustedHandle('game:remove', async (_event, id) => {
    if (activeNetplay?.game.id === id) await stopNetplayInternal();
    const before = library.length;
    library = library.filter((entry) => entry.id !== id);
    resources.delete(id);
    if (library.length !== before) await saveLibrary();
    return library.map(publicGame);
  });

  trustedHandle('netplay:host', (_event, gameId, reach) => hostNetplay(gameId, reach));
  trustedHandle('netplay:resolve-invite', (_event, input) => resolveNetplayInvite(input));
  trustedHandle('netplay:join', (_event, inviteId, gameId) => joinNetplay(inviteId, gameId));
  trustedHandle('netplay:stop', () => stopNetplayInternal());
  trustedHandle('netplay:state', () => publicNetplaySession());
  trustedHandle('clipboard:write', (_event, value) => {
    if (typeof value !== 'string' || value.length > 10000) throw new Error('Cannot copy that value.');
    clipboard.writeText(value);
  });
}

function safeRendererPath(requestUrl) {
  const url = new URL(requestUrl);
  if (url.host !== 'bundle' && url.host !== 'player') return null;

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (url.host === 'player' && !['player.html', 'player.js', 'player.css'].includes(requested)) {
    return null;
  }
  const resolved = path.resolve(rendererRoot, requested);
  const relative = path.relative(rendererRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

async function registerProtocols() {
  protocol.handle(APP_SCHEME, async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host === 'player' && requestUrl.pathname.startsWith('/session/')) {
      const sessionId = (requestUrl.pathname.split('/').filter(Boolean)[1] || '').replace(/\.json$/, '');
      const config = playerSessions.get(sessionId);
      if (!config || request.method !== 'GET') return new Response('Not found', { status: 404 });
      return Response.json(config, {
        headers: {
          'cache-control': 'no-store',
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'credentialless'
        }
      });
    }

    const filePath = safeRendererPath(request.url);
    if (!filePath) return new Response('Not found', { status: 404 });

    const fileResponse = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(fileResponse.headers);
    headers.set('cross-origin-opener-policy', 'same-origin');
    headers.set('cross-origin-embedder-policy', 'credentialless');
    headers.set(
      'permissions-policy',
      'cross-origin-isolated=(self "rom-room://player"), screen-wake-lock=(self "rom-room://player")'
    );
    if (requestUrl.host === 'player') {
      headers.set('cross-origin-resource-policy', 'cross-origin');
      if (requestUrl.pathname === '/player.html') {
        const sessionId = requestUrl.searchParams.get('session') || '';
        const config = playerSessions.get(sessionId);
        if (!config) return new Response('Player session expired', { status: 404 });
        headers.set('content-security-policy', playerCsp(config.netplayServer));
      }
    }
    return new Response(fileResponse.body, {
      status: fileResponse.status,
      statusText: fileResponse.statusText,
      headers
    });
  });

  protocol.handle(RESOURCE_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'game') return new Response('Not found', { status: 404 });

    const id = url.pathname.split('/').filter(Boolean)[0];
    const filePath = resources.get(id);
    if (!filePath) return new Response('Resource unavailable', { status: 404 });

    try {
      const fileResponse = await net.fetch(pathToFileURL(filePath).toString(), {
        method: request.method,
        headers: request.headers
      });
      const headers = new Headers(fileResponse.headers);
      headers.set('access-control-allow-origin', '*');
      headers.set('cache-control', 'no-store');
      headers.set('content-type', 'application/octet-stream');
      return new Response(fileResponse.body, {
        status: fileResponse.status,
        statusText: fileResponse.statusText,
        headers
      });
    } catch (error) {
      console.error('Could not stream resource:', error);
      return new Response('Resource unavailable', { status: 404 });
    }
  });
}

function createMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open ROM…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-rom')
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        ...(process.argv.includes('--dev')
          ? [{ type: 'separator' }, { role: 'toggleDevTools' }, { role: 'reload' }]
          : [])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#090a0d',
    title: 'ROM Room',
    show: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.loadURL(`${APP_SCHEME}://bundle/index.html`).catch((error) => {
    console.error('Could not load the app window:', error);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      mainWindow?.webContents.send('netplay:invite', pendingDeepLink);
      pendingDeepLink = null;
    }
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedUrl) => {
    console.error(`Page load failed (${code}): ${description} — ${validatedUrl}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process exited:', details.reason);
  });
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const smokeResult = await mainWindow.webContents.executeJavaScript(`JSON.stringify({
          ready: document.readyState,
          title: document.title,
          library: document.querySelector('#libraryCount')?.textContent,
          idle: !document.querySelector('#idleState')?.hidden,
          systems: document.querySelector('#systemSelect')?.options.length,
          isolated: crossOriginIsolated,
          viewport: [document.body.clientWidth, document.body.clientHeight]
        })`);
        console.log(`Renderer smoke check: ${smokeResult}`);
      } catch (error) {
        console.error('Renderer smoke check failed:', error);
      }
    });
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!navigationUrl.startsWith(`${APP_SCHEME}://bundle/`)) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    stopNetplayInternal().catch((error) => console.warn('Could not close NetPlay with the window:', error));
  });
}

app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(APP_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(APP_SCHEME);
  }
  await loadLibrary();
  await registerProtocols();
  setupIpc();
  createMenu();

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || webContents.getURL();
    callback(allowedPlayerPermissions.has(permission) && isTrustedAppUrl(requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const trustedOrigin = isTrustedAppUrl(requestingOrigin) || isTrustedAppUrl(details?.embeddingOrigin);
    return allowedPlayerPermissions.has(permission) && trustedOrigin;
  });
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(certificateIsTrusted(request.hostname, request.certificate) ? 0 : -3);
  });
  createWindow();
  const initialInvitation = invitationFromArguments(process.argv);
  if (initialInvitation) queueDeepLink(initialInvitation);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('before-quit', (event) => {
  if (isQuitting || !activeNetplay) return;
  event.preventDefault();
  isQuitting = true;
  stopNetplayInternal().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
