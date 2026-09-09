'use strict';

const INVITE_PREFIX = 'RR1.';
const INVITE_VERSION = 1;
const MAX_INVITE_LENGTH = 8192;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

/**
 * @typedef {'lan'|'internet'} NetplayReach
 * @typedef {{state: string, detail: string, role: ('host'|'guest'|null), reach: (NetplayReach|null)}} NetplayStatus
 * @typedef {{connection: NetplayReach, label: string, serverUrl: string, code: string, link: string}} InviteEndpoint
 * @typedef {{v: 1, serverUrl: string, gameHash: string, gameId: number, core: string, gameName: string, connection: NetplayReach, certificateFingerprint?: string}} NetplayInviteV1
 * @typedef {{id: string, role: 'host'|'guest', reach: NetplayReach, game: object, core: string, status: NetplayStatus|null, endpoints: InviteEndpoint[]}} NetplaySession
 */

function netplayGameId(gameHash) {
  if (typeof gameHash !== 'string' || !SHA256_PATTERN.test(gameHash.toLowerCase())) {
    throw new Error('The invitation contains an invalid game fingerprint.');
  }
  return Number.parseInt(gameHash.slice(0, 12), 16) || 1;
}

function normalizeFingerprint(value) {
  if (typeof value !== 'string') return '';
  return value.replaceAll(':', '').trim().toLowerCase();
}

function certificateMatches(expected, actual) {
  const expectedFingerprint = normalizeFingerprint(expected);
  return FINGERPRINT_PATTERN.test(expectedFingerprint)
    && expectedFingerprint === normalizeFingerprint(actual);
}

function validateServerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The invitation contains an invalid server address.');
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('NetPlay server addresses must use HTTPS and cannot contain credentials.');
  }
  if (url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('The invitation contains an unsupported server address.');
  }

  url.pathname = '';
  return url.toString().replace(/\/$/, '');
}

function playerCsp(netplayServer = '') {
  const connections = ["'self'", 'https://cdn.emulatorjs.org', 'emu-rom:', 'blob:'];
  if (netplayServer) {
    const url = new URL(validateServerUrl(netplayServer));
    connections.push(url.origin, `wss://${url.host}`);
  }
  return [
    "default-src 'self' https://cdn.emulatorjs.org",
    "script-src 'self' https://cdn.emulatorjs.org 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
    "style-src 'self' https://cdn.emulatorjs.org 'unsafe-inline'",
    `connect-src ${connections.join(' ')}`,
    "img-src 'self' https://cdn.emulatorjs.org data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' https://cdn.emulatorjs.org data:",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'"
  ].join('; ');
}

function normalizeInvite(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('That is not a valid ROM Room invitation.');
  }

  const version = Number(payload.v);
  if (version !== INVITE_VERSION) {
    throw new Error('This invitation was created by an unsupported version of ROM Room.');
  }

  const gameHash = String(payload.gameHash || '').trim().toLowerCase();
  if (!SHA256_PATTERN.test(gameHash)) {
    throw new Error('The invitation contains an invalid game fingerprint.');
  }

  const expectedGameId = netplayGameId(gameHash);
  const gameId = Number(payload.gameId);
  if (!Number.isSafeInteger(gameId) || gameId !== expectedGameId) {
    throw new Error('The invitation game identifier does not match its fingerprint.');
  }

  const core = String(payload.core || '').trim();
  if (!/^[A-Za-z0-9]{1,24}$/.test(core)) {
    throw new Error('The invitation contains an invalid emulator core.');
  }

  const gameName = String(payload.gameName || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!gameName || gameName.length > 160) {
    throw new Error('The invitation contains an invalid game name.');
  }

  const connection = payload.connection === 'internet' ? 'internet' : payload.connection === 'lan' ? 'lan' : '';
  if (!connection) throw new Error('The invitation contains an invalid connection type.');

  const certificateFingerprint = normalizeFingerprint(payload.certificateFingerprint || '');
  if (certificateFingerprint && !FINGERPRINT_PATTERN.test(certificateFingerprint)) {
    throw new Error('The invitation contains an invalid server certificate fingerprint.');
  }
  if (connection === 'lan' && !certificateFingerprint) {
    throw new Error('LAN invitations must identify the host certificate.');
  }

  return {
    v: INVITE_VERSION,
    serverUrl: validateServerUrl(payload.serverUrl),
    gameHash,
    gameId,
    core,
    gameName,
    connection,
    ...(certificateFingerprint ? { certificateFingerprint } : {})
  };
}

function encodeInvite(payload) {
  const normalized = normalizeInvite(payload);
  return `${INVITE_PREFIX}${Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url')}`;
}

function inviteLink(code) {
  return `rom-room://join?code=${encodeURIComponent(code)}`;
}

function invitationCodeFromInput(input) {
  if (typeof input !== 'string') throw new Error('Paste a ROM Room invitation first.');
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_INVITE_LENGTH) {
    throw new Error('That ROM Room invitation is empty or too large.');
  }

  if (trimmed.startsWith(INVITE_PREFIX)) return trimmed;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('That is not a valid ROM Room invitation.');
  }
  if (url.protocol !== 'rom-room:' || url.host !== 'join') {
    throw new Error('That link is not a ROM Room NetPlay invitation.');
  }
  const code = url.searchParams.get('code') || '';
  if (!code.startsWith(INVITE_PREFIX)) {
    throw new Error('That link does not contain a NetPlay invitation.');
  }
  return code;
}

function decodeInvite(input) {
  const code = invitationCodeFromInput(input);
  let parsed;
  try {
    const encoded = code.slice(INVITE_PREFIX.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('bad encoding');
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('That ROM Room invitation is corrupted.');
  }
  return normalizeInvite(parsed);
}

module.exports = {
  INVITE_PREFIX,
  INVITE_VERSION,
  MAX_INVITE_LENGTH,
  certificateMatches,
  decodeInvite,
  encodeInvite,
  invitationCodeFromInput,
  inviteLink,
  netplayGameId,
  normalizeFingerprint,
  normalizeInvite,
  playerCsp,
  validateServerUrl
};
