'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const tar = require('tar');

const VERSION = '2026.8.3';
const projectRoot = path.resolve(__dirname, '..');
const cacheRoot = path.join(projectRoot, '.cache', 'cloudflared');
const assets = {
  'darwin-x64': {
    name: 'cloudflared-darwin-amd64.tgz',
    sha256: '61e1316266a00fd70ce40da011d612badc805367fb65293dd1925f938f704c99',
    archive: true
  },
  'darwin-arm64': {
    name: 'cloudflared-darwin-arm64.tgz',
    sha256: '40c9144d86df8937c5b43293a1f7d2d2107029aa74725023dd46b1b27154352f',
    archive: true
  },
  'linux-x64': {
    name: 'cloudflared-linux-amd64',
    sha256: 'f29324fe934d1e100617484c78deef803c4dc2cd351d645bbde42e96b4fccc5e'
  },
  'linux-arm64': {
    name: 'cloudflared-linux-arm64',
    sha256: '4bcfd35521a7cbc545ebfd5d57334a71ee180e2a64874981f374c81472118391'
  },
  'win32-x64': {
    name: 'cloudflared-windows-amd64.exe',
    sha256: '83e726ed18ea78c5ad5213c4c3a3a27051393950d2bc8ed4de69bec12d14eaae'
  }
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function verifyChecksum(contents, assetName, expected) {
  const actual = sha256(contents);
  if (actual !== expected) {
    throw new Error(`cloudflared checksum mismatch for ${assetName}: expected ${expected}, received ${actual}.`);
  }
}

function download(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many redirects while downloading cloudflared.'));
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'user-agent': 'ROM-Room-build' },
      timeout: 30000
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(new URL(response.headers.location, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`cloudflared download returned HTTP ${response.statusCode}.`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 100 * 1024 * 1024) {
          request.destroy(new Error('cloudflared download exceeded the expected size.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('cloudflared download timed out.')));
    request.on('error', reject);
  });
}

async function prepare(platform, arch) {
  const key = `${platform}-${arch}`;
  const asset = assets[key];
  if (!asset) throw new Error(`No pinned cloudflared ${VERSION} binary is available for ${key}.`);

  const destination = path.join(cacheRoot, key);
  const executable = path.join(destination, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const marker = path.join(destination, '.source-sha256');
  try {
    if ((await fs.readFile(marker, 'utf8')).trim() === asset.sha256) {
      await fs.access(executable);
      return executable;
    }
  } catch {}

  await fs.mkdir(destination, { recursive: true });
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${asset.name}`;
  process.stdout.write(`Downloading pinned cloudflared ${VERSION} for ${key}…\n`);
  const contents = await download(url);
  verifyChecksum(contents, asset.name, asset.sha256);

  if (asset.archive) {
    const archivePath = path.join(destination, asset.name);
    await fs.writeFile(archivePath, contents, { mode: 0o600 });
    await tar.x({ file: archivePath, cwd: destination, strict: true });
    await fs.rm(archivePath, { force: true });
  } else {
    await fs.writeFile(executable, contents, { mode: 0o755 });
  }
  try {
    const stats = await fs.stat(executable);
    if (!stats.isFile()) throw new Error('not a file');
    await fs.chmod(executable, 0o755);
  } catch {
    throw new Error(`The verified ${asset.name} artifact did not contain the expected cloudflared executable.`);
  }
  await fs.writeFile(marker, `${asset.sha256}\n`, 'utf8');
  return executable;
}

async function beforePack(context) {
  const { Arch } = require('builder-util');
  const arch = Arch[context.arch];
  await prepare(context.electronPlatformName, arch);
}

if (require.main === module) {
  prepare(process.platform, process.arch).then((executable) => {
    process.stdout.write(`${executable}\n`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  VERSION,
  assets,
  beforePack,
  prepare,
  sha256,
  verifyChecksum
};
