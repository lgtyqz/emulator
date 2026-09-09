'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { build, Platform } = require('electron-builder');

const execFileAsync = promisify(execFile);

async function adHocSignMacApps(outputDirectory) {
  for (const entry of await fs.readdir(outputDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('mac')) continue;
    const contents = await fs.readdir(path.join(outputDirectory, entry.name));
    for (const name of contents.filter((value) => value.endsWith('.app'))) {
      await execFileAsync('/usr/bin/codesign', [
        '--force', '--deep', '--sign', '-', '--timestamp=none',
        path.join(outputDirectory, entry.name, name)
      ]);
    }
  }
}

async function packageApp() {
  const projectDir = path.resolve(__dirname, '..');
  const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rom-room-builder-'));
  const stagingOutput = path.join(stagingRoot, 'output');
  const finalOutput = path.join(projectDir, 'dist');
  const directoryOnly = process.argv.includes('--dir');
  if (directoryOnly) process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

  try {
    await build({
      projectDir,
      targets: Platform.current().createTarget(directoryOnly ? 'dir' : undefined),
      config: { directories: { output: stagingOutput } }
    });
    if (directoryOnly && process.platform === 'darwin') await adHocSignMacApps(stagingOutput);
    // electron-builder normally owns and cleans its output directory. Replace
    // the generated tree as a unit so stale files cannot invalidate signatures.
    await fs.rm(finalOutput, { recursive: true, force: true });
    try {
      await fs.rename(stagingOutput, finalOutput);
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      await fs.cp(stagingOutput, finalOutput, {
        recursive: true,
        force: true,
        preserveTimestamps: true,
        verbatimSymlinks: true
      });
    }
    process.stdout.write(`Build output copied to ${finalOutput}\n`);
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

packageApp().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
