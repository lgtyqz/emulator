'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensureGameHash, findMatchingGame } = require('../src/netplay-library');

test('hashes a ROM lazily and requests a version 2 library migration once', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rom-room-hash-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const romPath = path.join(directory, 'game.nes');
  const contents = Buffer.alloc(256 * 1024, 0x5a);
  await fs.writeFile(romPath, contents);
  const expected = crypto.createHash('sha256').update(contents).digest('hex');
  const versions = [];
  const game = { path: romPath, contentHash: null };

  assert.equal(await ensureGameHash(game, async (version) => versions.push(version)), expected);
  assert.deepEqual(versions, [2]);
  assert.equal(await ensureGameHash(game, async (version) => versions.push(version)), expected);
  assert.deepEqual(versions, [2]);
});

test('matches stored hashes exactly and hashes only same-name candidates lazily', async () => {
  const expectedHash = 'aa'.repeat(32);
  const games = [
    { id: 'known', name: 'Other.sfc', contentHash: expectedHash },
    { id: 'candidate', name: 'Game.sfc', contentHash: null }
  ];
  let hashCalls = 0;
  assert.equal((await findMatchingGame(games, expectedHash, 'Game.sfc', async () => {
    hashCalls += 1;
    return expectedHash;
  })).id, 'known');
  assert.equal(hashCalls, 0);

  games[0].contentHash = 'bb'.repeat(32);
  assert.equal((await findMatchingGame(games, expectedHash, 'Game.sfc', async () => {
    hashCalls += 1;
    return expectedHash;
  })).id, 'candidate');
  assert.equal(hashCalls, 1);
  assert.equal(await findMatchingGame(games, expectedHash, 'Missing.sfc', async () => expectedHash), null);
});
