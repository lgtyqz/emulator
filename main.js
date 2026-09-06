'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { detectSystem, getSystem, normalizeSystem } = require('./src/systems');

const APP_SCHEME = 'rom-room';
const RESOURCE_SCHEME = 'emu-rom';
const rendererRoot = path.join(__dirname, 'src');
const resources = new Map();
const allowedPlayerPermissions = new Set(['fullscreen', 'pointerLock', 'keyboardLock', 'screen-wake-lock']);
let library = [];
let mainWindow = null;

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
  await fs.writeFile(libraryPath(), JSON.stringify({ version: 1, games: library }, null, 2), 'utf8');
}

async function loadLibrary() {
  try {
    const contents = await fs.readFile(libraryPath(), 'utf8');
    const saved = JSON.parse(contents);
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

function setupIpc() {
  ipcMain.handle('library:list', () => library.map(publicGame));
  ipcMain.handle('file:pick', (_event, kind) => pickFile(kind === 'bios' ? 'bios' : 'rom'));
  ipcMain.handle('file:register', (_event, filePath, kind) => registerFile(filePath, kind === 'bios' ? 'bios' : 'rom'));

  ipcMain.handle('game:launch', async (_event, id, requestedSystem, biosId) => {
    const game = library.find((entry) => entry.id === id);
    if (!game || !resources.has(id)) throw new Error('That ROM is no longer available.');

    const system = normalizeSystem(requestedSystem || game.system);
    if (!system || !getSystem(system)) throw new Error('Choose a supported console before launching.');

    game.system = system;
    game.lastPlayed = new Date().toISOString();
    library = [game, ...library.filter((entry) => entry.id !== id)];
    await saveLibrary();

    const biosPath = biosId ? resources.get(biosId) : null;
    return {
      ...publicGame(game),
      gameId: numericGameId(game.id),
      romUrl: resourceUrl(game.id, game.name),
      biosUrl: biosPath ? resourceUrl(biosId, path.basename(biosPath)) : ''
    };
  });

  ipcMain.handle('game:remove', async (_event, id) => {
    const before = library.length;
    library = library.filter((entry) => entry.id !== id);
    resources.delete(id);
    if (library.length !== before) await saveLibrary();
    return library.map(publicGame);
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
    if (new URL(request.url).host === 'player') {
      headers.set('cross-origin-resource-policy', 'cross-origin');
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
  });
}

app.whenReady().then(async () => {
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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
