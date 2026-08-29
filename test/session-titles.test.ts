import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';

/**
 * Session titles (desktop-parity batch, Phase 1.2).
 *
 * The live report: a sidebar where every thread is literally titled "اهلا" —
 * the raw first message — with no way to tell sessions apart. Titles are now
 * derived deterministically: a real opener becomes a bidi-safe truncated
 * title; a greeting-only opener stays untitled until the first assistant
 * answer fills it from the first real exchange.
 */

import {
  SESSION_TITLE_MAX,
  deriveSessionTitle,
  deriveTitleFromExchange,
  displaySessionLabel,
  relativeDayLabel,
  truncateBidiSafe,
} from '../lib/agent/session-title';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-session-title-'));
process.env.DB_PATH = path.join(tempDir, 'session-title.sqlite');

let db: typeof import('../lib/db/index').db;
let initSchema: typeof import('../lib/db/schema').initSchema;
let createUser: typeof import('../lib/db/queries').createUser;
let createTask: typeof import('../lib/db/queries').createTask;
let appendMessage: typeof import('../lib/db/queries').appendMessage;
let refreshSessionTitle: typeof import('../lib/db/queries').refreshSessionTitle;
let getTaskById: typeof import('../lib/db/queries').getTaskById;

beforeAll(async () => {
  const schema = await import('../lib/db/schema');
  const queries = await import('../lib/db/queries');
  const database = await import('../lib/db/index');
  initSchema = schema.initSchema;
  createUser = queries.createUser;
  createTask = queries.createTask;
  appendMessage = queries.appendMessage;
  refreshSessionTitle = queries.refreshSessionTitle;
  getTaskById = queries.getTaskById;
  db = database.db;
  await initSchema();
});

afterAll(async () => {
  await db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('deriveSessionTitle — deterministic, bidi-safe', () => {
  it('derives a truncated title from a real Arabic opener', () => {
    const title = deriveSessionTitle('هل يمكن أن تشرح لي كيف يعمل نظام الصلاحيات في هذا المشروع بالتفصيل');
    expect(title).toBeTruthy();
    expect(title!.length).toBeLessThanOrEqual(SESSION_TITLE_MAX + 1); // +1 for the ellipsis
    expect(title!.endsWith('…') || Array.from(title!).length <= SESSION_TITLE_MAX).toBe(true);
  });

  it('never returns the raw greeting as a title', () => {
    for (const greeting of ['اهلا', 'أهلا', 'مرحبا', 'hello', 'Hello!', 'hey there', 'السلام عليكم', 'hi 👋'.replace(' 👋', '')]) {
      expect(deriveSessionTitle(greeting)).toBeNull();
    }
  });

  it('truncates on a word boundary, not mid-word', () => {
    const short = 'implement the retry ladder honestly';
    expect(deriveSessionTitle(short)).toBe(short); // under the cap: untouched
    const long = 'implement the provider retry ladder with honest backoff reporting';
    const longer = `${long} and then wire the audit event for every ladder rung end to end`;
    const cut = deriveSessionTitle(longer)!;
    expect(cut.endsWith('…')).toBe(true);
    expect(Array.from(cut).length).toBeLessThanOrEqual(SESSION_TITLE_MAX + 1);
    // The cut stays a prefix of the original (word-boundary walk-back), and
    // the word before the ellipsis is a real word, not a fragment.
    expect(longer.startsWith(cut.slice(0, -1))).toBe(true);
    expect(cut.slice(0, -1).split(' ').pop()!.length).toBeGreaterThan(1);
  });

  it('does not strand bidi control marks or whitespace at the cut', () => {
    const text = 'اولا\tهذا نص طويل جدا يتجاوز الحد المسموب ويجب ان يقتم عند حد الكلمات تماما بدون كسر';
    const cut = truncateBidiSafe(text, 30);
    expect(cut.length).toBeLessThanOrEqual(31);
    expect(cut.endsWith('\u200f')).toBe(false);
    expect(cut.endsWith('\u200e')).toBe(false);
  });
});

describe('deriveTitleFromExchange — the first real exchange wins', () => {
  it('prefers the opener when it carries content, else the answer', () => {
    expect(deriveTitleFromExchange('Fix the flaky auth test', null)).toBe('Fix the flaky auth test');
    expect(deriveTitleFromExchange('اهلا', 'Sure — the race is in the token refresh logic and here is the fix')).toContain('…');
    expect(deriveTitleFromExchange('اهلا', null)).toBeNull();
  });
});

describe('refreshSessionTitle — greeting openers adopt the first exchange', () => {
  it('fills a NULL title from the first assistant answer', async () => {
    const user = await createUser({
      email: `title-${Date.now()}@example.test`,
      passwordHash: 'test-hash',
      displayName: 'Title Tester',
    });
    const task = await createTask({
      userId: user.id,
      goal: 'اهلا',
      mode: 'chat',
      title: deriveSessionTitle('اهلا'), // greeting-only → NULL at creation
    });
    expect(task.title).toBeNull();

    await appendMessage(task.id, 'user', 'اهلا');
    await appendMessage(task.id, 'assistant', 'مرحبا! كيف أستطيع مساعدتك اليوم؟ يمكنني البدء بفحص الأخطاء في مشروعك.');
    await refreshSessionTitle(task.id);

    const updated = await getTaskById(task.id);
    expect(updated!.title).toBeTruthy();
    expect(updated!.title).not.toBe('اهلا');
    expect(updated!.title).toContain('…'); // truncated from the answer
  });

  it('keeps a real opener title even after answers arrive (single-shot fill)', async () => {
    const user = await createUser({
      email: `title-keep-${Date.now()}@example.test`,
      passwordHash: 'test-hash',
      displayName: 'Title Keeper',
    });
    const task = await createTask({
      userId: user.id,
      goal: 'Fix the flaky auth session test',
      mode: 'chat',
      title: deriveSessionTitle('Fix the flaky auth session test'),
    });
    expect(task.title).toBe('Fix the flaky auth session test');
    await appendMessage(task.id, 'user', 'Fix the flaky auth session test');
    await appendMessage(task.id, 'assistant', 'Sure — the race is in the token refresh.');
    await refreshSessionTitle(task.id);
    expect((await getTaskById(task.id))!.title).toBe('Fix the flaky auth session test');
  });
});

describe('display contract — legacy rows and temporal discrimination', () => {
  it('falls back to the bidi-truncated goal for legacy NULL titles', () => {
    expect(displaySessionLabel(null, 'اهلا')).toBe('اهلا'); // honest fallback
    expect(displaySessionLabel(null, 'x'.repeat(120))).toContain('…');
    expect(displaySessionLabel('Stored title', 'raw goal')).toBe('Stored title');
  });

  it('labels today, yesterday, or a date', () => {
    const now = new Date();
    expect(relativeDayLabel(now.toISOString())).toBe('today');
    expect(relativeDayLabel(new Date(now.getTime() - 86_400_000).toISOString())).toBe('yesterday');
    expect(relativeDayLabel(new Date(now.getTime() - 5 * 86_400_000).toISOString())).not.toBe('today');
    expect(relativeDayLabel('')).toBe('');
  });

  it('both sidebar and run-list render through the same helper', () => {
    const readSrc = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    expect(readSrc('app/chat/UnifiedWorkspace.tsx')).toMatch(/displaySessionLabel\(item\.title, item\.goal\)/);
    expect(readSrc('app/work/WorkRunList.tsx')).toMatch(/displaySessionLabel\(run\.title, run\.goal\)/);
    expect(readSrc('app/chat/UnifiedWorkspace.tsx')).toMatch(/relativeDayLabel\(item\.updated_at\)/);
  });
});
