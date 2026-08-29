/**
 * users domain queries (moved verbatim from queries.ts).
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../index';
import { nowIso } from './shared';
import type {
  User,
} from '../../types';

/* ------------------------------------------------------------------ */
/* Users                                                              */
/* ------------------------------------------------------------------ */

export async function createUser(input: {
  email: string;
  passwordHash: string;
  displayName: string;
  isAdmin?: boolean;
  isRootAdmin?: boolean;
}): Promise<User> {
  const id = uuidv4();
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, is_admin, is_root_admin, is_suspended, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      id,
      input.email.toLowerCase(),
      input.passwordHash,
      input.displayName,
      input.isAdmin ? 1 : 0,
      input.isRootAdmin ? 1 : 0,
      createdAt,
    );
  const user = await getUserById(id);
  if (!user) throw new Error('createUser: user not found after insert');
  return user;
}

export async function getUserById(id: string): Promise<User | undefined> {
  return db.prepare<User>(`SELECT * FROM users WHERE id = ?`).get(id);
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  return db.prepare<User>(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase());
}

export async function listUsers(): Promise<User[]> {
  return db.prepare<User>(`SELECT * FROM users ORDER BY created_at DESC`).all();
}

/** Admin view: every user with current balance and task count, newest first. */
export async function listUsersWithStats(): Promise<
  Array<User & { balance: number; task_count: number }>
> {
  return db
    .prepare<User & { balance: number; task_count: number }>(
      `SELECT u.*,
              COALESCE(c.balance, 0) AS balance,
              COALESCE(t.cnt, 0) AS task_count
         FROM users u
         LEFT JOIN credits c ON c.user_id = u.id
         LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM tasks GROUP BY user_id) t
                ON t.user_id = u.id
        ORDER BY u.created_at DESC`,
    )
    .all();
}

export async function setUserSuspended(id: string, suspended: boolean): Promise<void> {
  await db.prepare(`UPDATE users SET is_suspended = ? WHERE id = ?`).run(suspended ? 1 : 0, id);
}

export async function countUsers(): Promise<number> {
  const row = await db.prepare<{ c: number }>(`SELECT COUNT(*) AS c FROM users`).get();
  return row?.c ?? 0;
}

/* ------------------------------------------------------------------ */
/* Sessions                                                           */
/* ------------------------------------------------------------------ */

export async function createSessionRow(tokenHash: string, userId: string, expiresAt: string): Promise<void> {
  await db
    .prepare(`INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(tokenHash, userId, expiresAt);
}

export async function getSessionWithUser(
  tokenHash: string,
): Promise<{ user: User; expires_at: string } | undefined> {
  const row = await db
    .prepare<User & { expires_at: string }>(
      `SELECT u.*, s.expires_at AS expires_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash);
  if (!row) return undefined;
  const { expires_at, ...user } = row as User & { expires_at: string };
  return { user: user as User, expires_at };
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(tokenHash);
}
