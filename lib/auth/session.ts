/**
 * Session management — cookie `xeo_session`.
 *
 * token = random 32 bytes (hex); we store only sha256(token) in
 * auth_sessions. The raw token lives only in the user's httpOnly cookie.
 * TTL 30 days. On read we apply the daily credit grant as a side-effect.
 */

import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import {
  createSessionRow,
  getSessionWithUser,
  deleteSession,
} from '../db/queries';
import { ensureUserCredits, grantDailyIfDue } from '../credits/engine';
import type { AuthUser, User } from '../types';

const COOKIE_NAME = 'xeo_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function toAuthUser(u: User): AuthUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    isAdmin: !!u.is_admin || !!u.is_root_admin,
    isRootAdmin: !!u.is_root_admin,
    isSuspended: !!u.is_suspended,
  };
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  await createSessionRow(tokenHash, userId, expiresAt);
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Only mark Secure when actually served over HTTPS. Set COOKIE_SECURE=1
    // behind a TLS-terminating proxy. Default off so plain-HTTP deployments
    // can still store the session cookie (otherwise the browser drops it).
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

export async function destroySession(): Promise<void> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (token) {
    await deleteSession(sha256(token));
  }
  cookies().delete(COOKIE_NAME);
}

/**
 * Resolve the current user from the session cookie, or null.
 * Side-effect: ensures a credits row exists and applies the daily grant.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  const row = await getSessionWithUser(sha256(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await deleteSession(sha256(token));
    return null;
  }
  await ensureUserCredits(row.user.id);
  await grantDailyIfDue(row.user.id);
  return toAuthUser(row.user);
}
