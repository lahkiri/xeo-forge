/**
 * Desktop LIVE evidence capture (v1.25 desktop-parity batch).
 *
 * Boots the REAL Electron shell (main.cjs spawns the standalone Next server),
 * under xvfb on this headless machine, seeds data through the live API, and
 * captures the fixed surfaces:
 *
 *   01 custom titlebar (frame:false) on the home surface
 *   02 sidebar session titles (stored title vs honest legacy fallback)
 *   03 work surface: decision gate + governance rail with the model switcher
 *   04 settings/sandbox section (executor-owned tier data)
 *   05 settings/runtime: pairing-based browser setup (no token copying)
 *   06 settings/providers: Edit buttons on provider and model rows
 *
 * Evidence lands in /home/z/my-project/download/desktop-evidence/.
 */
import { _electron } from 'playwright';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = '/home/z/my-project/download/desktop-evidence';
mkdirSync(outDir, { recursive: true });
const dbPath = join(mkdtempSync(join(tmpdir(), 'xeo-capture-')), 'capture.db');
const port = 3100;
const base = `http://127.0.0.1:${port}`;

const electronApp = await _electron.launch({
  args: ['.'],
  executablePath: join(root, 'node_modules', 'electron', 'dist', 'electron'),
  cwd: root,
  env: {
    ...process.env,
    DB_PATH: dbPath,
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    XEO_DESKTOP_LOCAL: '1',
    XEO_DISABLE_UPDATES: '1',
  },
  timeout: 90_000,
});

async function shot(window, name) {
  await window.screenshot({ path: join(outDir, name) });
  console.log(`captured: ${name}`);
}

try {
  const window = await electronApp.firstWindow();
  // Dark forge identity before the app renders.
  await window.context().addInitScript(() => localStorage.setItem('xeo-theme', 'dark'));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2500);

  // ── Seed through the LIVE API (implicit local owner in desktop mode) ──
  const providerRes = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Scripted Provider', slug: 'scripted', baseUrl: 'http://127.0.0.1:8899/v1', apiKey: 'sk-capture-not-real' }),
  });
  const providerBody = await providerRes.json();
  if (!providerRes.ok) throw new Error(`provider seed failed: ${JSON.stringify(providerBody)}`);
  const providerId = providerBody.provider.id;
  const modelRes = await fetch(`${base}/api/providers/${providerId}/models`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Kimi K3 (scripted)', modelId: 'kimi-k3', contextWindow: 131072, maxTokens: 4096, temperature: 0.6 }),
  });
  const modelBody = await modelRes.json();
  if (!modelRes.ok) throw new Error(`model seed failed: ${JSON.stringify(modelBody)}`);
  const modelId = modelBody.model.id;

  const chatRes = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'Fix the flaky auth session test and add regression coverage', mode: 'chat' }),
  });
  const chatBody = await chatRes.json();
  if (!chatRes.ok) throw new Error(`chat seed failed: ${JSON.stringify(chatBody)}`);

  const greetingRes = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'اهلا', mode: 'chat' }),
  });
  if (!greetingRes.ok) throw new Error('greeting seed failed');

  const workRes = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'Audit the error handling across the API routes and report every silent failure', surface: 'work', mode: 'build', providerId, providerModelId: modelId }),
  });
  const workBody = await workRes.json();
  if (!workRes.ok) throw new Error(`work seed failed: ${JSON.stringify(workBody)}`);

  // Settings surfaces FIRST — the order the probe verified works. Then the
  // app surfaces (chat/work) which open live SSE streams.
  // ── 01: settings sandbox (executor-owned tier cards) ──
  await window.goto(`${base}/settings/sandbox`, { waitUntil: 'domcontentloaded' });
  await window.waitForTimeout(8000); // docker probe + tier fetch settle (verified: 3 panels)
  const panelCount = await window.locator('section.settings-panel').count();
  console.log(`[sandbox panels: ${panelCount}]`);
  await shot(window, '04-settings-sandbox.png');

  // ── 02: settings runtime (pairing UI, no-token flow) ──
  await window.goto(`${base}/settings/runtime`, { waitUntil: 'domcontentloaded' });
  await window.waitForSelector('.browser-setup-steps', { timeout: 25_000 }).catch(() => {});
  await window.waitForTimeout(3200); // pairing poll interval
  await shot(window, '05-settings-runtime-pairing.png');

  // ── 03: settings providers edit affordances ──
  await window.goto(`${base}/settings/providers`, { waitUntil: 'domcontentloaded' });
  await window.waitForSelector('.provider-model-row', { timeout: 25_000 }).catch(() => {});
  await window.waitForTimeout(400);
  await shot(window, '06-settings-providers-edit.png');

  // ── 04: home surface with the custom titlebar ──
  await window.goto(`${base}/chat`, { waitUntil: 'domcontentloaded' });
  await window.waitForTimeout(1800);
  await shot(window, '01-desktop-titlebar-home.png');

  // ── 05: sidebar session titles ──
  const sidebar = window.locator('.codex-sidebar');
  await sidebar.screenshot({ path: join(outDir, '02-sidebar-session-titles.png') });
  console.log('captured: 02-sidebar-session-titles.png');

  // ── 06: work surface — decision gate + rail model switcher ──
  await window.goto(`${base}/work/${workBody.task.id}`, { waitUntil: 'domcontentloaded' });
  await window.waitForTimeout(2500);
  await shot(window, '03-work-decision-gate-model-rail.png');

  // Console errors, if any, are honest evidence too.
  console.log(JSON.stringify({ ok: true, dbPath, outDir, taskId: workBody.task.id }));
} finally {
  await electronApp.close().catch(() => {});
  try { rmSync(dbPath, { force: true }); } catch {}
}
