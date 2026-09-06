'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectSystem,
  extensionOf,
  getSystem,
  normalizeSystem,
  systems,
  titleFromFile
} = require('../src/systems');

test('detects common ROM extensions without case sensitivity', () => {
  assert.equal(detectSystem('/games/Mother 3.GBA'), 'gba');
  assert.equal(detectSystem('Mario Kart 64.z64'), 'n64');
  assert.equal(detectSystem('Sonic.GEN'), 'segaMD');
  assert.equal(detectSystem('Tetris.gbc'), 'gb');
  assert.equal(detectSystem('Mario Kart 7.3DS'), '3ds');
  assert.equal(detectSystem('Animal Crossing.cia'), '3ds');
  assert.equal(detectSystem('homebrew.3dsx'), null);
});

test('leaves shared disc-image and archive formats for the user to choose', () => {
  for (const fileName of ['game.cue', 'game.iso', 'game.chd', 'game.bin', 'game.pbp', 'game.zip', 'game.7z']) {
    assert.equal(detectSystem(fileName), null);
  }
});

test('extracts extensions from names and URLs', () => {
  assert.equal(extensionOf('game.SFC?download=1'), 'sfc');
  assert.equal(extensionOf('README'), '');
});

test('normalizes only supported EmulatorJS cores', () => {
  assert.equal(normalizeSystem('snes'), 'snes');
  assert.equal(normalizeSystem('3ds'), '3ds');
  assert.equal(normalizeSystem('not-a-core'), null);
  assert.equal(getSystem('psx').short, 'PlayStation');
  assert.ok(systems.length >= 25);
});

test('configures Nintendo 3DS to use EmulatorJS threaded WebAssembly', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const playerSource = fs.readFileSync(path.resolve(__dirname, '../src/player.js'), 'utf8');

  assert.match(playerSource, /allowedCores[\s\S]*'3ds'/);
  assert.match(playerSource, /core === 'psp' \|\| core === '3ds'/);
  assert.match(playerSource, /EJS_threads = requiresThreads/);
});

test('turns a ROM filename into a readable title', () => {
  assert.equal(titleFromFile('/roms/The_Legend.of.Zelda.nes'), 'The Legend of Zelda');
  assert.equal(titleFromFile('game'), 'game');
});
