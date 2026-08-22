/**
 * Database adapter — the single DB connection layer.
 *
 * Exposes one interface for both SQLite (dev) and PostgreSQL (prod):
 *   db.prepare(sql).get(...params)  -> Promise<row | undefined>
 *   db.prepare(sql).all(...params)  -> Promise<row[]>
 *   db.prepare(sql).run(...params)  -> Promise<{ changes, lastInsertRowid }>
 *   db.exec(sql)                    -> Promise<void>
 *   db.kind                         -> 'sqlite' | 'pg'
 *
 * Selection: DATABASE_URL set -> PostgreSQL, otherwise SQLite.
 * In production a DATABASE_URL is required (we throw otherwise).
 *
 * SQL is authored in SQLite dialect using `?` placeholders. For PG we
 * translate `?` -> `$N` (quote-aware) and rewrite the few SQLite-only
 * upsert spellings we use.
 */

import path from 'node:path';
import fs from 'node:fs';

export type DbKind = 'sqlite' | 'pg';

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Statement<T = any> {
  get(...params: unknown[]): Promise<T | undefined>;
  all(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

/**
 * The subset of the adapter available inside a transaction. Deliberately has no
 * `transaction` of its own: nesting is not supported (see Database.transaction).
 */
export interface Transactional {
  kind: DbKind;
  prepare<T = any>(sql: string): Statement<T>;
}

export interface Database {
  kind: DbKind;
  prepare<T = any>(sql: string): Statement<T>;
  exec(sql: string): Promise<void>;
  /**
   * Run `fn` inside a single database transaction, committing on return and
   * rolling back on throw. Every statement issued through the `tx` handle lands
   * on the same connection, which is the point: `db.prepare(...)` on the PG path
   * takes an arbitrary pooled client, so a BEGIN issued that way would not
   * enclose the statements that follow it.
   *
   * Nesting is NOT supported — calling transaction() from inside a transaction
   * callback deadlocks (SQLite) or opens an unrelated second transaction (PG).
   * Callers must keep transactions flat.
   */
  transaction<T>(fn: (tx: Transactional) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const isProd = process.env.NODE_ENV === 'production';
const isDesktopLocal = process.env.XEO_DESKTOP_LOCAL === '1';

/* ------------------------------------------------------------------ */
/* PG helpers                                                          */
/* ------------------------------------------------------------------ */

/** Convert `?` placeholders to `$1,$2,...`, ignoring `?` inside quotes. */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let i = 0;
  let n = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === '?' && !inSingle && !inDouble) {
      n += 1;
      out += '$' + n;
    } else {
      out += ch;
    }
    i += 1;
  }
  return out;
}

/**
 * Rewrite the SQLite-only spellings we actually use into PG equivalents.
 * We deliberately keep this list tiny and explicit — no general SQL rewriter.
 */
export function translateForPg(sql: string): string {
  let s = sql;
  // INSERT OR IGNORE INTO x -> INSERT INTO x ... ON CONFLICT DO NOTHING
  const ignoreMatch = /^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(s);
  if (ignoreMatch) {
    s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
    if (!/ON\s+CONFLICT/i.test(s)) s = s.trimEnd() + ' ON CONFLICT DO NOTHING';
  }
  s = toPgPlaceholders(s);
  return s;
}

/* ------------------------------------------------------------------ */
/* SQLite implementation                                              */
/* ------------------------------------------------------------------ */

function createSqlite(): Database {
  // Lazy require so PG-only deployments don't need the native module loaded.

  const BetterSqlite3 = require('better-sqlite3');
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'xeo.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new BetterSqlite3(dbPath);
  sqlite.pragma('journal_mode = WAL');
  // foreign_keys intentionally OFF: we manage soft-cascades in queries.ts.
  sqlite.pragma('foreign_keys = OFF');

  const prepare = <T = any>(sql: string): Statement<T> => {
    const stmt = sqlite.prepare(sql);
    return {
      get: async (...params: unknown[]) => stmt.get(...params) as T | undefined,
      all: async (...params: unknown[]) => stmt.all(...params) as T[],
      run: async (...params: unknown[]) => {
        const r = stmt.run(...params);
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
      },
    };
  };

  // better-sqlite3 is synchronous, so its own .transaction() helper cannot
  // wrap an async callback — the transaction would commit before any awaited
  // statement ran. We drive BEGIN/COMMIT/ROLLBACK explicitly instead.
  //
  // There is exactly ONE connection, so transactions must be serialised: a
  // second BEGIN while another is open throws "cannot start a transaction
  // within a transaction". Callers legitimately overlap (ten concurrent debits
  // for the same user is a normal request pattern), and they must queue rather
  // than fail, so each transaction chains onto the previous one's settlement.
  // This makes SQLite transactions strictly serial, which is what a single
  // synchronous connection can honestly offer. PG gets real concurrency below.
  let sqliteTxQueue: Promise<unknown> = Promise.resolve();

  const runSqliteTransaction = async <T,>(fn: (tx: Transactional) => Promise<T>): Promise<T> => {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn({ kind: 'sqlite', prepare });
      sqlite.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // Already rolled back (or never opened) — the original error is the
        // one worth propagating.
      }
      throw err;
    }
  };

  return {
    kind: 'sqlite',
    prepare,
    exec: async (sql: string) => {
      sqlite.exec(sql);
    },
    transaction: <T,>(fn: (tx: Transactional) => Promise<T>): Promise<T> => {
      // Chain on settlement, not resolution, so one failed transaction does not
      // poison the queue for everyone behind it.
      const next = sqliteTxQueue.then(
        () => runSqliteTransaction(fn),
        () => runSqliteTransaction(fn),
      );
      sqliteTxQueue = next.catch(() => undefined);
      return next;
    },
    close: async () => {
      sqlite.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/* PostgreSQL implementation                                          */
/* ------------------------------------------------------------------ */

function createPg(): Database {
  const { Pool } = require('pg');
  const connectionString = process.env.DATABASE_URL;
  const strictSsl = process.env.PG_STRICT_SSL === '1';
  const pool = new Pool({
    connectionString,
    ssl: connectionString && /sslmode=require|aivencloud|\.com/i.test(connectionString)
      ? { rejectUnauthorized: strictSsl }
      : undefined,
    options: '-c search_path=xeo,public',
  });

  pool.on('error', (err: Error) => {
    console.error('[db] pg pool error:', err);
  });

  const run = async (sql: string, params: unknown[]): Promise<RunResult> => {
    const text = translateForPg(sql);
    const res = await pool.query(text, params);
    return { changes: res.rowCount ?? 0, lastInsertRowid: 0 };
  };

  return {
    kind: 'pg',
    prepare<T = any>(sql: string): Statement<T> {
      return {
        get: async (...params: unknown[]) => {
          const res = await pool.query(translateForPg(sql), params);
          return res.rows[0] as T | undefined;
        },
        all: async (...params: unknown[]) => {
          const res = await pool.query(translateForPg(sql), params);
          return res.rows as T[];
        },
        run: (...params: unknown[]) => run(sql, params),
      };
    },
    exec: async (sql: string) => {
      // exec runs DDL authored in a PG-compatible way (schema.ts handles dialect).
      await pool.query(sql);
    },
    // A dedicated client for the whole transaction: BEGIN and COMMIT must land
    // on the same connection, and pool.query() picks an arbitrary one per call.
    transaction: async <T,>(fn: (tx: Transactional) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      const txPrepare = <U = any>(sql: string): Statement<U> => ({
        get: async (...params: unknown[]) => {
          const res = await client.query(translateForPg(sql), params);
          return res.rows[0] as U | undefined;
        },
        all: async (...params: unknown[]) => {
          const res = await client.query(translateForPg(sql), params);
          return res.rows as U[];
        },
        run: async (...params: unknown[]) => {
          const res = await client.query(translateForPg(sql), params);
          return { changes: res.rowCount ?? 0, lastInsertRowid: 0 };
        },
      });
      try {
        await client.query('BEGIN');
        const result = await fn({ kind: 'pg', prepare: txPrepare });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Connection may already be unusable; the original error matters more.
        }
        throw err;
      } finally {
        client.release();
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Singleton                                                          */
/* ------------------------------------------------------------------ */

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  const hasUrl = !!process.env.DATABASE_URL;
  if (!hasUrl && isProd && !isDesktopLocal) {
    throw new Error('DATABASE_URL is required in production (refusing to use SQLite).');
  }
  _db = hasUrl ? createPg() : createSqlite();
  return _db;
}

export const db = new Proxy({} as Database, {
  get(_target, prop: keyof Database) {
    return getDb()[prop];
  },
});
