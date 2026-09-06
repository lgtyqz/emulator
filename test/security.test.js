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
