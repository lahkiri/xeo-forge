import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireAdmin } from '@/lib/auth/guard';
import { isDesktopLocalMode } from '@/lib/auth/session';
import { setSelectedProviderModel, getModelProvider, listProviderModels } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Persist the user's model picker choice (one selection per user). */
export async function POST(req: NextRequest) {
  const local = isDesktopLocalMode();
  const user = local ? await requireUser() : await requireAdmin();

  let body: { providerId?: string; providerModelId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { providerId, providerModelId } = body;
  if (!providerId || !providerModelId) {
    return NextResponse.json({ error: 'providerId and providerModelId are required' }, { status: 400 });
  }

  const provider = await getModelProvider(providerId, user.id);
  if (!provider || !provider.enabled) {
    return NextResponse.json({ error: 'Provider not found or disabled' }, { status: 404 });
  }
  const model = (await listProviderModels(user.id)).find((m) => m.id === providerModelId && m.provider_id === providerId);
  if (!model) {
    return NextResponse.json({ error: 'Model not found on this provider' }, { status: 404 });
  }

  await setSelectedProviderModel({ userId: user.id, providerId, providerModelId });
  return NextResponse.json({ ok: true });
}
