'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

test('grants screen wake lock only through the isolated player boundary', () => {
  const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  const appMarkup = fs.readFileSync(path.join(projectRoot, 'src/index.html'), 'utf8');

  assert.match(mainSource, /allowedPlayerPermissions[^\n]+screen-wake-lock/);
  assert.match(mainSource, /screen-wake-lock=\(self \"rom-room:\/\/player\"\)/);
  assert.match(appMarkup, /allow="[^"]*screen-wake-lock[^"]*"/);
});

test('validates IPC senders and exposes the bounded NetPlay preload API', () => {
  const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');

  assert.match(mainSource, /function trustedHandle[\s\S]*isTrustedRendererEvent/);
  assert.match(mainSource, /senderUrl\.startsWith\(`\$\{APP_SCHEME\}:\/\/bundle\/`\)/);
  for (const method of ['hostNetplay', 'resolveNetplayInvite', 'joinNetplay', 'stopNetplay', 'onNetplayInvite', 'onNetplayStatus']) {
    assert.match(preloadSource, new RegExp(`${method}:`));
  }
});

test('keeps launch details behind an opaque private player session', () => {
  const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(projectRoot, 'src/renderer.js'), 'utf8');

  assert.match(mainSource, /playerSessions\.set\(playerSessionId/);
  assert.match(mainSource, /playerSessionId,\s*\n\s*netplay:/);
  assert.match(mainSource, /pathname\.startsWith\('\/session\/'\)/);
  assert.match(rendererSource, /searchParams\.set\('session', launchData\.playerSessionId\)/);
  assert.doesNotMatch(rendererSource, /searchParams\.set\('rom'/);
  assert.doesNotMatch(rendererSource, /launchData\.romUrl/);
});

test('selects stable EmulatorJS for solo play and the pinned prerelease only for NetPlay', () => {
  const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  const playerSource = fs.readFileSync(path.join(projectRoot, 'src/player.js'), 'utf8');

  assert.match(mainSource, /netplayConfig[\s\S]*4\.3\.0-pre\/data\/[\s\S]*4\.2\.3\/data\//);
  assert.match(playerSource, /STABLE_DATA_PATH = 'https:\/\/cdn\.emulatorjs\.org\/4\.2\.3\/data\/'/);
  assert.match(playerSource, /NETPLAY_DATA_PATH = 'https:\/\/cdn\.emulatorjs\.org\/4\.3\.0-pre\/data\/'/);
  assert.match(playerSource, /if \(netplayServer\) \{[\s\S]*EJS_netplayServer[\s\S]*EJS_netplayICEServers/);
});

test('queues cold- and warm-start deep links and pins only invited LAN certificates', () => {
  const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');

  assert.match(mainSource, /app\.on\('second-instance'/);
  assert.match(mainSource, /app\.on\('open-url'/);
  assert.match(mainSource, /PORTABLE_EXECUTABLE_FILE[\s\S]*setAsDefaultProtocolClient/);
  assert.match(mainSource, /did-finish-load[\s\S]*pendingDeepLink/);
  assert.match(mainSource, /certificateIsTrusted[\s\S]*certificateFingerprintFromData\(certificate\?\.data\)/);
  assert.match(mainSource, /setCertificateVerifyProc[\s\S]*certificateIsTrusted\(request\.hostname, request\.certificate\)[\s\S]*\? 0 : -3/);
});
