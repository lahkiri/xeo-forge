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

export interface Database {
  kind: DbKind;
  prepare<T = any>(sql: string): Statement<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const isProd = process.env.NODE_ENV === 'production';

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

  return {
    kind: 'sqlite',
    prepare<T = any>(sql: string): Statement<T> {
      const stmt = sqlite.prepare(sql);
      return {
        get: async (...params: unknown[]) => stmt.get(...params) as T | undefined,
        all: async (...params: unknown[]) => stmt.all(...params) as T[],
        run: async (...params: unknown[]) => {
          const r = stmt.run(...params);
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
      };
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
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
  if (!hasUrl && isProd) {
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
