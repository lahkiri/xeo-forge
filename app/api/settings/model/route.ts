import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, requireAdmin } from '@/lib/auth/guard';
import { isDesktopLocalMode } from '@/lib/auth/session';
import { getModelSafe, updateModel } from '@/lib/model/config';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Model configuration.
 *
 * This route used to 404 whenever `XEO_DESKTOP_LOCAL !== '1'`, which meant the
 * only path to configure a provider was unreachable in web mode — the agent was
 * permanently unrunnable there. That is exactly the half-working path AGENTS.md
 * rule 4 forbids, so the gate is gone.
 *
 * Authorization instead follows the deployment shape:
 *  - Desktop local mode has a single implicit owner, so any session may write.
 *  - Hosted mode shares ONE global model across users (rule 5), so only an
 *    admin may write it. Every session may read the masked view.
 *
 * The API key is never returned by `getModelSafe()` — callers receive
 * `api_key_set` and `api_key_issue` only.
 */
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ model: await getModelSafe(), scope: isDesktopLocalMode() ? 'local' : 'workspace' });
  } catch (err) {
    return errorResponse('settings/model/get', err);
  }
}

const UpdateSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  modelId: z.string().min(1).max(200),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(1).max(200000),
  apiKey: z.string().min(1).optional(),
  contextWindow: z.number().int().min(1024).max(10000000).optional(),
  autoCompactThreshold: z.number().int().min(10).max(95).optional(),
});

export async function PUT(req: NextRequest) {
  try {
    // Hosted mode: the model is global, so writing it is an admin action.
    if (isDesktopLocalMode()) await requireUser();
    else await requireAdmin();

    const parsed = UpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'name, baseUrl, modelId, temperature, and maxTokens are required.' },
        { status: 400 },
      );
    }
    await updateModel(parsed.data);
    return NextResponse.json({ ok: true, model: await getModelSafe() });
  } catch (err) {
    return errorResponse('settings/model/update', err);
  }
}
