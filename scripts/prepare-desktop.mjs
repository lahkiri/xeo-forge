import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const standalone = join(root, '.next', 'standalone');
const staticSource = join(root, '.next', 'static');
const staticTarget = join(standalone, '.next', 'static');
const publicSource = join(root, 'public');
const publicTarget = join(standalone, 'public');
const brokerSource = join(root, 'native', 'runtime-broker');
const nativeTarget = join(root, 'desktop', 'native');

if (!existsSync(join(standalone, 'server.js'))) {
  throw new Error('Missing .next/standalone/server.js. Run npm run build first.');
}

/**
 * Next standalone is produced with the host Node ABI, while Electron runs its
 * embedded Node ABI. Rebuild the NATIVE modules for Electron and replace the
 * copies traced into standalone; otherwise the packaged app starts but every
 * database request fails with ERR_DLOPEN_FAILED.
 *
 * node-pty is in this list for the same reason plus one more: its Windows
 * native binaries (conpty.node / pty.node, under build/Release and
 * prebuilds/win32-x64) are loaded at RUNTIME by path probing, which Next's
 * file tracer cannot follow — the tracer copies the JS but not the binaries.
 * v1.13.0 shipped exactly that hole: the app booted, the terminal answered
 * "Failed to load native module: conpty.node" on the user's machine, and the
 * boot-level smoke test never noticed. Rebuilding here AND copying the whole
 * package below closes both the ABI and the tracing gaps for every native
 * module this app loads.
 */
const electronVersion = process.env.ELECTRON_VERSION || (await import('electron/package.json', { with: { type: 'json' } })).default.version;
const rebuildCommand = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild',
);
if (!existsSync(rebuildCommand)) {
  throw new Error(`Missing local electron-rebuild executable: ${rebuildCommand}`);
}
const skipRebuild = process.env.XEO_SKIP_NATIVE_REBUILD === '1';
// The command must be quoted on Windows: spawnSync(shell: true) joins the
// command and args into one cmd.exe line, and an unquoted project path that
// contains a space (e.g. "C:\My Projects\xeo-forge") is split at the space —
// the shell then tries to run a nonexistent program instead of electron-rebuild.
const rebuild = skipRebuild ? { status: 0 } : spawnSync(process.platform === 'win32' ? `"${rebuildCommand}"` : rebuildCommand, [
  '--version',
  electronVersion,
  '--force',
  '--only',
  'better-sqlite3,node-pty',
], { cwd: root, env: process.env, stdio: 'inherit', shell: process.platform === 'win32' });
if (rebuild.error || rebuild.status !== 0) {
  const detail = rebuild.error?.message || `exit code ${rebuild.status}`;
  if (skipRebuild) {
    throw new Error(
      `Could not rebuild native modules for Electron ${electronVersion}: ${detail}`,
    );
  }
  throw new Error(
    `Could not rebuild native modules for Electron ${electronVersion}: ${detail}\n` +
      'Hints: (1) rebuilding native modules requires a C/C++ toolchain — on Windows install ' +
      '"Visual Studio Build Tools" with the "Desktop development with C++" workload; ' +
      '(2) if your project path contains spaces, node-gyp may still fail — prefer a space-free checkout path; ' +
      '(3) for a UI-only local run you can set XEO_SKIP_NATIVE_REBUILD=1 to skip this step, ' +
      'but then only run the standalone server with the same Node ABI it was built for.',
  );
}

/** Native modules whose standalone-traced copy must be replaced wholesale. */
const nativeModules = ['better-sqlite3', 'node-pty'];
for (const name of nativeModules) {
  const source = join(root, 'node_modules', name);
  const target = join(standalone, 'node_modules', name);
  if (!existsSync(source)) throw new Error(`Native dependency is missing: ${source}`);
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true, force: true });
}

// The packaged terminal must find its native binaries. This assertion is the
// gate for the v1.13.0 defect class: if the expected binary is absent, fail
// the PREPARE step, not the user's first terminal on their own machine.
const ptyDir = join(standalone, 'node_modules', 'node-pty');
const ptyBinaryPresent =
  existsSync(join(ptyDir, 'build', 'Release', process.platform === 'win32' ? 'conpty.node' : 'pty.node')) ||
  existsSync(join(ptyDir, 'prebuilds', `${process.platform}-${process.arch}`, 'pty.node'));
if (!ptyBinaryPresent) {
  throw new Error(
    `node-pty native binary missing under ${ptyDir} after copy — the packaged terminal would fail to start.`,
  );
}

await mkdir(join(standalone, '.next'), { recursive: true });
await cp(staticSource, staticTarget, { recursive: true, force: true });
if (existsSync(publicSource)) await cp(publicSource, publicTarget, { recursive: true, force: true });

await rm(nativeTarget, { recursive: true, force: true });
await mkdir(nativeTarget, { recursive: true });
const targets = [
  { goos: 'linux', goarch: 'amd64', name: 'xeo-forge-runtime-broker' },
  { goos: 'windows', goarch: 'amd64', name: 'xeo-forge-runtime-broker.exe' },
];
// The broker is an optional local-process supervisor: the shell boots without
// it (it warns and disables broker-backed features). Missing Go in a dev
// checkout is therefore a skip with a visible warning, not a hard failure —
// the packaged builds (CI runners) always have Go and produce both binaries.
const goCheck = spawnSync('go', ['version'], { stdio: 'ignore' });
const goMissing = !!goCheck.error || goCheck.status !== 0;
if (goMissing) {
  console.warn(
    '[desktop] Go toolchain not found — skipping runtime-broker builds; ' +
      'the shell will boot without the runtime broker (local process supervision is disabled).',
  );
}
if (!goMissing) for (const target of targets) {
  const result = spawnSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', join(nativeTarget, target.name), '.'], {
    cwd: brokerSource,
    env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: '0' },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`Could not build broker for ${target.goos}/${target.goarch}`);
}
console.log(`[desktop] prepared standalone app and native broker binaries for Electron ${electronVersion}`);
