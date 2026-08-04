/**
 * Credits engine — the single writer for the `credits` and `credit_ledger`
 * tables (AGENTS.md rule 6).
 *
 * Invariants:
 *  - Debits are atomic: `UPDATE ... WHERE balance >= ?`. If 0 rows change,
 *    the balance was insufficient — we throw InsufficientCreditsError and
 *    never write a ledger row.
 *  - Every successful balance change writes a credit_ledger row carrying the
 *    resulting balance_after.
 *  - Daily grant is applied at most once per UTC day via a conditional update.
 */

import { db } from '../db/index';
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

/** Ensure a credits row exists for the user; seeds the opening balance. */
export async function ensureUserCredits(userId: string, dailyGrant = DEFAULT_DAILY_GRANT): Promise<void> {
  const existing = await db.prepare<Credits>(`SELECT * FROM credits WHERE user_id = ?`).get(userId);
  if (existing) return;
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO credits (user_id, balance, daily_grant, last_reset_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(userId, dailyGrant, dailyGrant, utcDayStart(), ts);
  await writeLedger(userId, dailyGrant, 'initial_grant', null, dailyGrant);
}

/** Internal: write a ledger row. Caller supplies the resulting balance_after. */
async function writeLedger(
  userId: string,
  delta: number,
  reason: string,
  refId: string | null,
  balanceAfter: number,
): Promise<void> {
  await db
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
 * balance would go negative. Writes a ledger row on success.
 */
export async function debit(userId: string, amount: number, reason: string, refId?: string): Promise<number> {
  if (amount <= 0) return getBalance(userId);
  const res = await db
    .prepare(`UPDATE credits SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?`)
    .run(amount, nowIso(), userId, amount);
  if (res.changes === 0) {
    const balance = await getBalance(userId);
    throw new InsufficientCreditsError(balance, amount);
  }
  const balance = await getBalance(userId);
  await writeLedger(userId, -amount, reason, refId ?? null, balance);
  return balance;
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
  await db
    .prepare(`UPDATE credits SET balance = balance + ?, updated_at = ? WHERE user_id = ?`)
    .run(amount, nowIso(), userId);
  const balance = await getBalance(userId);
  await writeLedger(userId, amount, reason, refId ?? null, balance);
  return balance;
}

/**
 * Admin manual adjustment by an arbitrary (possibly negative) delta.
 * Balance is clamped at 0. Always writes a ledger row with the real delta
 * applied (which may differ from the requested delta if clamped).
 */
export async function adminAdjust(
  userId: string,
  delta: number,
  reason: string,
  refId?: string,
): Promise<number> {
  await ensureUserCredits(userId);
  const current = await getBalance(userId);
  const target = Math.max(0, current + delta);
  const applied = target - current;
  if (applied === 0) return current;
  await db.prepare(`UPDATE credits SET balance = ?, updated_at = ? WHERE user_id = ?`).run(target, nowIso(), userId);
  await writeLedger(userId, applied, reason, refId ?? null, target);
  return target;
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
  const res = await db
    .prepare(
      `UPDATE credits SET balance = balance + daily_grant, last_reset_at = ?, updated_at = ?
       WHERE user_id = ? AND (last_reset_at IS NULL OR last_reset_at < ?)`,
    )
    .run(today, nowIso(), userId, today);
  if (res.changes > 0) {
    const balance = await getBalance(userId);
    await writeLedger(userId, row.daily_grant, 'daily_grant', null, balance);
  }
}
