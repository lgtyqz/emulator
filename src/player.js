(async function bootPlayer() {
  'use strict';

  const STABLE_DATA_PATH = 'https://cdn.emulatorjs.org/4.2.3/data/';
  const NETPLAY_DATA_PATH = 'https://cdn.emulatorjs.org/4.3.0-pre/data/';
  const allowedCores = new Set([
    'nes', 'snes', 'gb', 'gba', 'n64', 'nds', '3ds', 'segaMD', 'segaMS',
    'segaGG', 'sega32x', 'segaCD', 'segaSaturn', 'psx', 'psp', 'atari2600',
    'a5200', 'atari7800', 'lynx', 'jaguar', 'arcade', 'mame2003', 'c64',
    'amiga', 'dos', '3do', 'vb', 'coleco', 'pce', 'ngp', 'ws'
  ]);

  function notify(type, detail = '') {
    window.parent.postMessage({ source: 'rom-room-player', type, detail }, 'rom-room://bundle');
  }

  function fail(message) {
    notify('error', message || 'The EmulatorJS player could not be loaded.');
  }

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session') || '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(sessionId)) {
    fail('The player session is invalid or has expired.');
    return;
  }

  let config;
  try {
    const response = await fetch(`rom-room://player/session/${sessionId}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Player session unavailable');
    config = await response.json();
  } catch {
    fail('The player session is invalid or has expired.');
    return;
  }

  const core = config.core;
  const romUrl = config.romUrl;
  const biosUrl = config.biosUrl || '';
  const gameName = config.gameName || 'Game';
  const gameId = Number.parseInt(config.gameId, 10) || 1;
  const dataPath = config.dataPath;
  const netplayServer = config.netplayServer || '';
  const iceServers = Array.isArray(config.iceServers) ? config.iceServers : [];

  const gamepadBindings = {
    0: 'BUTTON_2',
    1: 'BUTTON_4',
    2: 'SELECT',
    3: 'START',
    4: 'DPAD_UP',
    5: 'DPAD_DOWN',
    6: 'DPAD_LEFT',
    7: 'DPAD_RIGHT',
    8: 'BUTTON_1',
    9: 'BUTTON_3',
    10: 'LEFT_TOP_SHOULDER',
    11: 'RIGHT_TOP_SHOULDER',
    12: 'LEFT_BOTTOM_SHOULDER',
    13: 'RIGHT_BOTTOM_SHOULDER',
    14: 'LEFT_STICK',
    15: 'RIGHT_STICK',
    16: 'LEFT_STICK_X:+1',
    17: 'LEFT_STICK_X:-1',
    18: 'LEFT_STICK_Y:+1',
    19: 'LEFT_STICK_Y:-1',
    20: 'RIGHT_STICK_X:+1',
    21: 'RIGHT_STICK_X:-1',
    22: 'RIGHT_STICK_Y:+1',
    23: 'RIGHT_STICK_Y:-1'
  };

  function createPlayerControls(keyboardBindings) {
    const controls = {};
    for (const [button, value2] of Object.entries(gamepadBindings)) {
      controls[button] = { value2 };
    }
    for (const [button, value] of Object.entries(keyboardBindings)) {
      controls[button] = { ...controls[button], value };
    }
    return controls;
  }

  const playerOneKeyboard = {
    0: 'x', 1: 's', 2: 'v', 3: 'enter',
    4: 'up arrow', 5: 'down arrow', 6: 'left arrow', 7: 'right arrow',
    8: 'z', 9: 'a', 10: 'q', 11: 'e', 12: 'tab', 13: 'r',
    16: 'h', 17: 'f', 18: 'g', 19: 't',
    20: 'l', 21: 'j', 22: 'k', 23: 'i',
    24: '1', 25: '2', 26: '3'
  };

  // SNES and other digital-pad cores discard P1's analog bindings, leaving
  // these keys available as a comfortable second keyboard layout.
  const playerTwoKeyboard = {
    0: 'f', 1: 'g', 2: 'c', 3: 'b',
    4: 'i', 5: 'k', 6: 'j', 7: 'l',
    8: 'h', 9: 't', 10: 'y', 11: 'u', 12: 'n', 13: 'm'
  };

  if (!allowedCores.has(core) || !romUrl || !romUrl.startsWith('emu-rom://game/')) {
    fail('The player received an invalid game configuration.');
    return;
  }

  if (biosUrl && !biosUrl.startsWith('emu-rom://game/')) {
    fail('The selected BIOS file could not be opened.');
    return;
  }

  if (dataPath !== STABLE_DATA_PATH && dataPath !== NETPLAY_DATA_PATH) {
    fail('The player received an unsupported EmulatorJS runtime.');
    return;
  }

  if (netplayServer) {
    try {
      if (new URL(netplayServer).protocol !== 'https:') throw new Error('insecure');
    } catch {
      fail('The NetPlay server address is invalid.');
      return;
    }
  }

  const requiresThreads = core === 'psp' || core === '3ds';

  if (requiresThreads && !window.crossOriginIsolated) {
    fail(`${core === '3ds' ? 'Nintendo 3DS' : 'PSP'} emulation requires threaded WebAssembly, but cross-origin isolation is unavailable.`);
    return;
  }

  window.EJS_player = '#game';
  window.EJS_core = core;
  window.EJS_gameUrl = romUrl;
  window.EJS_biosUrl = biosUrl;
  window.EJS_gameName = gameName;
  window.EJS_gameID = gameId;
  window.EJS_pathtodata = dataPath;
  window.EJS_startOnLoaded = true;
  window.EJS_askBeforeExit = false;
  window.EJS_threads = requiresThreads;
  window.EJS_color = '#ff5f2e';
  window.EJS_backgroundColor = '#08090c';
  window.EJS_browserMode = 'desktop';
  window.EJS_cacheConfig = {
    enabled: true,
    cacheMaxSizeMB: 4096,
    cacheMaxAgeMins: 10080
  };
  window.EJS_defaultControls = {
    0: createPlayerControls(playerOneKeyboard),
    1: createPlayerControls(playerTwoKeyboard),
    2: {},
    3: {}
  };
  window.EJS_defaultOptions = {
    keyboardInput: 'disabled'
  };
  if (netplayServer) {
    window.EJS_netplayServer = netplayServer;
    window.EJS_netplayICEServers = iceServers;
  }
  window.EJS_ready = () => notify('ready');
  window.EJS_onGameStart = () => notify('started');
  window.EJS_onExit = () => notify('exit');

  window.addEventListener('error', (event) => {
    if (event.target instanceof HTMLScriptElement) {
      fail('Could not download the EmulatorJS runtime. Check your internet connection.');
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason instanceof Error ? event.reason.message : String(event.reason || '');
    fail(message || 'The emulator stopped while loading this game.');
  });

  const loader = document.createElement('script');
  loader.src = `${dataPath}loader.js`;
  loader.async = true;
  loader.onerror = () => fail('Could not download the EmulatorJS runtime. Check your internet connection.');
  document.body.appendChild(loader);
})();
