(function exposeSystems(globalObject) {
  'use strict';

  const systems = [
    { id: 'nes', label: 'Nintendo Entertainment System', short: 'NES', family: 'Nintendo', extensions: ['nes', 'fds', 'unf', 'unif'] },
    { id: 'snes', label: 'Super Nintendo', short: 'SNES', family: 'Nintendo', extensions: ['smc', 'sfc', 'fig', 'swc', 'bsx'] },
    { id: 'gb', label: 'Game Boy / Game Boy Color', short: 'GB / GBC', family: 'Nintendo', extensions: ['gb', 'gbc'] },
    { id: 'gba', label: 'Game Boy Advance', short: 'GBA', family: 'Nintendo', extensions: ['gba'] },
    { id: 'n64', label: 'Nintendo 64', short: 'N64', family: 'Nintendo', extensions: ['n64', 'z64', 'v64'] },
    { id: 'nds', label: 'Nintendo DS', short: 'NDS', family: 'Nintendo', extensions: ['nds'] },
    { id: '3ds', label: 'Nintendo 3DS (Azahar)', short: '3DS', family: 'Nintendo', extensions: ['3ds', 'cci', 'cia', 'cxi', 'app'] },
    { id: 'segaMD', label: 'Sega Genesis / Mega Drive', short: 'Genesis', family: 'Sega', extensions: ['md', 'gen', 'smd', 'sg'] },
    { id: 'segaMS', label: 'Sega Master System', short: 'Master System', family: 'Sega', extensions: ['sms'] },
    { id: 'segaGG', label: 'Sega Game Gear', short: 'Game Gear', family: 'Sega', extensions: ['gg'] },
    { id: 'sega32x', label: 'Sega 32X', short: '32X', family: 'Sega', extensions: ['32x'] },
    { id: 'segaCD', label: 'Sega CD', short: 'Sega CD', family: 'Sega', extensions: [] },
    { id: 'segaSaturn', label: 'Sega Saturn', short: 'Saturn', family: 'Sega', extensions: [] },
    { id: 'psx', label: 'Sony PlayStation', short: 'PlayStation', family: 'Sony', extensions: ['ccd'] },
    { id: 'psp', label: 'PlayStation Portable', short: 'PSP', family: 'Sony', extensions: ['cso'] },
    { id: 'atari2600', label: 'Atari 2600', short: 'Atari 2600', family: 'Atari', extensions: ['a26'] },
    { id: 'a5200', label: 'Atari 5200', short: 'Atari 5200', family: 'Atari', extensions: ['a52'] },
    { id: 'atari7800', label: 'Atari 7800', short: 'Atari 7800', family: 'Atari', extensions: ['a78'] },
    { id: 'lynx', label: 'Atari Lynx', short: 'Lynx', family: 'Atari', extensions: ['lnx'] },
    { id: 'jaguar', label: 'Atari Jaguar', short: 'Jaguar', family: 'Atari', extensions: ['j64', 'jag'] },
    { id: 'arcade', label: 'Arcade (FinalBurn Neo)', short: 'Arcade', family: 'Computers & Arcade', extensions: ['zip', '7z'] },
    { id: 'mame2003', label: 'MAME 2003', short: 'MAME 2003', family: 'Computers & Arcade', extensions: [] },
    { id: 'c64', label: 'Commodore 64', short: 'C64', family: 'Computers & Arcade', extensions: ['d64', 't64', 'prg'] },
    { id: 'amiga', label: 'Commodore Amiga', short: 'Amiga', family: 'Computers & Arcade', extensions: ['adf', 'adz', 'dms'] },
    { id: 'dos', label: 'DOS', short: 'DOS', family: 'Computers & Arcade', extensions: ['exe'] },
    { id: '3do', label: '3DO', short: '3DO', family: 'Other', extensions: [] },
    { id: 'vb', label: 'Virtual Boy', short: 'Virtual Boy', family: 'Other', extensions: ['vb', 'vboy'] },
    { id: 'coleco', label: 'ColecoVision', short: 'ColecoVision', family: 'Other', extensions: ['col', 'cv'] },
    { id: 'pce', label: 'PC Engine / TurboGrafx-16', short: 'PC Engine', family: 'Other', extensions: ['pce'] },
    { id: 'ngp', label: 'Neo Geo Pocket', short: 'Neo Geo Pocket', family: 'Other', extensions: ['ngp', 'ngc'] },
    { id: 'ws', label: 'WonderSwan', short: 'WonderSwan', family: 'Other', extensions: ['ws', 'wsc'] }
  ];

  const ambiguousExtensions = new Set(['bin', 'cue', 'iso', 'chd', 'pbp', 'zip', '7z', 'rom', 'bios']);
  const byId = new Map(systems.map((system) => [system.id, system]));
  const extensionMap = new Map();

  for (const system of systems) {
    for (const extension of system.extensions) extensionMap.set(extension, system.id);
  }

  function extensionOf(fileName) {
    const cleanName = String(fileName || '').split(/[?#]/)[0];
    const lastDot = cleanName.lastIndexOf('.');
    return lastDot >= 0 ? cleanName.slice(lastDot + 1).toLowerCase() : '';
  }

  function detectSystem(fileName) {
    const extension = extensionOf(fileName);
    if (!extension || ambiguousExtensions.has(extension)) return null;
    return extensionMap.get(extension) || null;
  }

  function getSystem(id) {
    return byId.get(id) || null;
  }

  function normalizeSystem(id) {
    return typeof id === 'string' && byId.has(id) ? id : null;
  }

  function titleFromFile(fileName) {
    const base = String(fileName || '').split(/[\\/]/).pop() || 'Untitled game';
    const withoutExtension = base.replace(/\.[^.]+$/, '');
    return withoutExtension.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled game';
  }

  const api = { systems, detectSystem, extensionOf, getSystem, normalizeSystem, titleFromFile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalObject) globalObject.RomRoomSystems = api;
})(typeof window !== 'undefined' ? window : globalThis);
