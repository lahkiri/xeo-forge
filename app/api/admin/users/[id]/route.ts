import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guard';
import {
  getUserById,
  getTasksByUser,
  getCredits,
  getLedger,
  setUserSuspended,
  recordAdminAction,
} from '@/lib/db/queries';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/users/[id] — full inspection: profile, balance, tasks, ledger. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const user = await getUserById(params.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    const [credits, tasks, ledger] = await Promise.all([
      getCredits(user.id),
      getTasksByUser(user.id),
      getLedger(user.id, 100),
    ]);
    const { password_hash, ...safe } = user;
    return NextResponse.json({
      user: safe,
      balance: credits?.balance ?? 0,
      tasks,
      ledger,
    });
  } catch (err) {
    return errorResponse('admin/users/detail', err);
  }
}

const PatchSchema = z.object({
  suspended: z.boolean(),
});

/** PATCH /api/admin/users/[id] — enable/disable a user. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'suspended (boolean) is required.' }, { status: 400 });
    }
    const target = await getUserById(params.id);
    if (!target) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    if (target.is_root_admin) {
      return NextResponse.json({ error: 'The root admin cannot be suspended.' }, { status: 403 });
    }
    if (target.id === admin.id) {
      return NextResponse.json({ error: 'You cannot suspend your own account.' }, { status: 403 });
    }
    await setUserSuspended(target.id, parsed.data.suspended);
    await recordAdminAction({
      adminId: admin.id,
      targetUserId: target.id,
      action: parsed.data.suspended ? 'suspend_user' : 'enable_user',
      detail: `email=${target.email}`,
    });
    return NextResponse.json({ ok: true, suspended: parsed.data.suspended });
  } catch (err) {
    return errorResponse('admin/users/patch', err);
  }
}
