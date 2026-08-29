/** Focused probe: what throws on /settings/sandbox inside the desktop shell? */
import { _electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dbPath = join(mkdtempSync(join(tmpdir(), 'xeo-probe-')), 'probe.db');

const app = await _electron.launch({
  args: ['.'],
  executablePath: join(root, 'node_modules', 'electron', 'dist', 'electron'),
  cwd: root,
  env: { ...process.env, DB_PATH: dbPath, PORT: '3100', HOSTNAME: '127.0.0.1', XEO_DESKTOP_LOCAL: '1', XEO_DISABLE_UPDATES: '1' },
  timeout: 90_000,
});
try {
  const window = await app.firstWindow();
  window.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' || text.includes('sandbox')) console.log(`[console.${message.type()}]`, text.slice(0, 400));
  });
  window.on('pageerror', (error) => console.log('[pageerror]', String(error).slice(0, 600)));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);
  const api = await window.evaluate(async () => {
    const res = await fetch('/api/sandbox');
    const text = await res.text();
    return { status: res.status, body: text.slice(0, 300) };
  });
  console.log('[api/sandbox]', JSON.stringify(api));
  await window.goto('http://127.0.0.1:3100/settings/sandbox', { waitUntil: 'domcontentloaded' });
  await window.waitForTimeout(2500);
  console.log('[done]');
} finally {
  await app.close().catch(() => {});
}
