import { spawn, spawnSync } from 'node:child_process';
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

async function removeDatabase() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(dbPath, { force: true });
      return;
    } catch (error) {
      if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  await rm(dbPath, { force: true });
}

await removeDatabase();

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
const server = spawn(electronBinary, [serverPath], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});
const broker = spawn(brokerBinary, [], {
  cwd: root,
  env: { ...process.env, XEO_RUNTIME_ADDR: `127.0.0.1:${brokerPort}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function stopChild(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
  return Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

async function stop() {
  await Promise.all([stopChild(server), stopChild(broker)]);
}

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
  if (home.status !== 307 || home.headers.get('location') !== '/chat') {
    throw new Error(`Expected / to redirect to /chat, got HTTP ${home.status} ${home.headers.get('location') || ''}`);
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

  const chat = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'Smoke chat: answer briefly without planning.', mode: 'chat', projectPath: root }),
  });
  const chatBody = await chat.json();
  if (chat.status !== 201 || chatBody.task?.mode !== 'chat' || chatBody.task?.project_path !== root) {
    throw new Error(`Expected a local chat thread with project path, got HTTP ${chat.status}: ${JSON.stringify(chatBody)}`);
  }

  const direct = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'نفذ إصلاحًا مباشرًا لهذا المشروع', surface: 'work', mode: 'build', projectPath: root }),
  });
  const directBody = await direct.json();
  if (direct.status !== 202 || directBody.task?.status !== 'awaiting_decision' || directBody.decision?.expiresAt == null) {
    throw new Error(`Expected direct Work request to await a decision, got HTTP ${direct.status}: ${JSON.stringify(directBody)}`);
  }

  const runtime = await waitFor(`http://127.0.0.1:${brokerPort}/healthz`, 'Runtime broker');
  if (runtime.status !== 200) throw new Error(`Runtime broker health check returned HTTP ${runtime.status}`);
  const runtimeApi = await fetch(`http://127.0.0.1:${port}/api/runtime`);
  const runtimeBody = await runtimeApi.json();
  if (runtimeApi.status !== 200 || runtimeBody.mode !== 'native' || runtimeBody.available !== true) {
    throw new Error(`Expected native runtime, got HTTP ${runtimeApi.status}: ${JSON.stringify(runtimeBody)}`);
  }

  /* ── REAL terminal check ──────────────────────────────────────────
   * v1.13.0 shipped with node-pty's native binaries missing from the
   * packaged app: the app booted, every check above passed, and the FIRST
   * terminal on a user machine failed with "Failed to load native module:
   * conpty.node". Boot-level checks cannot catch that — this block spawns a
   * REAL PTY through the standalone server under Electron, types into it,
   * and requires the shell's echo back before the smoke test may pass.
   * ─────────────────────────────────────────────────────────────────── */
  const termCreate = await fetch(`http://127.0.0.1:${port}/api/tasks/${directBody.task.id}/terminal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const termBody = await termCreate.json().catch(() => ({}));
  if (termCreate.status !== 201 || typeof termBody.id !== 'string') {
    throw new Error(
      `Terminal session could not start (HTTP ${termCreate.status}): ${JSON.stringify(termBody).slice(0, 300)}` +
        ' — native PTY module is missing or unloadable in the packaged runtime.',
    );
  }

  // Stream the session and wait for the shell to echo a unique marker back.
  const SMOKE_MARKER = `XEO_PTY_SMOKE_${process.pid}`;
  const markerSeen = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`PTY output stream never echoed "${SMOKE_MARKER}" — the terminal is not executing commands.`)),
      20_000,
    );
    timer.unref?.();
    fetch(`http://127.0.0.1:${port}/api/tasks/${directBody.task.id}/terminal/${termBody.id}/stream`).then((stream) => {
      const reader = stream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (buffer.includes(SMOKE_MARKER)) {
              clearTimeout(timer);
              reader.cancel().catch(() => {});
              resolve(true);
              return;
            }
          }
          reject(new Error('PTY stream closed before the marker was echoed.'));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    }).catch(reject);
  });
  await fetch(`http://127.0.0.1:${port}/api/tasks/${directBody.task.id}/terminal/${termBody.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: `echo ${SMOKE_MARKER}\r` }),
  });
  await markerSeen;

  // Clean exit: close the session so the smoke run leaves no live shell.
  await fetch(`http://127.0.0.1:${port}/api/tasks/${directBody.task.id}/terminal/${termBody.id}`, {
    method: 'DELETE',
  });

  console.log(JSON.stringify({
    ok: true,
    checks: ['local-root-redirect', 'implicit-local-owner', 'register-disabled', 'chat-mode-with-project-path', 'work-direct-awaits-decision', 'native-runtime-health', 'real-pty-terminal-spawn-exec-echo'],
    dbPath,
    electronVersion,
  }, null, 2));
} finally {
  await stop();
  await removeDatabase();
}
