#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const distDir = resolve(process.argv[2] || 'dist');
const target = process.argv[3] || 'all';
if (!['all', 'windows', 'linux'].includes(target)) throw new Error(`Unknown target: ${target}`);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageJson.version;
const failures = [];

function fail(message) {
  failures.push(message);
}

function requiredFile(name) {
  const path = join(distDir, name);
  if (!existsSync(path)) {
    fail(`missing artifact: ${name}`);
    return null;
  }
  return path;
}

function parseFeed(fileName) {
  const path = requiredFile(fileName);
  if (!path) return null;
  const text = readFileSync(path, 'utf8');
  const versionMatch = text.match(/^version:\s*(\S+)\s*$/m);
  const pathMatch = text.match(/^path:\s*([^\n]+?)\s*$/m);
  const shaMatch = text.match(/^sha512:\s*([^\n]+?)\s*$/m);
  const sizeMatch = text.match(/^size:\s*(\d+)\s*$/m);
  const files = [...text.matchAll(/^\s*-\s+url:\s*([^\n]+?)\s*\n\s+sha512:\s*([^\n]+?)\s*\n\s+size:\s*(\d+)\s*$/gm)].map((match) => ({
    name: match[1].trim(),
    sha512: match[2].trim(),
    size: Number(match[3]),
  }));
  if (!versionMatch || !pathMatch || !shaMatch) {
    fail(`${fileName}: missing required feed fields (version/path/sha512)`);
    return null;
  }
  const feedPath = pathMatch[1].trim();
  const pathEntry = files.find((entry) => entry.name === feedPath);
  const feedSize = sizeMatch ? Number(sizeMatch[1]) : pathEntry?.size;
  if (!Number.isFinite(feedSize)) {
    fail(`${fileName}: missing size for ${feedPath}`);
    return null;
  }
  if (versionMatch[1] !== version) fail(`${fileName}: version ${versionMatch[1]} does not match package ${version}`);
  return {
    fileName,
    path: feedPath,
    sha512: shaMatch[1].trim(),
    size: feedSize,
    files,
  };
}

function sha512Base64(filePath) {
  return createHash('sha512').update(readFileSync(filePath)).digest('base64');
}

function verifyEntry(feedName, entry) {
  const artifactPath = requiredFile(entry.name);
  if (!artifactPath) return;
  const actualSize = statSync(artifactPath).size;
  if (actualSize !== entry.size) {
    fail(`${feedName}: ${entry.name} size ${entry.size} does not match actual ${actualSize}`);
  }
  const actualSha = sha512Base64(artifactPath);
  if (actualSha !== entry.sha512) {
    fail(`${feedName}: ${entry.name} sha512 does not match feed`);
  }
}

const windowsFeed = target === 'linux' ? null : parseFeed('latest.yml');
const linuxFeed = target === 'windows' ? null : parseFeed('latest-linux.yml');
const distEntries = existsSync(distDir) ? readdirSync(distDir) : [];
const windowsExe = distEntries.find((name) => /^Xeo-Forge-Setup-.*-x64\.exe$/i.test(name));
const windowsBlockmap = distEntries.find((name) => /^Xeo-Forge-Setup-.*-x64\.exe\.blockmap$/i.test(name));
const linuxAppImage = distEntries.find((name) => /\.AppImage$/i.test(name));
const linuxDeb = distEntries.find((name) => /\.deb$/i.test(name));
if (target !== 'linux' && !windowsExe) fail('missing Windows NSIS installer (*.exe)');
if (target !== 'linux' && !windowsBlockmap) fail('missing Windows blockmap (*.exe.blockmap)');
if (target !== 'windows' && !linuxAppImage) fail('missing Linux AppImage');
if (target !== 'windows' && !linuxDeb) fail('missing Linux deb package');

if (windowsFeed) {
  if (!windowsExe || windowsFeed.path !== windowsExe) fail(`latest.yml path ${windowsFeed.path} does not match Windows installer ${windowsExe || '(missing)'}`);
  verifyEntry('latest.yml', { name: windowsFeed.path, sha512: windowsFeed.sha512, size: windowsFeed.size });
  if (!windowsBlockmap) fail('latest.yml cannot be trusted without the matching Windows blockmap');
}
if (linuxFeed) {
  if (!linuxAppImage || linuxFeed.path !== linuxAppImage) fail(`latest-linux.yml path ${linuxFeed.path} does not match AppImage ${linuxAppImage || '(missing)'}`);
  verifyEntry('latest-linux.yml', { name: linuxFeed.path, sha512: linuxFeed.sha512, size: linuxFeed.size });
  for (const entry of linuxFeed.files) verifyEntry('latest-linux.yml', entry);
}

if (failures.length > 0) {
  console.error('Release artifact verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Release artifacts verified for v${version} (${target}) in ${distDir}`);
if (target !== 'linux') console.log(`- Windows: ${windowsExe}, ${windowsBlockmap}, latest.yml`);
if (target !== 'windows') console.log(`- Linux: ${linuxAppImage}, ${linuxDeb}, latest-linux.yml`);
