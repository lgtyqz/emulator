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

function audioContext() {
  const track = { stopCount: 0, stop() { this.stopCount++; } };
  const destination = { stream: { getTracks: () => [track], getAudioTracks: () => [track] } };
  const context = { state: 'running', createMediaStreamDestination: () => destination };
  const makeSource = () => ({
    context, connections: new Set(),
    connect(node) { this.connections.add(node); },
    disconnect(node) { this.connections.delete(node); }
  });
  return { context, destination, track, makeSource };
}

test('host captures late OpenAL sources without interrupting local audio', async () => {
  const app = setup('host');
  const audio = audioContext();
  const localOutput = {};
  app.emu.Module = { AL: { currentCtx: { audioCtx: audio.context, sources: [] } } };
  await app.start();
  const stream = app.netplay._captureHostAudio();
  const source = audio.makeSource();
  source.connect(localOutput);
  app.emu.Module.AL.currentCtx.sources.push({ gain: source });
  await app.tick();
  assert.equal(app.netplay._captureHostAudio(), stream);
  assert.deepEqual([...source.connections], [localOutput, audio.destination]);
  await app.tick();
  assert.equal(source.connections.size, 2);
  app.events.pagehide();
  assert.deepEqual([...source.connections], [localOutput]);
  assert.equal(audio.track.stopCount, 1);
});

test('audio source replacement disconnects obsolete capture taps', async () => {
  const app = setup('host');
  const audio = audioContext();
  const first = audio.makeSource();
  const second = audio.makeSource();
  const al = { audioCtx: audio.context, sources: [{ gain: first }] };
  app.emu.Module = { AL: { currentCtx: al } };
  await app.start();
  al.sources = [{ gain: second }];
  await app.tick();
  assert.equal(first.connections.size, 0);
  assert.ok(second.connections.has(audio.destination));
});

test('late audio context adds an audio track and renegotiates existing video peers once', async () => {
  const app = setup('host');
  const tracks = [];
  app.netplay.localStream = {
    getAudioTracks: () => tracks,
    addTrack: (track) => tracks.push(track)
  };
  let closed = 0;
  let created = 0;
  app.netplay.peerConnections.guest = { pc: { close: () => closed++ } };
  app.netplay.createPeerConnection = (id) => {
    assert.equal(id, 'guest');
    created++;
  };
  await app.start();
  const audio = audioContext();
  app.emu.Module = { AL: { currentCtx: { audioCtx: audio.context, sources: [{ gain: audio.makeSource() }] } } };
  await app.tick();
  await app.tick();
  assert.deepEqual(tracks, [audio.track]);
  assert.equal(closed, 1);
  assert.equal(created, 1);
});
