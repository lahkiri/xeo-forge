import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.XEO_CAPTURE_URL || 'http://127.0.0.1:3000';
const videoDir = new URL('../.task-notes/video-recordings/', import.meta.url).pathname;
await fs.rm(videoDir, { recursive: true, force: true });
await fs.mkdir(videoDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 810 },
  deviceScaleFactor: 1,
  recordVideo: { dir: videoDir, size: { width: 1440, height: 810 } },
});
const page = await context.newPage();

await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.locator('input[type="email"]').fill('admin@example.com');
await page.locator('input[type="password"]').fill('XeoForgeLocal!2026');
await page.waitForTimeout(500);
await page.getByRole('button', { name: /sign in|log in|login/i }).click();
await page.waitForURL(/dashboard/, { timeout: 15000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1800);

const profile = page.locator('#agent-profile');
const skill = page.locator('#agent-skill');
if (await profile.count()) await profile.selectOption({ label: 'Builder Sentinel · builder' });
if (await skill.count()) await skill.selectOption({ label: 'Governed Ship Loop · build' });
const goal = page.locator('textarea[placeholder*="Describe what you want"]');
await goal.fill('Ship a small, well-tested improvement with an explicit approval checkpoint.');
await page.waitForTimeout(3500);

await page.getByRole('link', { name: /Prompt Studio/i }).click();
await page.waitForURL(/settings/);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight * 0.48, behavior: 'smooth' }));
await page.waitForTimeout(2200);
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
await page.waitForTimeout(3000);

await page.goto(`${baseURL}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
const dashboardProfile = page.locator('#agent-profile');
const dashboardSkill = page.locator('#agent-skill');
if (await dashboardProfile.count()) await dashboardProfile.selectOption({ label: 'Builder Sentinel · builder' });
if (await dashboardSkill.count()) await dashboardSkill.selectOption({ label: 'Governed Ship Loop · build' });
await page.locator('textarea[placeholder*="Describe what you want"]').fill('Prepare a governed implementation plan for a small, reversible UI improvement.');
await page.waitForTimeout(1800);
await page.getByRole('button', { name: /Run task/i }).click();
await page.waitForURL(/tasks\//, { timeout: 15000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(4500);

const contextTab = page.getByRole('button', { name: 'Context' });
if (await contextTab.count()) {
  await contextTab.click();
  await page.waitForTimeout(3500);
}
const timelineTab = page.getByRole('button', { name: 'Timeline' });
if (await timelineTab.count()) {
  await timelineTab.click();
  await page.waitForTimeout(3500);
}
const approveButton = page.getByRole('button', { name: /^approve$/i });
if (await approveButton.count() && await approveButton.isVisible()) {
  await approveButton.click();
  await page.waitForTimeout(3500);
}
await page.waitForTimeout(2500);

await context.close();
await browser.close();
const files = await fs.readdir(videoDir);
const video = files.find((file) => file.endsWith('.webm'));
if (!video) throw new Error('No Playwright recording was produced');
console.log(`${videoDir}/${video}`);
