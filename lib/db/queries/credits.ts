/**
 * credits domain queries (moved verbatim from queries.ts).
 */

import { db } from '../index';
import type {
  Credits,
  CreditLedgerRow,
} from '../../types';

/* ------------------------------------------------------------------ */
/* Credits read helpers (writes live in lib/credits/engine.ts)        */
/* ------------------------------------------------------------------ */

export async function getCredits(userId: string): Promise<Credits | undefined> {
  return db.prepare<Credits>(`SELECT * FROM credits WHERE user_id = ?`).get(userId);
}

export async function getLedger(userId: string, limit = 100): Promise<CreditLedgerRow[]> {
  return db
    .prepare<CreditLedgerRow>(
      `SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(userId, limit);
}
