import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guard';
import { getModelSafe, updateModel } from '@/lib/model/config';
import { recordAdminAction } from '@/lib/db/queries';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/model — current global model config (api_key masked). */
export async function GET() {
  try {
    await requireAdmin();
    const model = await getModelSafe();
    return NextResponse.json({ model });
  } catch (err) {
    return errorResponse('admin/model/get', err);
  }
}

const UpdateSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  modelId: z.string().min(1).max(200),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(1).max(200000),
  // Optional: only sent when the admin wants to change the key.
  apiKey: z.string().min(1).optional(),
  // Context management fields.
  contextWindow: z.number().int().min(1024).max(10000000).optional(),
  autoCompactThreshold: z.number().int().min(10).max(95).optional(),
});

/** PUT /api/admin/model — update the single global model config. */
export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'name, baseUrl, modelId, temperature, and maxTokens are required.' },
        { status: 400 },
      );
    }
    await updateModel(parsed.data);
    await recordAdminAction({
      adminId: admin.id,
      action: 'update_model',
      detail: `model=${parsed.data.modelId} baseUrl=${parsed.data.baseUrl}`,
    });
    // Return the masked view — never echo the api_key back.
    const model = await getModelSafe();
    return NextResponse.json({ ok: true, model });
  } catch (err) {
    return errorResponse('admin/model/update', err);
  }
}
