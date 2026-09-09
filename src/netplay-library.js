'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const HASH_PATTERN = /^[a-f0-9]{64}$/;

function validContentHash(value) {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

async function hashFile(filePath, createReadStream = fs.createReadStream) {
  const digest = crypto.createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest('hex');
}

async function ensureGameHash(game, persist, hash = hashFile) {
  if (validContentHash(game?.contentHash)) return game.contentHash;
  if (!game?.path) throw new Error('The ROM file is no longer available.');
  const contentHash = await hash(game.path);
  game.contentHash = contentHash;
  await persist(2);
  return contentHash;
}

async function findMatchingGame(games, gameHash, gameName, ensureHash) {
  const exact = games.find((game) => game.contentHash === gameHash);
  if (exact) return exact;

  for (const game of games.filter((entry) => entry.name === gameName)) {
    try {
      if (await ensureHash(game) === gameHash) return game;
    } catch {
      // The caller will offer a file picker when a recent file is unavailable.
    }
  }
  return null;
}

module.exports = {
  HASH_PATTERN,
  ensureGameHash,
  findMatchingGame,
  hashFile,
  validContentHash
};
