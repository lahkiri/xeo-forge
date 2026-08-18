import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const port = Number(process.env.XEO_SMOKE_PORT || 3212);
const brokerPort = Number(process.env.XEO_SMOKE_BROKER_PORT || 4318);
const dbPath = join(tmpdir(), `xeo-forge-smoke-${process.pid}.db`);
const electronBinary = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const electronVersion = (await import('electron/package.json', { with: { type: 'json' } })).default.version;
const serverPath = join(root, '.next', 'standalone', 'server.js');
const brokerBinary = join(root, 'desktop', 'native', process.platform === 'win32' ? 'xeo-forge-runtime-broker.exe' : 'xeo-forge-runtime-broker');

if (!existsSync(serverPath)) throw new Error('Missing standalone server. Run npm run desktop:prepare first.');
if (!existsSync(electronBinary)) throw new Error(`Missing Electron binary: ${electronBinary}`);
if (!existsSync(brokerBinary)) throw new Error(`Missing runtime broker: ${brokerBinary}`);

await rm(dbPath, { force: true });

const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '1',
  NODE_ENV: 'production',
  XEO_DESKTOP_LOCAL: '1',
  DB_PATH: dbPath,
  XEO_RUNTIME_PORT: String(brokerPort),
  PORT: String(port),
  HOSTNAME: '127.0.0.1',
};
const server = spawn(electronBinary, [serverPath], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
const broker = spawn(brokerBinary, [], {
  cwd: root,
  env: { ...process.env, XEO_RUNTIME_ADDR: `127.0.0.1:${brokerPort}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stop = () => {
  if (!server.killed) server.kill();
  if (!broker.killed) broker.kill();
};

async function waitFor(url, label, attempts = 80) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return response;
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready: ${lastError?.message || 'unknown error'}`);
}

try {
  const home = await waitFor(`http://127.0.0.1:${port}/`, 'Local Workbench');
  if (home.status !== 307 || home.headers.get('location') !== '/dashboard') {
    throw new Error(`Expected / to redirect to /dashboard, got HTTP ${home.status} ${home.headers.get('location') || ''}`);
  }

  const me = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
  const meBody = await me.json();
  if (me.status !== 200 || meBody.user?.email !== 'local-owner@xeo-forge.local') {
    throw new Error(`Expected implicit local owner, got HTTP ${me.status}: ${JSON.stringify(meBody)}`);
  }

  const register = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Should Not Register', email: 'blocked@example.com', password: 'password123' }),
  });
  if (register.status !== 409) {
    throw new Error(`Expected local register to be disabled, got HTTP ${register.status}`);
  }

  const runtime = await waitFor(`http://127.0.0.1:${brokerPort}/healthz`, 'Runtime broker');
  if (runtime.status !== 200) throw new Error(`Runtime broker health check returned HTTP ${runtime.status}`);
  const runtimeApi = await fetch(`http://127.0.0.1:${port}/api/runtime`);
  const runtimeBody = await runtimeApi.json();
  if (runtimeApi.status !== 200 || runtimeBody.mode !== 'native' || runtimeBody.available !== true) {
    throw new Error(`Expected native runtime, got HTTP ${runtimeApi.status}: ${JSON.stringify(runtimeBody)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    checks: ['local-root-redirect', 'implicit-local-owner', 'register-disabled', 'native-runtime-health'],
    dbPath,
    electronVersion,
  }, null, 2));
} finally {
  stop();
  await rm(dbPath, { force: true });
}
