/**
 * Focused re-capture of desktop evidence 06 (providers Edit affordances).
 *
 * Why this exists: the original batch capture waited for `.provider-model-row`
 * with a SILENT catch and screenshotted the loading/empty state when it never
 * appeared — weak evidence, flagged honestly to the owner, who ordered a
 * re-capture with the seeded provider and Edit buttons actually visible.
 *
 * This script is hard-fail by design: if the catalog, the provider row, the
 * auto-selected detail pane, the model rows, or the Edit buttons do not
 * appear, it errors out instead of capturing garbage.
 *
 * Run: xvfb-run -a node scripts/recapture-06-providers.mjs
 */
import { _electron } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outPath = '/home/z/my-project/download/desktop-evidence/06-settings-providers-edit.png';
const dbPath = join(mkdtempSync(join(tmpdir(), 'xeo-recap-')), 'recapture.db');
const port = 3100;
const base = `http://127.0.0.1:${port}`;

const electronApp = await _electron.launch({
  args: ['.'],
  executablePath: join(root, 'node_modules', 'electron', 'dist', 'electron'),
  cwd: root,
  env: {
    ...process.env,
    DATABASE_URL: '', // globally preset in this machine — must be empty for SQLite
    DB_PATH: dbPath,
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    XEO_DESKTOP_LOCAL: '1',
    XEO_DISABLE_UPDATES: '1',
  },
  timeout: 90_000,
});

const errors = [];
try {
  const window = await electronApp.firstWindow();
  window.on('pageerror', (e) => errors.push(String(e)));
  await window.context().addInitScript(() => localStorage.setItem('xeo-theme', 'dark'));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2500);

  // ── Seed through the LIVE API: one provider, THREE models so per-model
  // Edit/Pause/Delete rows are actually visible (the item-2 acceptance). ──
  const providerRes = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Scripted Provider', slug: 'scripted', baseUrl: 'http://127.0.0.1:8899/v1', apiKey: 'sk-capture-not-real' }),
  });
  const providerBody = await providerRes.json();
  if (!providerRes.ok) throw new Error(`provider seed failed: ${JSON.stringify(providerBody)}`);
  const providerId = providerBody.provider.id;

  const models = [
    { name: 'Kimi K3 (scripted)', modelId: 'kimi-k3', contextWindow: 131072, maxTokens: 4096, temperature: 0.6 },
    { name: 'Kimi K2 (scripted)', modelId: 'kimi-k2', contextWindow: 131072, maxTokens: 4096, temperature: 0.6 },
    { name: 'Kimi Mini (scripted)', modelId: 'kimi-mini', contextWindow: 32768, maxTokens: 2048, temperature: 0.4 },
  ];
  for (const m of models) {
    const r = await fetch(`${base}/api/providers/${providerId}/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(m),
    });
    if (!r.ok) throw new Error(`model seed failed for ${m.modelId}: ${await r.text()}`);
  }
  console.log('[seed] provider + 3 models live-API seeded');

  // ── Navigate and HARD-wait. No silent catches. ──
  await window.goto(`${base}/settings/providers`, { waitUntil: 'domcontentloaded' });
  await window.waitForSelector('.provider-list-row', { timeout: 45_000 }); // throws on timeout — honest failure
  await window.waitForSelector('.provider-model-row', { timeout: 20_000 });
  await window.waitForTimeout(600); // chips/buttons settle

  // ── Content assertions: the evidence must SHOW what it claims. ──
  const listText = (await window.locator('.provider-list-row').first().innerText()).replace(/\n/g, ' ');
  if (!listText.includes('Scripted Provider')) throw new Error(`provider row wrong: "${listText}"`);
  if (!/3 models/.test(listText)) throw new Error(`model count not 3 in row: "${listText}"`);

  const detailName = await window.locator('.provider-detail-title h3').innerText();
  if (!detailName.includes('Scripted Provider')) throw new Error(`detail pane not auto-selected: "${detailName}"`);

  const modelRows = await window.locator('.provider-model-row').count();
  if (modelRows !== 3) throw new Error(`expected 3 model rows, got ${modelRows}`);

  const editButtons = await window.locator('button:has-text("Edit")').count();
  if (editButtons < 2) throw new Error(`expected provider Edit + per-model Edits (>=2), got ${editButtons}`);

  const headButtons = await window.locator('.provider-detail-head button').allInnerTexts();
  console.log(`[verify] detail="${detailName}" modelRows=${modelRows} editButtons=${editButtons} headActions=${JSON.stringify(headButtons)}`);

  await window.screenshot({ path: outPath });
  console.log(`captured: ${outPath}`);
  console.log(JSON.stringify({ ok: true, modelRows, editButtons, pageErrors: errors }));
} finally {
  await electronApp.close().catch(() => {});
  try { rmSync(dbPath, { force: true }); } catch {}
}
