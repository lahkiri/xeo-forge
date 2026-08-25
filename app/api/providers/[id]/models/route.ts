import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { createProviderModel } from '@/lib/db/queries';
import { getProviderCatalogSafe } from '@/lib/model/config';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateModelSchema = z.object({
  name: z.string().trim().min(1).max(160),
  modelId: z.string().trim().min(1).max(200),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(256).max(200000).optional(),
  contextWindow: z.number().int().min(1024).max(10000000).optional(),
  autoCompactThreshold: z.number().int().min(10).max(95).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const parsed = CreateModelSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'name and modelId are required.' }, { status: 400 });
    const model = await createProviderModel({ userId: user.id, providerId: params.id, ...parsed.data });
    return NextResponse.json({ model, catalog: await getProviderCatalogSafe(user.id) }, { status: 201 });
  } catch (err) {
    return errorResponse('provider-models/create', err);
  }
}
