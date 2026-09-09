'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createTunnelManager } = require('../src/netplay-tunnel');
const { VERSION, assets, prepare, sha256, verifyChecksum } = require('../scripts/prepare-cloudflared');

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.signals = [];
  }

  kill(signal = 'SIGTERM') {
    this.signals.push(signal);
    setImmediate(() => this.emit('exit', null, signal));
    return true;
  }
}

test('extracts a Quick Tunnel URL and terminates cloudflared gracefully', async () => {
  const child = new FakeChild();
  const statuses = [];
  let invocation;
  const manager = createTunnelManager({
    binaryPath: __filename,
    configPath: __filename,
    spawnImpl(binary, args, options) {
      invocation = { binary, args, options };
      return child;
    },
    onStatus: (status) => statuses.push(status)
  });

  const starting = manager.start('https://127.0.0.1:43210');
  child.stderr.write('{"msg":"https://quiet-');
  child.stderr.write('forest.trycloudflare.com"}\n');
  assert.equal(await starting, 'https://quiet-forest.trycloudflare.com');
  assert.equal(invocation.binary, __filename);
  assert.deepEqual(invocation.args, [
    'tunnel', '--config', __filename, '--url', 'https://127.0.0.1:43210', '--no-autoupdate',
    '--no-tls-verify', '--loglevel', 'info', '--output', 'json'
  ]);
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(statuses.map((status) => status.state), ['starting', 'ready']);

  await manager.stop();
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.equal(statuses.at(-1).state, 'stopped');
});

test('reports startup crashes without misreporting a later disconnection and can retry', async () => {
  const first = new FakeChild();
  const second = new FakeChild();
  const queue = [first, second];
  const statuses = [];
  const manager = createTunnelManager({
    binaryPath: __filename,
    spawnImpl: () => queue.shift(),
    onStatus: (status) => statuses.push(status),
    startupTimeout: 1000
  });

  const failed = manager.start('https://127.0.0.1:1');
  first.stderr.write('could not connect origin\n');
  first.emit('exit', 1, null);
  await assert.rejects(failed, /could not connect origin/);
  assert.equal(statuses.some((status) => status.state === 'disconnected'), false);

  const retried = manager.start('https://127.0.0.1:1');
  second.stdout.write('https://second-attempt.trycloudflare.com');
  assert.equal(await retried, 'https://second-attempt.trycloudflare.com');
  await manager.stop();
});

test('times out a hung process and rejects a missing bundled executable', async () => {
  const child = new FakeChild();
  const manager = createTunnelManager({
    binaryPath: __filename,
    spawnImpl: () => child,
    startupTimeout: 15
  });
  await assert.rejects(manager.start('https://127.0.0.1:1'), /timed out/);
  assert.equal(child.signals.length, 1);

  const missing = createTunnelManager({ binaryPath: `${__filename}.missing` });
  await assert.rejects(missing.start('https://127.0.0.1:1'), /unavailable/);
});

test('pins checksums for every supported cloudflared build target', async () => {
  assert.equal(VERSION, '2026.8.3');
  assert.deepEqual(Object.keys(assets).sort(), [
    'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'
  ]);
  for (const asset of Object.values(assets)) assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal(sha256(Buffer.from('ROM Room')), 'bb29054c19870fa7ebed48cb5dfcf5e1cb21f0de2590b397fac7acd8755491ad');
  assert.throws(
    () => verifyChecksum(Buffer.from('tampered'), 'cloudflared-test', '00'.repeat(32)),
    /checksum mismatch.*cloudflared-test/
  );
  await assert.rejects(prepare('freebsd', 'x64'), /No pinned cloudflared/);
});
