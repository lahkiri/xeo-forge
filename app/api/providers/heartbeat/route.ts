import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireAdmin } from '@/lib/auth/guard';
import { isDesktopLocalMode } from '@/lib/auth/session';
import { listModelProviders, listProviderModels } from '@/lib/db/queries';
import { probeProvider } from '@/lib/model/health';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MODELS_PER_SWEEP = 12;

/**
 * Heartbeat: quick health sweep for the model picker dots.
 * Desktop Local: any session. Hosted: admin only (shared quota).
 *
 * Probes up to MAX_MODELS_PER_SWEEP enabled models round-robin (oldest-checked
 * first) with a BASIC completion only — cheap, fast. The heavier stream+tool
 * governed-run probe stays in Control Center.
 */
export async function POST(req: NextRequest) {
  try {
    const local = isDesktopLocalMode();
    const user = local ? await requireUser() : await requireAdmin();

    const providers = await listModelProviders(user.id);
    const models = await listProviderModels(user.id);
    const providerById = new Map(providers.map((p) => [p.id, p]));

    const candidates = models
      .filter((m) => m.enabled && providerById.get(m.provider_id)?.enabled)
      .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))
      .slice(0, MAX_MODELS_PER_SWEEP);

    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return errorResponse('providers/heartbeat', new Error('bad url'));
    }
    const force = url.searchParams.get('force') === '1';

    const results = await Promise.all(
      candidates.map(async (model) => {
        const provider = providerById.get(model.provider_id)!;
        try {
          const result = await probeProvider(provider.base_url, provider.api_key, model.model_id);
          return {
            providerId: provider.id,
            modelId: model.id,
            verdict: result.verdict,
          };
        } catch (err) {
          console.error(`[heartbeat] probe failed ${provider.slug}/${model.model_id}:`, err);
          return { providerId: provider.id, modelId: model.id, verdict: 'provider_down' as const };
        }
      }),
    );

    return NextResponse.json({ results, swept_at: new Date().toISOString() });
  } catch (err) {
    return errorResponse('providers/heartbeat', err);
  }
}
