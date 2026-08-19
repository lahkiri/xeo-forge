import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const packageJson = require('../package.json') as { version: string };
const validator = path.resolve(process.cwd(), 'scripts/verify-release-artifacts.mjs');

function sha512(value: Buffer) {
  return createHash('sha512').update(value).digest('base64');
}

function writeFixture(channel: 'latest' | 'beta') {
  const directory = mkdtempSync(path.join(tmpdir(), 'xeo-release-'));
  const version = packageJson.version;
  const windowsName = `Xeo-Forge-Setup-${version}-x64.exe`;
  const blockmapName = `${windowsName}.blockmap`;
  const appImageName = `Xeo-Forge-${version}.AppImage`;
  const debName = `xeo-forge_${version}_amd64.deb`;
  const artifacts = new Map([
    [windowsName, Buffer.from(`windows-${channel}`)],
    [blockmapName, Buffer.from(`blockmap-${channel}`)],
    [appImageName, Buffer.from(`appimage-${channel}`)],
    [debName, Buffer.from(`deb-${channel}`)],
  ]);
  for (const [name, content] of artifacts) writeFileSync(path.join(directory, name), content);

  const feed = (name: string, content: Buffer, entries = [{ name, content }]) => [
    `version: ${version}`,
    `path: ${name}`,
    `sha512: ${sha512(content)}`,
    'files:',
    ...entries.flatMap((entry) => [
      `  - url: ${entry.name}`,
      `    sha512: ${sha512(entry.content)}`,
      `    size: ${entry.content.length}`,
    ]),
    '',
  ].join('\n');

  writeFileSync(path.join(directory, `${channel}.yml`), feed(windowsName, artifacts.get(windowsName) as Buffer));
  writeFileSync(path.join(directory, `${channel}-linux.yml`), feed(appImageName, artifacts.get(appImageName) as Buffer, [
    { name: appImageName, content: artifacts.get(appImageName) as Buffer },
    { name: debName, content: artifacts.get(debName) as Buffer },
  ]));
  return directory;
}

describe('release artifact channels', () => {
  it.each(['latest', 'beta'] as const)('validates the %s feed and matching artifacts', (channel) => {
    const directory = writeFixture(channel);
    try {
      expect(() => execFileSync(process.execPath, [validator, directory, 'all', channel], { encoding: 'utf8' })).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when the requested channel feed is absent', () => {
    const directory = writeFixture('beta');
    try {
      expect(() => execFileSync(process.execPath, [validator, directory, 'all', 'latest'], { encoding: 'utf8', stdio: 'pipe' })).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
