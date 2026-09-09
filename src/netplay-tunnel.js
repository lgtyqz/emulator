'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');

const QUICK_TUNNEL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu;

function createTunnelManager(options) {
  const binaryPath = options?.binaryPath;
  const spawnImpl = options?.spawnImpl || spawn;
  const logger = options?.logger || console;
  const onStatus = options?.onStatus || (() => {});
  const startupTimeout = options?.startupTimeout || 30000;
  const configPath = options?.configPath || '';
  let child = null;
  let publicUrl = '';
  let stopping = false;

  function emit(state, detail = '') {
    onStatus({ state, detail, publicUrl: publicUrl || null });
  }

  async function start(originUrl) {
    if (child) {
      if (publicUrl) return publicUrl;
      throw new Error('The internet tunnel is already starting.');
    }
    if (!binaryPath || !fs.existsSync(binaryPath)) {
      throw new Error('The bundled cloudflared executable is unavailable for this platform.');
    }

    const args = ['tunnel'];
    if (configPath) args.push('--config', configPath);
    args.push(
      '--url', originUrl,
      '--no-autoupdate',
      '--no-tls-verify',
      '--loglevel', 'info',
      '--output', 'json'
    );
    stopping = false;
    publicUrl = '';
    emit('starting', 'Connecting to Cloudflare Quick Tunnel…');

    const activeChild = spawnImpl(binaryPath, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    child = activeChild;

    return new Promise((resolve, reject) => {
      let settled = false;
      let connected = false;
      let logTail = '';
      const timeout = setTimeout(() => finishError(new Error('Cloudflare Quick Tunnel timed out while starting.')), startupTimeout);

      function finishError(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (child === activeChild) child = null;
        try { activeChild.kill(); } catch {}
        emit('error', error.message);
        reject(error);
      }

      function inspect(chunk) {
        const text = chunk.toString('utf8');
        logTail = `${logTail}${text}`.slice(-8000);
        const match = logTail.match(QUICK_TUNNEL_PATTERN);
        if (!match || settled) return;
        settled = true;
        connected = true;
        clearTimeout(timeout);
        publicUrl = match[0].replace(/\/$/, '');
        emit('ready', 'Internet invitation ready.');
        resolve(publicUrl);
      }

      activeChild.stdout?.on('data', inspect);
      activeChild.stderr?.on('data', inspect);
      activeChild.once('error', (error) => finishError(new Error(`Could not start cloudflared: ${error.message}`)));
      activeChild.once('exit', (code, signal) => {
        if (child === activeChild) child = null;
        if (!settled) {
          const suffix = logTail.trim().split('\n').at(-1)?.slice(0, 300);
          finishError(new Error(suffix || `cloudflared exited before connecting (${signal || code || 'unknown'}).`));
          return;
        }
        if (connected && !stopping) {
          publicUrl = '';
          emit('disconnected', `Cloudflare tunnel stopped (${signal || code || 'unknown'}). LAN sharing is still available.`);
        }
      });
    });
  }

  async function stop() {
    const activeChild = child;
    stopping = true;
    child = null;
    publicUrl = '';
    if (!activeChild) {
      emit('stopped');
      return;
    }

    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(forceTimer);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        try { activeChild.kill('SIGKILL'); } catch {}
        finish();
      }, 3000);
      activeChild.once('exit', finish);
      try {
        if (!activeChild.kill('SIGTERM')) finish();
      } catch {
        finish();
      }
    });
    emit('stopped');
  }

  return {
    get child() {
      return child;
    },
    get publicUrl() {
      return publicUrl;
    },
    start,
    stop
  };
}

module.exports = {
  QUICK_TUNNEL_PATTERN,
  createTunnelManager
};
