import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { deleteProvider, updateModelProvider } from '@/lib/db/queries';
import { getProviderCatalogSafe } from '@/lib/model/config';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchProviderSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/i).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().max(4000).optional(),
  enabled: z.boolean().optional(),
});

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await deleteProvider(params.id, user.id);
    return NextResponse.json({ catalog: await getProviderCatalogSafe(user.id) });
  } catch (err) {
    return errorResponse('providers/delete', err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const parsed = PatchProviderSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid provider update.' }, { status: 400 });
    const provider = await updateModelProvider({ id: params.id, userId: user.id, ...parsed.data });
    return NextResponse.json({ provider, catalog: await getProviderCatalogSafe(user.id) });
  } catch (err) {
    return errorResponse('providers/update', err);
  }
}
