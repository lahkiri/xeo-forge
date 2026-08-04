import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { getCredits, getLedger } from '@/lib/db/queries';
import { errorResponse } from '../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const credits = await getCredits(user.id);
    const ledger = await getLedger(user.id);
    return NextResponse.json({ balance: credits?.balance ?? 0, ledger });
  } catch (err) {
    return errorResponse('credits/get', err);
  }
}
