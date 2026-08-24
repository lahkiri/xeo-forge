import { NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth/session';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('auth/logout', err);
  }
}
