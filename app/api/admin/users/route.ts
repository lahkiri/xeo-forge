import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guard';
import { isDesktopLocalMode } from '@/lib/auth/session';
import {
  listUsersWithStats,
  getUserByEmail,
  createUser,
  recordAdminAction,
} from '@/lib/db/queries';
import { ensureUserCredits } from '@/lib/credits/engine';
import { hashPassword } from '@/lib/auth/password';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120),
  isAdmin: z.boolean().optional(),
});

export async function GET() {
  try {
    if (isDesktopLocalMode()) return NextResponse.json({ error: 'Admin is unavailable in Desktop Local mode.' }, { status: 404 });
    await requireAdmin();
    const users = await listUsersWithStats();
    // Never leak password hashes to the client.
    const safe = users.map(({ password_hash, ...rest }) => rest);
    return NextResponse.json({ users: safe });
  } catch (err) {
    return errorResponse('admin/users/list', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (isDesktopLocalMode()) return NextResponse.json({ error: 'Admin is unavailable in Desktop Local mode.' }, { status: 404 });
    const admin = await requireAdmin();
    const body = await req.json();
    const parsed = CreateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'email, password (min 8), and displayName are required.' },
        { status: 400 },
      );
    }
    const existing = await getUserByEmail(parsed.data.email);
    if (existing) {
      return NextResponse.json({ error: 'A user with that email already exists.' }, { status: 409 });
    }
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await createUser({
      email: parsed.data.email,
      passwordHash,
      displayName: parsed.data.displayName,
      isAdmin: parsed.data.isAdmin ?? false,
    });
    await ensureUserCredits(user.id);
    await recordAdminAction({
      adminId: admin.id,
      targetUserId: user.id,
      action: 'create_user',
      detail: `email=${user.email} isAdmin=${parsed.data.isAdmin ?? false}`,
    });
    const { password_hash, ...safe } = user;
    return NextResponse.json({ user: safe }, { status: 201 });
  } catch (err) {
    return errorResponse('admin/users/create', err);
  }
}
