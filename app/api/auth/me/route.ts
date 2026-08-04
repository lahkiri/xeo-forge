import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { getCredits } from '@/lib/db/queries';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }
    const credits = await getCredits(user.id);
    return NextResponse.json({ user, balance: credits?.balance ?? 0 });
  } catch (err) {
    return errorResponse('auth/me', err);
  }
}
