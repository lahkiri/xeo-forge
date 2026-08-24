/**
 * Route guards — used by API routes to enforce auth and admin access.
 *
 * These throw AuthError, which routes translate into 401/403 responses.
 */

import { getCurrentUser } from './session';
import type { AuthUser } from '../types';

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('Authentication required', 401);
  if (user.isSuspended) throw new AuthError('Account suspended', 403);
  return user;
}

export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new AuthError('Admin access required', 403);
  return user;
}

/** Owner-or-admin authorization for task-scoped resources. */
export function assertOwnerOrAdmin(user: AuthUser, ownerId: string): void {
  if (user.id !== ownerId && !user.isAdmin) {
    throw new AuthError('Forbidden', 403);
  }
}
