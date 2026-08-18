/**
 * Session management — cookie `xeo_session`.
 *
 * Cloud mode uses a normal httpOnly cookie backed by auth_sessions.
 * Desktop Local Mode deliberately has no login wall: it resolves one local
 * owner from the local database and keeps all protected APIs on the same
 * owner-scoped path. The local owner is not a cloud account and never leaves
 * the device.
 */

import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import {
  createSessionRow,
  getSessionWithUser,
  deleteSession,
  createUser,
  getUserByEmail,
} from '../db/queries';
import { ensureSchema } from '../db/bootstrap';
import { ensureUserCredits, grantDailyIfDue } from '../credits/engine';
import { hashPassword } from './password';
import type { AuthUser, User } from '../types';

const COOKIE_NAME = 'xeo_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOCAL_OWNER_EMAIL = 'local-owner@xeo-forge.local';
const LOCAL_OWNER_NAME = process.env.XEO_LOCAL_OWNER_NAME || 'Local Operator';

let localOwnerPromise: Promise<AuthUser> | undefined;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function isDesktopLocalMode(): boolean {
  return process.env.XEO_DESKTOP_LOCAL === '1';
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

async function resolveLocalOwner(): Promise<AuthUser> {
  await ensureSchema();
  let user = await getUserByEmail(LOCAL_OWNER_EMAIL);

  if (!user) {
    try {
      user = await createUser({
        email: LOCAL_OWNER_EMAIL,
        // The local owner never signs in with a password. The random hash
        // keeps the existing users contract intact without creating a usable
        // default credential.
        passwordHash: await hashPassword(randomBytes(32).toString('hex')),
        displayName: LOCAL_OWNER_NAME,
        isAdmin: true,
        isRootAdmin: true,
      });
    } catch (error) {
      // A concurrent first request may have created the same owner. Log the
      // race and recover only if the canonical row now exists.
      console.warn('[auth] local owner creation raced; checking canonical row', error);
      user = await getUserByEmail(LOCAL_OWNER_EMAIL);
      if (!user) throw error;
    }
  }

  if (!user) throw new Error('Local owner could not be resolved');
  const authUser = toAuthUser(user);
  await ensureUserCredits(authUser.id);
  await grantDailyIfDue(authUser.id);
  return authUser;
}

async function getLocalOwner(): Promise<AuthUser> {
  if (!localOwnerPromise) {
    localOwnerPromise = resolveLocalOwner().catch((error) => {
      localOwnerPromise = undefined;
      console.error('[auth] local owner bootstrap failed:', error);
      throw error;
    });
  }
  return localOwnerPromise;
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
 * Resolve the current user from the session cookie, or null in Cloud Mode.
 * Desktop Local Mode has one implicit local owner and never redirects to a
 * registration/login wall. Side-effect: ensures schema and credits exist.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  await ensureSchema();
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token && isDesktopLocalMode()) return getLocalOwner();
  if (!token) return null;

  const row = await getSessionWithUser(sha256(token));
  if (!row) return isDesktopLocalMode() ? getLocalOwner() : null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await deleteSession(sha256(token));
    return isDesktopLocalMode() ? getLocalOwner() : null;
  }
  await ensureUserCredits(row.user.id);
  await grantDailyIfDue(row.user.id);
  return toAuthUser(row.user);
}
