import { NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth/guard';
import { InsufficientCreditsError } from '@/lib/credits/engine';

/**
 * Maps thrown errors to JSON responses. Every unexpected error is logged with
 * context (no silent failures). Known auth/credit errors map to their status.
 */
export function errorResponse(context: string, err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof InsufficientCreditsError) {
    return NextResponse.json(
      { error: 'Insufficient credits', balance: err.balance, needed: err.needed },
      { status: 402 },
    );
  }
  // Log the full error server-side (no silent failures), but never leak
  // internal messages or stack traces to the client.
  console.error(`[api] ${context}:`, err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
