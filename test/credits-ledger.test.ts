import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/*  Credit ledger integrity.                                           */
/*                                                                     */
/*  The engine used to decide atomically (UPDATE ... WHERE balance >=)  */
/*  and then re-SELECT the balance for balance_after. Under concurrency  */
/*  the ledger recorded someone else's balance. These tests assert the   */
/*  ledger reconciles: every row's balance_after equals the running sum  */
/*  of deltas, and the final row equals the live balance.                */
/* ------------------------------------------------------------------ */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-credits-'));
process.env.DB_PATH = path.join(tempDir, 'credits.sqlite');
process.env.DEFAULT_DAILY_GRANT = '50';

let db: typeof import('../lib/db/index').db;
let engine: typeof import('../lib/credits/engine');
let createUser: typeof import('../lib/db/queries').createUser;

let seq = 0;
async function freshUser(): Promise<string> {
  seq += 1;
  const user = await createUser({
    email: `ledger-${seq}@example.com`,
    passwordHash: 'hash',
    displayName: 'Ledger Tester',
  });
  await engine.ensureUserCredits(user.id);
  return user.id;
}

interface LedgerRow {
  delta: number;
  reason: string;
  balance_after: number;
}

async function ledgerFor(userId: string): Promise<LedgerRow[]> {
  return db
    .prepare<LedgerRow>(
      `SELECT delta, reason, balance_after FROM credit_ledger WHERE user_id = ? ORDER BY id ASC`,
    )
    .all(userId);
}

/** Every balance_after must equal the running sum of deltas before it. */
function assertLedgerReconciles(rows: LedgerRow[]): void {
  let running = 0;
  for (const row of rows) {
    running += row.delta;
    expect(row.balance_after, `ledger row "${row.reason}" (delta ${row.delta})`).toBe(running);
  }
}

beforeAll(async () => {
  const schema = await import('../lib/db/schema');
  const queries = await import('../lib/db/queries');
  const database = await import('../lib/db/index');
  engine = await import('../lib/credits/engine');
  createUser = queries.createUser;
  db = database.db;
  await schema.initSchema();
});

afterAll(async () => {
  await db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('the ledger reconciles with the balance', () => {
  it('records the opening grant exactly once', async () => {
    const userId = await freshUser();
    // Idempotent: a second call must not add a second initial_grant.
    await engine.ensureUserCredits(userId);
    await engine.ensureUserCredits(userId);

    const rows = await ledgerFor(userId);
    expect(rows.filter((r) => r.reason === 'initial_grant')).toHaveLength(1);
    assertLedgerReconciles(rows);
    expect(await engine.getBalance(userId)).toBe(50);
  });

  it('keeps balance_after truthful across a sequence of debits and credits', async () => {
    const userId = await freshUser();
    await engine.debit(userId, 10, 'task_create');
    await engine.credit(userId, 25, 'refund');
    await engine.debit(userId, 5, 'tool_call');

    const rows = await ledgerFor(userId);
    assertLedgerReconciles(rows);
    const balance = await engine.getBalance(userId);
    expect(balance).toBe(50 - 10 + 25 - 5);
    expect(rows[rows.length - 1].balance_after).toBe(balance);
  });

  it('writes no ledger row when a debit is refused', async () => {
    const userId = await freshUser();
    const before = (await ledgerFor(userId)).length;

    await expect(engine.debit(userId, 999, 'too_big')).rejects.toThrow(/Insufficient credits/);

    expect((await ledgerFor(userId)).length).toBe(before);
    expect(await engine.getBalance(userId)).toBe(50);
  });

  it('reports the real balance on refusal', async () => {
    const userId = await freshUser();
    await engine.debit(userId, 20, 'setup');
    try {
      await engine.debit(userId, 100, 'too_big');
      throw new Error('expected the debit to be refused');
    } catch (err) {
      const e = err as { name?: string; balance?: number; needed?: number };
      expect(e.name).toBe('InsufficientCreditsError');
      expect(e.balance).toBe(30);
      expect(e.needed).toBe(100);
    }
  });

  it('never lets concurrent debits overdraw or desynchronise the ledger', async () => {
    const userId = await freshUser();
    // 50 credits, ten simultaneous debits of 10 — at most five can succeed.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => engine.debit(userId, 10, 'concurrent')),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;

    expect(ok).toBe(5);
    const balance = await engine.getBalance(userId);
    expect(balance).toBe(0);
    expect(balance).toBeGreaterThanOrEqual(0);

    const rows = await ledgerFor(userId);
    assertLedgerReconciles(rows);
    expect(rows.filter((r) => r.reason === 'concurrent')).toHaveLength(5);
    expect(rows[rows.length - 1].balance_after).toBe(balance);
  });
});

describe('adminAdjust applies a delta, not a stale total', () => {
  it('adds and subtracts, recording the applied delta', async () => {
    const userId = await freshUser();
    expect(await engine.adminAdjust(userId, 30, 'admin_grant')).toBe(80);
    expect(await engine.adminAdjust(userId, -20, 'admin_deduct')).toBe(60);
    assertLedgerReconciles(await ledgerFor(userId));
  });

  it('clamps at zero and records only what was actually applied', async () => {
    const userId = await freshUser();
    // Ask to remove 500 from 50: the applied delta is -50, not -500.
    expect(await engine.adminAdjust(userId, -500, 'admin_zero')).toBe(0);

    const rows = await ledgerFor(userId);
    expect(rows[rows.length - 1].delta).toBe(-50);
    expect(rows[rows.length - 1].balance_after).toBe(0);
    assertLedgerReconciles(rows);
  });

  it('writes nothing when the clamp makes the adjustment a no-op', async () => {
    const userId = await freshUser();
    await engine.adminAdjust(userId, -50, 'to_zero');
    const before = (await ledgerFor(userId)).length;
    expect(await engine.adminAdjust(userId, -10, 'already_zero')).toBe(0);
    expect((await ledgerFor(userId)).length).toBe(before);
  });
});

describe('the daily grant is applied at most once per UTC day', () => {
  it('grants when due and is a no-op on the second call', async () => {
    const userId = await freshUser();
    // ensureUserCredits stamps last_reset_at to today, so backdate it to make
    // the grant due without waiting a day.
    await db
      .prepare(`UPDATE credits SET last_reset_at = ? WHERE user_id = ?`)
      .run('2000-01-01T00:00:00.000Z', userId);

    await engine.grantDailyIfDue(userId);
    expect(await engine.getBalance(userId)).toBe(100);

    await engine.grantDailyIfDue(userId);
    expect(await engine.getBalance(userId)).toBe(100);

    const rows = await ledgerFor(userId);
    expect(rows.filter((r) => r.reason === 'daily_grant')).toHaveLength(1);
    assertLedgerReconciles(rows);
  });

  it('does not double-grant under concurrent calls', async () => {
    const userId = await freshUser();
    await db
      .prepare(`UPDATE credits SET last_reset_at = ? WHERE user_id = ?`)
      .run('2000-01-01T00:00:00.000Z', userId);

    await Promise.allSettled(Array.from({ length: 6 }, () => engine.grantDailyIfDue(userId)));

    const rows = await ledgerFor(userId);
    expect(rows.filter((r) => r.reason === 'daily_grant')).toHaveLength(1);
    expect(await engine.getBalance(userId)).toBe(100);
    assertLedgerReconciles(rows);
  });
});

describe('tryDebit reports refusal without throwing', () => {
  it('succeeds within balance', async () => {
    const userId = await freshUser();
    const res = await engine.tryDebit(userId, 15, 'ok');
    expect(res).toEqual({ ok: true, balance: 35 });
  });

  it('reports the shortfall instead of throwing', async () => {
    const userId = await freshUser();
    const res = await engine.tryDebit(userId, 400, 'nope');
    expect(res).toEqual({ ok: false, balance: 50, needed: 400 });
    expect(await engine.getBalance(userId)).toBe(50);
  });
});
