import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { createProviderModel, getModelProvider, listProviderModels } from '@/lib/db/queries';
import { getProviderCatalogSafe } from '@/lib/model/config';
import { errorResponse } from '../../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SelectionSchema = z.object({
  models: z.array(z.object({ modelId: z.string().trim().min(1).max(300), name: z.string().trim().max(300).optional() })).min(1).max(100),
});

type RemoteModel = { id: string; name: string };

function modelsEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return base.toLowerCase().endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
}

function safeRemoteMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : null;
  const message = nested?.message ?? record.message ?? record.detail;
  return typeof message === 'string' ? message.replace(/Bearer\s+\S+/gi, 'Bearer <redacted>').slice(0, 240) : '';
}

async function fetchRemoteModels(provider: NonNullable<Awaited<ReturnType<typeof getModelProvider>>>): Promise<{ endpoint: string; models: RemoteModel[] }> {
  const endpoint = modelsEndpoint(provider.base_url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(provider.api_key ? { Authorization: `Bearer ${provider.api_key}` } : {}) },
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = await response.json().catch(() => null);
    if (response.status === 404) throw Object.assign(new Error('This provider does not support the /v1/models endpoint, or the provider URL is incorrect.'), { publicStatus: 404, publicKind: 'not_supported' });
    if (response.status === 401 || response.status === 403) throw Object.assign(new Error('The provider rejected the API key while loading models. Check the key and try again.'), { publicStatus: response.status, publicKind: 'authentication' });
    if (!response.ok) {
      const upstream = safeRemoteMessage(body);
      throw Object.assign(new Error(upstream ? `The provider returned an error while loading models: ${upstream}` : `The provider returned HTTP ${response.status} while loading models.`), { publicStatus: 502, publicKind: 'provider_error' });
    }
    const raw = Array.isArray(body) ? body : (body && typeof body === 'object' ? (body as Record<string, unknown>).data ?? (body as Record<string, unknown>).models : null);
    if (!Array.isArray(raw)) throw Object.assign(new Error('The provider response did not contain a valid model list.'), { publicStatus: 502, publicKind: 'invalid_response' });
    const models = raw.map((item) => {
      if (typeof item === 'string') return { id: item, name: item };
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      if (!id) return null;
      const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : id;
      return { id: id.slice(0, 300), name: name.slice(0, 300) };
    }).filter((model): model is RemoteModel => Boolean(model));
    if (models.length === 0) throw Object.assign(new Error('The provider returned an empty model list.'), { publicStatus: 422, publicKind: 'empty_response' });
    const unique = Array.from(new Map(models.map((model) => [model.id, model])).values()).slice(0, 100);
    return { endpoint, models: unique };
  } catch (error) {
    if (error && typeof error === 'object' && 'publicStatus' in error) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw Object.assign(new Error('The provider did not respond while loading models. Check the endpoint and network connection.'), { publicStatus: 504, publicKind: 'timeout' });
    throw Object.assign(new Error('The provider could not be reached. Check the endpoint URL and network connection.'), { publicStatus: 502, publicKind: 'network' });
  } finally {
    clearTimeout(timeout);
  }
}

function publicError(error: unknown): NextResponse {
  if (error && typeof error === 'object' && 'publicStatus' in error) {
    const typed = error as { message?: string; publicStatus?: number; publicKind?: string };
    return NextResponse.json({ error: typed.message || 'Could not load models from this provider.', kind: typed.publicKind || 'provider_error' }, { status: typed.publicStatus || 502 });
  }
  return errorResponse('providers/models/import', error);
}

export async function GET(_req: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const provider = await getModelProvider(context.params.id, user.id);
    if (!provider) return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });
    const result = await fetchRemoteModels(provider);
    return NextResponse.json({ endpoint: result.endpoint, models: result.models });
  } catch (error) {
    return publicError(error);
  }
}

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const provider = await getModelProvider(context.params.id, user.id);
    if (!provider) return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });
    const parsed = SelectionSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Choose at least one model to import.' }, { status: 400 });
    const result = await fetchRemoteModels(provider);
    const remoteById = new Map(result.models.map((model) => [model.id, model]));
    const existing = await listProviderModels(user.id);
    const existingIds = new Set(existing.filter((model) => model.provider_id === provider.id).map((model) => model.model_id));
    const added: RemoteModel[] = [];
    const skipped: string[] = [];
    for (const selection of parsed.data.models) {
      const remote = remoteById.get(selection.modelId);
      if (!remote) { skipped.push(selection.modelId); continue; }
      if (existingIds.has(remote.id)) { skipped.push(remote.id); continue; }
      await createProviderModel({ userId: user.id, providerId: provider.id, name: selection.name || remote.name, modelId: remote.id, enabled: true });
      existingIds.add(remote.id);
      added.push({ id: remote.id, name: selection.name || remote.name });
    }
    return NextResponse.json({ endpoint: result.endpoint, added, skipped, catalog: await getProviderCatalogSafe(user.id) }, { status: 201 });
  } catch (error) {
    return publicError(error);
  }
}
