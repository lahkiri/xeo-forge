import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { deleteProviderModel, updateProviderModel } from '@/lib/db/queries';
import { getProviderCatalogSafe } from '@/lib/model/config';
import { errorResponse } from '../../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchModelSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  modelId: z.string().trim().min(1).max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(256).max(200000).optional(),
  contextWindow: z.number().int().min(1024).max(10000000).optional(),
  autoCompactThreshold: z.number().int().min(10).max(95).optional(),
  enabled: z.boolean().optional(),
});

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; modelId: string } }) {
  try {
    const user = await requireUser();
    await deleteProviderModel(params.modelId, user.id);
    return NextResponse.json({ catalog: await getProviderCatalogSafe(user.id) });
  } catch (err) {
    return errorResponse('provider-models/delete', err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; modelId: string } }) {
  try {
    const user = await requireUser();
    const parsed = PatchModelSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid model update.' }, { status: 400 });
    const model = await updateProviderModel({ id: params.modelId, userId: user.id, ...parsed.data });
    if (model.provider_id !== params.id) return NextResponse.json({ error: 'Model does not belong to this provider.' }, { status: 400 });
    return NextResponse.json({ model, catalog: await getProviderCatalogSafe(user.id) });
  } catch (err) {
    return errorResponse('provider-models/update', err);
  }
}
