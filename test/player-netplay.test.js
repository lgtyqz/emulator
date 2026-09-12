'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/player-netplay.js'), 'utf8');

function setup(role) {
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
  const calls = [];
  const errors = [];
  const messages = [];
  const events = {};
  const emu = {
    isNetplay: false,
    gameManager: { toggleMainLoop: (value) => calls.push(['loop', value]) },
    displayMessage: (message) => messages.push(message)
  };
  const netplay = emu.netplay = {
    defineNetplayFunctions: () => calls.push(['initialize']),
    openRoom: (...args) => calls.push(['open', ...args]),
    joinRoom: (...args) => calls.push(['join', ...args]),
    getOpenRooms: async () => netplay.rooms,
    leaveRoom: () => { calls.push(['leave']); emu.isNetplay = false; },
    getUserIndex: () => 1,
    rooms: {},
    peerConnections: {}
  };
  const window = { addEventListener: (name, handler) => { events[name] = handler; } };
  vm.runInNewContext(source, {
    window, Date: { now: () => now },
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id) => timers.delete(id)
  });
  return {
    emu, netplay, calls, errors, messages, events, timers,
    async start() {
      window.romRoomNetplay(emu, { netplayRole: role, roomPassword: 'abcdefghijklmnopqrst' }, (error) => errors.push(error));
      await Promise.resolve();
    },
    async tick(elapsed = 500) {
      now += elapsed;
      const pending = [...timers.values()];
      timers.clear();
      for (const fn of pending) await fn();
    }
  };
}

test('hosting opens a protected runtime room without globe-menu interaction', async () => {
  const app = setup('host');
  await app.start();
  assert.deepEqual(app.calls, [['initialize'], ['open', 'ROM Room', 4, 'abcdefghijklmnopqrst']]);
  app.emu.isNetplay = true;
  await app.tick();
  await app.tick(90000);
  assert.deepEqual(app.errors, []);
  assert.match(app.messages.at(-1), /Player 1/);
});

test('guest pauses solo emulation, waits for the host, and joins exactly once', async () => {
  const app = setup('guest');
  await app.start();
  assert.deepEqual(app.calls, [['loop', 0], ['initialize']]);
  app.netplay.rooms = { 'runtime-room-id': { room_name: 'ROM Room', max: 4 } };
  await app.tick();
  await app.tick();
  assert.deepEqual(app.calls.at(-1), ['join', 'runtime-room-id', 'ROM Room', 4, 'abcdefghijklmnopqrst']);
  assert.equal(app.calls.filter(([name]) => name === 'join').length, 1);
  app.emu.isNetplay = true;
  await app.tick();
  assert.ok(!app.messages.some((message) => message.includes('connected:')));
  app.netplay._gotVideoEver = true;
  await app.tick();
  assert.ok(!app.messages.some((message) => message.includes('connected:')));
  app.netplay.peerConnections.host = { dataChannel: { readyState: 'open' } };
  await app.tick();
  assert.equal(app.messages.at(-1), 'NetPlay connected: Player 2');
});

test('missing host and missing peer transport fail instead of resuming solo play', async () => {
  for (const joined of [false, true]) {
    const app = setup('guest');
    await app.start();
    app.emu.isNetplay = joined;
    await app.tick();
    await app.tick(60000);
    assert.match(app.errors[0], /could not connect/);
    assert.deepEqual(app.calls.slice(-2), [['leave'], ['loop', 0]]);
    assert.equal(app.timers.size, 0);
  }
});

test('room disconnect stops the local game and reports the failure', async () => {
  const app = setup('guest');
  await app.start();
  app.emu.isNetplay = true;
  await app.tick();
  app.emu.isNetplay = false;
  await app.tick();
  assert.match(app.errors[0], /disconnected/);
  assert.deepEqual(app.calls.at(-1), ['loop', 0]);
});

test('leaving the player cancels room discovery even with a request in flight', async () => {
  const app = setup('guest');
  let resolveRooms;
  app.netplay.getOpenRooms = () => new Promise((resolve) => { resolveRooms = resolve; });
  await app.start();
  app.events.pagehide();
  resolveRooms({ room: { room_name: 'ROM Room', max: 4 } });
  await Promise.resolve();
  assert.equal(app.timers.size, 0);
  assert.ok(!app.calls.some(([name]) => name === 'join'));
});

test('missing runtime NetPlay support reports a launch failure', async () => {
  const app = setup('guest');
  delete app.emu.netplay;
  await app.start();
  assert.match(app.errors[0], /could not initialize/);
});

test('room discovery cannot stall the connection deadline', async () => {
  const app = setup('guest');
  app.netplay.getOpenRooms = () => new Promise(() => {});
  await app.start();
  await app.tick(60000);
  assert.match(app.errors[0], /could not connect/);
  assert.equal(app.timers.size, 0);
});
