import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByEmail, createUser } from '@/lib/db/queries';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { ensureUserCredits } from '@/lib/credits/engine';
import { errorResponse } from '../../_lib/respond';
import { rateLimit, clientIp } from '../../_lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RegisterSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(120),
});

export async function POST(req: NextRequest) {
  try {
    // Throttle by IP: 5 signups per 10 minutes.
    const limited = rateLimit(`register:${clientIp(req)}`, 5, 10 * 60 * 1000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
      );
    }

    const body = await req.json();
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'A valid email, password (min 8 chars), and name are required.' },
        { status: 400 },
      );
    }

    const existing = await getUserByEmail(parsed.data.email);
    if (existing) {
      return NextResponse.json(
        { error: 'An account with that email already exists.' },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await createUser({
      email: parsed.data.email,
      passwordHash,
      displayName: parsed.data.displayName,
      isAdmin: false,
    });
    await ensureUserCredits(user.id);
    await createSession(user.id);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse('auth/register', err);
  }
}
