/**
 * Pure catalog plumbing for the Work governance rail.
 *
 * Why this module exists: v1.25.0 shipped a consumer that read `body?.catalog`
 * out of GET /api/providers — but that endpoint returns the ProviderCatalog
 * DIRECTLY (the wrapped { provider, catalog } shape belongs to POST only).
 * The API was correct the whole time; the in-session model switcher still
 * rendered "No model selected for this task" forever. Extracting the adoption
 * and the display-value derivation here makes the failing layer unit-testable,
 * so the class of regression "API fine, display empty" is pinned in CI
 * (test/rail-catalog-adoption.test.ts) and proven live end-to-end by
 * scripts/recapture-03-work.mjs, which asserts the RENDERED rail text.
 */
import type { ProviderCatalog } from '@/lib/types';

/**
 * Adopt the payload of GET /api/providers as the rail's catalog.
 *
 * Accepts the bare catalog (the actual GET contract), tolerates the wrapped
 * { provider, catalog } shape, and refuses anything that is not actually a
 * catalog: a producer shape change then degrades to the rail's honest empty
 * state instead of silently blanking the model switcher forever.
 */
export function adoptProviderCatalog(body: unknown): ProviderCatalog | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const candidate = 'providers' in record ? record : 'catalog' in record ? (record.catalog as unknown) : null;
  if (!candidate || typeof candidate !== 'object') return null;
  if (!Array.isArray((candidate as { providers?: unknown }).providers)) return null;
  return candidate as ProviderCatalog;
}

/**
 * Resolve the CURRENT-MODEL label exactly as the rail renders it:
 * "{modelName} · {providerName}". Names come from the same catalog Settings
 * uses, so the rail can never disagree with it. Returns null when the task's
 * stored model id is not in the catalog — the rail then says so honestly
 * ("No model selected for this task") instead of inventing a label.
 */
export function resolveCurrentModel(
  catalog: ProviderCatalog,
  modelId: string | null | undefined,
): { providerName: string; modelName: string } | null {
  for (const provider of catalog.providers) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return { providerName: provider.name, modelName: model.name };
  }
  return null;
}
