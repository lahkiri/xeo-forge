import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.XEO_CAPTURE_URL || 'http://127.0.0.1:3000';
const outputDir = new URL('../docs/screenshots/', import.meta.url).pathname;
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
await page.locator('input[type="email"]').fill('admin@example.com');
await page.locator('input[type="password"]').fill('XeoForgeLocal!2026');
await page.getByRole('button', { name: /sign in|log in|login/i }).click();
await page.waitForURL(/dashboard/, { timeout: 15000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1200);

const profile = page.locator('#agent-profile');
const skill = page.locator('#agent-skill');
if (await profile.count()) await profile.selectOption({ label: 'Builder Sentinel · builder' });
if (await skill.count()) await skill.selectOption({ label: 'Governed Ship Loop · build' });
await page.waitForTimeout(250);
  await page.locator('textarea').first().fill('Ship a small, well-tested improvement with an explicit approval checkpoint.');
await page.screenshot({ path: `${outputDir}/dashboard-v3.png`, fullPage: true });

await page.goto(`${baseURL}/settings`, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${outputDir}/context-studio-v3.png`, fullPage: true });

const response = await page.request.post(`${baseURL}/api/tasks`, {
  data: {
    goal: 'Prepare a governed implementation plan for a small, reversible UI improvement.',
    profileId: (await profile.count()) ? await profile.inputValue().catch(() => null) : null,
    skillId: (await skill.count()) ? await skill.inputValue().catch(() => null) : null,
  },
});
let taskId = null;
if (response.ok()) {
  const payload = await response.json();
  taskId = payload?.task?.id || null;
}
if (!taskId) {
  await page.goto(`${baseURL}/dashboard`, { waitUntil: 'networkidle' });
  const taskLink = page.locator('a[href^="/tasks/"]').first();
  if (await taskLink.count()) taskId = (await taskLink.getAttribute('href')).split('/').pop();
}
if (taskId) {
  await page.goto(`${baseURL}/tasks/${taskId}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${outputDir}/governed-run-v3.png`, fullPage: true });
}

await browser.close();
console.log(JSON.stringify({ outputDir, taskId }, null, 2));
