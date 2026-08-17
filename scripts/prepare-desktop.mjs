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

await mkdir(join(standalone, '.next'), { recursive: true });
await cp(staticSource, staticTarget, { recursive: true, force: true });
if (existsSync(publicSource)) await cp(publicSource, publicTarget, { recursive: true, force: true });

await rm(nativeTarget, { recursive: true, force: true });
await mkdir(nativeTarget, { recursive: true });
const targets = [
  { goos: 'linux', goarch: 'amd64', name: 'xeo-forge-runtime-broker' },
  { goos: 'windows', goarch: 'amd64', name: 'xeo-forge-runtime-broker.exe' },
];
for (const target of targets) {
  const result = spawnSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', join(nativeTarget, target.name), '.'], {
    cwd: brokerSource,
    env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: '0' },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`Could not build broker for ${target.goos}/${target.goarch}`);
}
console.log('[desktop] prepared standalone app and native broker binaries');
