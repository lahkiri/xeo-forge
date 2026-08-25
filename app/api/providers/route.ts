import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { createModelProvider } from '@/lib/db/queries';
import { getProviderCatalogSafe } from '@/lib/model/config';
import { errorResponse } from '../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await getProviderCatalogSafe(user.id));
  } catch (err) {
    return errorResponse('providers/list', err);
  }
}

const CreateProviderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/i),
  baseUrl: z.string().url(),
  apiKey: z.string().max(4000).optional().default(''),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = CreateProviderSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'name, slug, and a valid baseUrl are required.' }, { status: 400 });
    const provider = await createModelProvider({ userId: user.id, ...parsed.data });
    return NextResponse.json({ provider, catalog: await getProviderCatalogSafe(user.id) }, { status: 201 });
  } catch (err) {
    return errorResponse('providers/create', err);
  }
}
