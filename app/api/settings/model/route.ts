import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { isDesktopLocalMode } from '@/lib/auth/session';
import { getModelSafe, updateModel } from '@/lib/model/config';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function assertLocalSettings(): void {
  if (!isDesktopLocalMode()) {
    throw new Error('Local settings are unavailable in Web SaaS mode.');
  }
}

/** GET /api/settings/model — local model configuration with a masked key state. */
export async function GET() {
  try {
    assertLocalSettings();
    await requireUser();
    return NextResponse.json({ model: await getModelSafe() });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Local settings are unavailable')) {
      return NextResponse.json({ error: 'Local settings are unavailable in Web SaaS mode.' }, { status: 404 });
    }
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

/** PUT /api/settings/model — update local model configuration without SaaS admin. */
export async function PUT(req: NextRequest) {
  try {
    assertLocalSettings();
    await requireUser();
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
    if (err instanceof Error && err.message.startsWith('Local settings are unavailable')) {
      return NextResponse.json({ error: 'Local settings are unavailable in Web SaaS mode.' }, { status: 404 });
    }
    return errorResponse('settings/model/update', err);
  }
}
