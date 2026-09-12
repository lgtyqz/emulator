'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const { generateCertificate } = require('../src/netplay-server');
const {
  MAX_INVITE_LENGTH,
  certificateFingerprintFromData,
  certificateMatches,
  decodeInvite,
  encodeInvite,
  invitationCodeFromInput,
  inviteLink,
  netplayGameId,
  playerCsp,
  validateServerUrl
} = require('../src/netplay-shared');

const gameHash = '0123456789abcdef'.repeat(4);
const fingerprint = 'ab'.repeat(32);

function invitation(overrides = {}) {
  return {
    v: 1,
    serverUrl: 'https://192.168.1.20:43123',
    gameHash,
    gameId: netplayGameId(gameHash),
    core: 'snes',
    gameName: 'Kirby Super Star.sfc',
    connection: 'lan',
    certificateFingerprint: fingerprint,
    ...overrides
  };
}

test('round-trips versioned invitation codes and deep links', () => {
  const code = encodeInvite(invitation());
  assert.match(code, /^RR1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeInvite(code), invitation());
  assert.deepEqual(decodeInvite(inviteLink(code)), invitation());
  assert.equal(invitationCodeFromInput(`  ${code}  `), code);
});

test('derives a deterministic safe integer from the first twelve hash digits', () => {
  assert.equal(netplayGameId(gameHash), Number.parseInt('0123456789ab', 16));
  assert.equal(netplayGameId(gameHash.toUpperCase()), netplayGameId(gameHash));
  assert.throws(() => netplayGameId('short'), /fingerprint/);
});

test('preserves automatic-room credentials and accepts older manual invitations', () => {
  const payload = invitation({ roomPassword: 'abcdefghijklmnopqrst' });
  assert.deepEqual(decodeInvite(encodeInvite(payload)), payload);
  assert.equal(decodeInvite(encodeInvite(invitation())).roomPassword, undefined);
  for (const roomPassword of ['', 'short', 'a'.repeat(21), ' '.repeat(20), null, 123]) {
    assert.throws(() => encodeInvite(invitation({ roomPassword })), /room password/);
  }
});

test('rejects malformed, oversized, and internally inconsistent invitations', () => {
  assert.throws(() => decodeInvite('RR1.not-json'), /corrupted/);
  assert.throws(() => decodeInvite('x'.repeat(MAX_INVITE_LENGTH + 1)), /too large/);
  assert.throws(() => encodeInvite(invitation({ gameId: 42 })), /does not match/);
  assert.throws(() => encodeInvite(invitation({ certificateFingerprint: '' })), /identify the host certificate/);
  assert.throws(() => encodeInvite(invitation({ gameName: 'x'.repeat(161) })), /game name/);
});

test('accepts only pathless credential-free HTTPS server URLs', () => {
  assert.equal(validateServerUrl('https://play.example:8443/'), 'https://play.example:8443');
  for (const unsafe of [
    'http://play.example',
    'file:///tmp/socket',
    'https://user:pass@play.example',
    'https://play.example/private',
    'https://play.example/?token=secret',
    'https://play.example/#fragment'
  ]) {
    assert.throws(() => validateServerUrl(unsafe), /server address|HTTPS/);
  }
});

test('normalizes and compares pinned LAN certificate fingerprints', () => {
  const colonFingerprint = fingerprint.match(/.{2}/g).join(':').toUpperCase();
  assert.equal(certificateMatches(fingerprint, colonFingerprint), true);
  assert.equal(certificateMatches(fingerprint, 'cd'.repeat(32)), false);
  assert.equal(certificateMatches('not-a-certificate', fingerprint), false);
});

test('derives the pinned SHA-256 fingerprint from Electron certificate PEM data', () => {
  const credentials = generateCertificate();
  const expected = new X509Certificate(credentials.cert).fingerprint256.replaceAll(':', '').toLowerCase();
  const electronFingerprint = `sha256/${Buffer.from(expected, 'hex').toString('base64')}`;

  assert.equal(certificateMatches(expected, electronFingerprint), false);
  assert.equal(certificateFingerprintFromData(credentials.cert), expected);
  assert.equal(certificateMatches(expected, certificateFingerprintFromData(credentials.cert)), true);
  assert.equal(certificateFingerprintFromData('not a certificate'), '');
});

test('generates a player CSP containing only the selected signaling origin', () => {
  const csp = playerCsp('https://room.example:8443');
  assert.match(csp, /connect-src[^;]+https:\/\/room\.example:8443[^;]+wss:\/\/room\.example:8443/);
  assert.doesNotMatch(csp, /https:\/\/other\.example/);
  assert.throws(() => playerCsp('http://room.example'), /HTTPS/);
});
