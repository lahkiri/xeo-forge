import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { isDesktopLocalMode } from '@/lib/auth/session';
import { resolveModel } from '@/lib/model/config';
import { probeProvider } from '@/lib/model/health';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/settings/model/health — probe the CONFIGURED provider with the
 * exact request shapes Xeo uses and report an honest diagnosis.
 *
 * Two minimal outbound calls (never streaming to the client during the probe):
 *   1. non-streaming, no tools   → is the provider alive?
 *   2. streaming WITH a tool     → does the governed-run path work?
 *
 * The stored key is used for the outbound call only; it is never logged,
 * echoed, or included in the response. Any session may run this in Desktop
 * Local mode (single implicit owner); hosted mode requires an admin because
 * the probe spends the shared provider's quota.
 */
export async function POST(_req: NextRequest) {
  try {
    if (isDesktopLocalMode()) {
      await requireUser();
    } else {
      const { requireAdmin } = await import('@/lib/auth/guard');
      await requireAdmin();
    }

    const model = await resolveModel();
    if (!model) {
      return NextResponse.json(
        { error: 'No model is configured yet. Add a provider first.' },
        { status: 409 },
      );
    }

    const result = await probeProvider(model.baseUrl, model.apiKey, model.modelId);
    // Mask everything except what the UI needs to render the verdict card.
    return NextResponse.json({
      verdict: result.verdict,
      detail: result.detail,
      model_id: result.model_id,
      checked_at: result.checked_at,
      latency_ms: result.latency_ms,
    });
  } catch (err) {
    return errorResponse('settings/model/health', err);
  }
}
