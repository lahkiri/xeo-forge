import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guard';
import { getUserById, getCredits, recordAdminAction } from '@/lib/db/queries';
import { adminAdjust } from '@/lib/credits/engine';
import { errorResponse } from '../../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AdjustSchema = z.object({
  delta: z.number().int().refine((n) => n !== 0, 'delta must be non-zero'),
  reason: z.string().min(1).max(200),
});

/** POST /api/admin/users/[id]/credits — manually adjust a user's balance. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const parsed = AdjustSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'delta (non-zero integer) and reason are required.' },
        { status: 400 },
      );
    }
    const target = await getUserById(params.id);
    if (!target) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    await adminAdjust(target.id, parsed.data.delta, parsed.data.reason, `admin:${admin.id}`);
    const credits = await getCredits(target.id);
    await recordAdminAction({
      adminId: admin.id,
      targetUserId: target.id,
      action: 'adjust_credits',
      detail: `delta=${parsed.data.delta} reason=${parsed.data.reason}`,
    });
    return NextResponse.json({ ok: true, balance: credits?.balance ?? 0 });
  } catch (err) {
    return errorResponse('admin/users/credits', err);
  }
}
