'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const packageMetadata = require('../package.json');

test('creates portable distribution artifacts for every desktop platform', () => {
  const { build } = packageMetadata;

  assert.equal(build.mac.target, 'zip');
  assert.equal(build.win.target, 'portable');
  assert.deepEqual(build.linux.target, ['AppImage']);
  assert.equal(build.artifactName, '${productName}-${version}-${os}-${arch}.${ext}');
  assert.notEqual(build.win.target, 'nsis');
  assert.notEqual(build.mac.target, 'dmg');
});

test('keeps NetPlay tunnel binaries in every portable artifact', () => {
  const { build } = packageMetadata;

  assert.match(build.mac.extraResources.from, /darwin-\$\{arch\}\/cloudflared$/);
  assert.match(build.win.extraResources.from, /win32-\$\{arch\}\/cloudflared\.exe$/);
  assert.match(build.linux.extraResources.from, /linux-\$\{arch\}\/cloudflared$/);
});
