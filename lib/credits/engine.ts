/**
 * Credits engine — the single writer for the `credits` and `credit_ledger`
 * tables (AGENTS.md rule 6).
 *
 * Invariants:
 *  - Every balance change and its ledger row are written in ONE transaction
 *    (db.transaction in lib/db/index.ts). Either both land or neither does.
 *  - `balance_after` comes from the UPDATE's own `RETURNING balance`, never from
 *    a separate SELECT. This is the difference that matters: the previous
 *    implementation decided atomically and then re-read the balance, so a
 *    concurrent debit landing between the two statements was recorded as this
 *    transaction's result and the ledger stopped reconciling with reality.
 *    RETURNING is supported by SQLite >= 3.35 and by PostgreSQL.
 *  - Debits are atomic: `UPDATE ... WHERE balance >= ?`. If no row comes back,
 *    the balance was insufficient — we throw InsufficientCreditsError and
 *    never write a ledger row.
 *  - Daily grant is applied at most once per UTC day via a conditional update.
 */

import { db } from '../db/index';
import type { Transactional } from '../db/index';
import type { Credits } from '../types';

export const DEFAULT_DAILY_GRANT = Number(process.env.DEFAULT_DAILY_GRANT || '50');

export class InsufficientCreditsError extends Error {
  balance: number;
  needed: number;
  constructor(balance: number, needed: number) {
    super(`Insufficient credits: have ${balance}, need ${needed}`);
    this.name = 'InsufficientCreditsError';
    this.balance = balance;
    this.needed = needed;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function utcDayStart(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

/**
 * Ensure a credits row exists for the user; seeds the opening balance.
 *
 * `INSERT OR IGNORE` rather than check-then-insert: two concurrent first
 * requests would both see no row and both try to seed. The ledger row is only
 * written when this call actually created the row, so a user cannot accumulate
 * duplicate initial_grant entries.
 */
export async function ensureUserCredits(userId: string, dailyGrant = DEFAULT_DAILY_GRANT): Promise<void> {
  const existing = await db.prepare<Credits>(`SELECT user_id FROM credits WHERE user_id = ?`).get(userId);
  if (existing) return;
  await db.transaction(async (tx) => {
    const res = await tx
      .prepare(
        `INSERT OR IGNORE INTO credits (user_id, balance, daily_grant, last_reset_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(userId, dailyGrant, dailyGrant, utcDayStart(), nowIso());
    if (res.changes === 0) return; // Another request seeded it first.
    await writeLedger(userId, dailyGrant, 'initial_grant', null, dailyGrant, tx);
  });
}

/** Internal: write a ledger row. Caller supplies the resulting balance_after. */
async function writeLedger(
  userId: string,
  delta: number,
  reason: string,
  refId: string | null,
  balanceAfter: number,
  tx: Transactional = db,
): Promise<void> {
  await tx
    .prepare(
      `INSERT INTO credit_ledger (user_id, delta, reason, ref_id, balance_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, delta, reason, refId, balanceAfter, nowIso());
}

export async function getBalance(userId: string): Promise<number> {
  const row = await db.prepare<{ balance: number }>(`SELECT balance FROM credits WHERE user_id = ?`).get(userId);
  return row?.balance ?? 0;
}

/**
 * Atomically debit `amount` credits. Throws InsufficientCreditsError if the
 * balance would go negative. Writes a ledger row in the same transaction.
 */
export async function debit(userId: string, amount: number, reason: string, refId?: string): Promise<number> {
  if (amount <= 0) return getBalance(userId);
  return db.transaction(async (tx) => {
    const row = await tx
      .prepare<{ balance: number }>(
        `UPDATE credits SET balance = balance - ?, updated_at = ?
         WHERE user_id = ? AND balance >= ? RETURNING balance`,
      )
      .get(amount, nowIso(), userId, amount);
    if (!row) {
      // No row matched: either the user has no credits row or the balance was
      // short. Read inside the transaction so the reported balance is the one
      // the decision was made against.
      const current = await tx
        .prepare<{ balance: number }>(`SELECT balance FROM credits WHERE user_id = ?`)
        .get(userId);
      throw new InsufficientCreditsError(current?.balance ?? 0, amount);
    }
    await writeLedger(userId, -amount, reason, refId ?? null, row.balance, tx);
    return row.balance;
  });
}

/** Non-throwing debit wrapper for friendlier call sites. */
export async function tryDebit(
  userId: string,
  amount: number,
  reason: string,
  refId?: string,
): Promise<{ ok: true; balance: number } | { ok: false; balance: number; needed: number }> {
  try {
    const balance = await debit(userId, amount, reason, refId);
    return { ok: true, balance };
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return { ok: false, balance: err.balance, needed: err.needed };
    }
    throw err;
  }
}

/** Credit (add) — used by admin adjustments and grants. */
export async function credit(userId: string, amount: number, reason: string, refId?: string): Promise<number> {
  if (amount <= 0) return getBalance(userId);
  return db.transaction(async (tx) => {
    const row = await tx
      .prepare<{ balance: number }>(
        `UPDATE credits SET balance = balance + ?, updated_at = ?
         WHERE user_id = ? RETURNING balance`,
      )
      .get(amount, nowIso(), userId);
    if (!row) throw new Error(`credit: no credits row for user ${userId}`);
    await writeLedger(userId, amount, reason, refId ?? null, row.balance, tx);
    return row.balance;
  });
}

/**
 * Admin manual adjustment by an arbitrary (possibly negative) delta.
 * Balance is clamped at 0. Always writes a ledger row with the real delta
 * applied (which may differ from the requested delta if clamped).
 *
 * The clamp is expressed in SQL — `MAX(0, balance + ?)` — rather than as a
 * read, a clamp in JS, and a write of the absolute value. The old shape lost
 * any concurrent change made between the read and the write, because it wrote
 * a total computed from a stale balance instead of applying a delta.
 */
export async function adminAdjust(
  userId: string,
  delta: number,
  reason: string,
  refId?: string,
): Promise<number> {
  await ensureUserCredits(userId);
  if (delta === 0) return getBalance(userId);
  return db.transaction(async (tx) => {
    const before = await tx
      .prepare<{ balance: number }>(`SELECT balance FROM credits WHERE user_id = ?`)
      .get(userId);
    const previous = before?.balance ?? 0;
    const row = await tx
      .prepare<{ balance: number }>(
        `UPDATE credits SET balance = MAX(0, balance + ?), updated_at = ?
         WHERE user_id = ? RETURNING balance`,
      )
      .get(delta, nowIso(), userId);
    if (!row) throw new Error(`adminAdjust: no credits row for user ${userId}`);
    const applied = row.balance - previous;
    // A clamped no-op still leaves the balance where it was; recording a
    // zero-delta ledger row would be noise, so skip it.
    if (applied !== 0) {
      await writeLedger(userId, applied, reason, refId ?? null, row.balance, tx);
    }
    return row.balance;
  });
}

/**
 * Apply the daily grant at most once per UTC day. Atomic conditional update
 * guards against double-granting under concurrency.
 */
export async function grantDailyIfDue(userId: string): Promise<void> {
  const today = utcDayStart();
  const row = await db.prepare<Credits>(`SELECT * FROM credits WHERE user_id = ?`).get(userId);
  if (!row) {
    await ensureUserCredits(userId);
    return;
  }
  await db.transaction(async (tx) => {
    // daily_grant is read back with the new balance so the ledger delta is the
    // amount this statement actually added, even if the column changed since
    // the SELECT above.
    const granted = await tx
      .prepare<{ balance: number; daily_grant: number }>(
        `UPDATE credits SET balance = balance + daily_grant, last_reset_at = ?, updated_at = ?
         WHERE user_id = ? AND (last_reset_at IS NULL OR last_reset_at < ?)
         RETURNING balance, daily_grant`,
      )
      .get(today, nowIso(), userId, today);
    // No row: another request already granted today. Correct outcome, no write.
    if (!granted) return;
    await writeLedger(userId, granted.daily_grant, 'daily_grant', null, granted.balance, tx);
  });
}
