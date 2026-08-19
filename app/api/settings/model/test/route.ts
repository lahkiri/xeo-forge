import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { isDesktopLocalMode } from '@/lib/auth/session';
import { resolveModel } from '@/lib/model/config';
import { classifyModelError, publicModelErrorMessage } from '@/lib/model/errors';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TestSchema = z.object({
  baseUrl: z.string().url(),
  modelId: z.string().min(1).max(200),
  apiKey: z.string().min(1).optional(),
});

function assertLocalSettings(): void {
  if (!isDesktopLocalMode()) throw new Error('Local settings are unavailable in Web SaaS mode.');
}

function statusFor(kind: ReturnType<typeof classifyModelError>['kind']): number {
  if (kind === 'rate_limit') return 429;
  if (kind === 'authentication') return 401;
  if (kind === 'not_found') return 404;
  if (kind === 'bad_request') return 400;
  if (kind === 'network') return 502;
  return 500;
}

/** POST /api/settings/model/test — validate the active provider without saving changes. */
export async function POST(req: NextRequest) {
  try {
    assertLocalSettings();
    await requireUser();
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
    const client = new OpenAI({ apiKey, baseURL: parsed.data.baseUrl, timeout: 30_000 });
    await client.chat.completions.create({
      model: parsed.data.modelId,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      temperature: 0,
      max_tokens: 1,
      stream: false,
    });

    return NextResponse.json({
      ok: true,
      model_id: parsed.data.modelId,
      base_url: parsed.data.baseUrl,
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
      error: publicModelErrorMessage(err, 'connection test'),
      kind: info.kind,
      status: info.status,
      retry_after_ms: info.retryAfterMs,
    }, { status: statusFor(info.kind) });
  }
}
