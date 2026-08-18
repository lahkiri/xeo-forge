import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByEmail } from '@/lib/db/queries';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, isDesktopLocalMode } from '@/lib/auth/session';
import { ensureUserCredits } from '@/lib/credits/engine';
import { errorResponse } from '../../_lib/respond';
import { rateLimit, clientIp } from '../../_lib/ratelimit';
import { ensureSchema } from '@/lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    if (isDesktopLocalMode()) {
      return NextResponse.json(
        { error: 'Desktop Local Mode does not use accounts. Open the Workbench directly.' },
        { status: 409 },
      );
    }
    await ensureSchema();
    // Throttle by IP: 10 login attempts per 5 minutes.
    const limited = rateLimit(`login:${clientIp(req)}`, 10, 5 * 60 * 1000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
      );
    }

    const body = await req.json();
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 400 });
    }
    const user = await getUserByEmail(parsed.data.email);
    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    const ok = await verifyPassword(parsed.data.password, user.password_hash);
    if (!ok) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    if (user.is_suspended) {
      return NextResponse.json({ error: 'Account suspended' }, { status: 403 });
    }
    await ensureUserCredits(user.id);
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('auth/login', err);
  }
}
