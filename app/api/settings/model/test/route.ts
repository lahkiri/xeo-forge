import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { requireUser, requireAdmin } from '@/lib/auth/guard';
import { isDesktopLocalMode } from '@/lib/auth/session';
import { normalizeBaseUrl, resolveModel } from '@/lib/model/config';
import { classifyModelError, publicModelErrorMessage } from '@/lib/model/errors';
import { rateLimit, RATE_LIMITS } from '../../../_lib/ratelimit';
import type { AuthUser } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TestSchema = z.object({
  baseUrl: z.string().url(),
  modelId: z.string().min(1).max(200),
  apiKey: z.string().min(1).optional(),
});

/**
 * Hosted mode shares ONE global model, so testing it is an admin action; the
 * desktop shell has a single implicit owner. This route used to 404 outside
 * local mode, which left web users unable to validate a provider at all.
 */
async function authorizeModelTest(): Promise<AuthUser> {
  if (isDesktopLocalMode()) return requireUser();
  return requireAdmin();
}

function statusFor(kind: ReturnType<typeof classifyModelError>['kind']): number {
  if (kind === 'rate_limit') return 429;
  if (kind === 'authentication') return 401;
  if (kind === 'not_found') return 404;
  if (kind === 'bad_request') return 400;
  if (kind === 'network') return 502;
  return 500;
}

/** POST /api/settings/model/test â€” validate the active provider without saving changes. */
export async function POST(req: NextRequest) {
  let testedBaseUrl = '';
  let testedModelId = 'model';
  try {
    const tester = await authorizeModelTest();
    // Each call is an outbound completion against a third-party provider, billed
    // to whoever owns the key. Throttled per tester so a stuck "Test" button or
    // a scripted client cannot turn this route into a spend amplifier.
    const limited = rateLimit(
      `modelTest:${tester.id}`,
      RATE_LIMITS.modelTest.limit,
      RATE_LIMITS.modelTest.windowMs,
    );
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many provider tests. Please wait before testing again.' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
      );
    }
    const parsed = TestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'A valid base URL and model ID are required.' }, { status: 400 });
    }

    const active = await resolveModel();
    const apiKey = parsed.data.apiKey?.trim() || active?.apiKey || '';
    if (!apiKey) {
      return NextResponse.json({ error: 'Enter an API key before testing this provider.' }, { status: 400 });
    }

    const startedAt = Date.now();
    const baseUrl = normalizeBaseUrl(parsed.data.baseUrl);
    const modelId = parsed.data.modelId.trim();
    testedBaseUrl = baseUrl;
    testedModelId = modelId;
    const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 30_000, maxRetries: 0 });
    await client.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      temperature: 0,
      // Some reasoning/free models spend output budget before emitting visible text.
      // max_tokens=1 can be rejected as an upstream rate-limit/empty-budget edge case.
      max_tokens: 256,
      stream: false,
    });

    return NextResponse.json({
      ok: true,
      model_id: modelId,
      base_url: baseUrl,
      provider_reachable: true,
      completion_available: true,
      latency_ms: Date.now() - startedAt,
      message: 'Provider connection succeeded. The model accepted a test completion.',
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Local settings are unavailable')) {
      return NextResponse.json({ error: 'Local settings are unavailable in Web SaaS mode.' }, { status: 404 });
    }
    const info = classifyModelError(err);
    console.error(`[settings/model/test] failed kind=${info.kind} status=${info.status ?? 'n/a'}:`, err);
    return NextResponse.json({
      error: publicModelErrorMessage(err, testedModelId, testedBaseUrl),
      kind: info.kind,
      status: info.status,
      retry_after_ms: info.retryAfterMs,
      quota_exhausted: info.quotaExhausted,
      provider_reachable: info.kind !== 'network',
      completion_available: false,
    }, { status: statusFor(info.kind) });
  }
}
