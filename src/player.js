(function bootPlayer() {
  'use strict';

  const EJS_DATA_PATH = 'https://cdn.emulatorjs.org/stable/data/';
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
  const core = params.get('core');
  const romUrl = params.get('rom');
  const biosUrl = params.get('bios') || '';
  const gameName = params.get('name') || 'Game';
  const gameId = Number.parseInt(params.get('gameId'), 10) || 1;

  if (!allowedCores.has(core) || !romUrl || !romUrl.startsWith('emu-rom://game/')) {
    fail('The player received an invalid game configuration.');
    return;
  }

  if (biosUrl && !biosUrl.startsWith('emu-rom://game/')) {
    fail('The selected BIOS file could not be opened.');
    return;
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
  window.EJS_pathtodata = EJS_DATA_PATH;
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
  loader.src = `${EJS_DATA_PATH}loader.js`;
  loader.async = true;
  loader.onerror = () => fail('Could not download the EmulatorJS runtime. Check your internet connection.');
  document.body.appendChild(loader);
})();
