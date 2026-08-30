/**
 * v1.25.1 regression: the in-session model switcher rendered permanently
 * empty ("No model selected for this task") on every real session, while the
 * API it depends on was correct all along.
 *
 * Failure shape (owner-ordered fix): WorkGovernanceRail read `body?.catalog`
 * from GET /api/providers — but that endpoint returns the ProviderCatalog
 * DIRECTLY; the wrapped { provider, catalog } shape belongs to POST only.
 * The monitoring gap that let it ship is exactly this: every check looked at
 * the API's response, none looked at the value that actually reaches the
 * rail's display. Both layers are pinned here:
 *
 *   C1 adoptProviderCatalog — the GET payload (bare catalog) is adopted; the
 *      wrapped shape stays tolerated; anything that is not a catalog is
 *      refused, so a producer change degrades to the rail's honest empty
 *      state instead of a silent permanent blank.
 *   C2 resolveCurrentModel — the exact {modelName · providerName} pair the
 *      rail renders into aside.w-rail derives from the adopted catalog.
 *   C3 source contracts — the rail consumes the API THROUGH the adoption
 *      helper (the `body?.catalog` miss cannot silently return), the GET
 *      producer contract stays the bare catalog, and the live-UI harness
 *      keeps its hard-fail assertions on the RENDERED rail text.
 *
 * The rendered-surface proof itself is the Electron harness
 * scripts/recapture-03-work.mjs: it boots the real desktop shell against a
 * scripted provider and asserts the model name in the rail's rendered text.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { adoptProviderCatalog, resolveCurrentModel } from '../app/work/rail-catalog';
import type { ProviderCatalog } from '../lib/types';

const REPO_ROOT = path.resolve(__dirname, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const catalogFixture = (): ProviderCatalog => ({
  providers: [
    {
      id: 'prov-scripted',
      user_id: 'user-1',
      name: 'Scripted Provider',
      slug: 'scripted',
      base_url: 'http://127.0.0.1:4321/v1',
      enabled: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      api_key_set: true,
      api_key_issue: null,
      models: [
        {
          id: 'pm-k3',
          provider_id: 'prov-scripted',
          name: 'Kimi K3 (scripted)',
          model_id: 'kimi-k3',
          temperature: 0.6,
          max_tokens: 4096,
          context_window: 131072,
          auto_compact_threshold: 0.8,
          enabled: 1,
          selected: 1,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'pm-mini',
          provider_id: 'prov-scripted',
          name: 'Kimi Mini (scripted)',
          model_id: 'kimi-mini',
          temperature: 0.4,
          max_tokens: 2048,
          context_window: 32768,
          auto_compact_threshold: 0.8,
          enabled: 1,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  ],
  active_provider_id: 'prov-scripted',
  active_model_id: 'pm-k3',
});

describe('C1 adoptProviderCatalog: GET /api/providers reaches the rail', () => {
  it('adopts the BARE catalog — the actual GET contract that v1.25.0 missed', () => {
    const bare = catalogFixture();
    const adopted = adoptProviderCatalog(bare);
    expect(adopted).not.toBeNull();
    expect(adopted).toBe(bare); // same reference — nothing re-wrapped
    expect(adopted?.providers[0]?.models.map((m) => m.name)).toEqual([
      'Kimi K3 (scripted)',
      'Kimi Mini (scripted)',
    ]);
  });

  it('still tolerates the wrapped { provider, catalog } shape (POST contract)', () => {
    const wrapped = { provider: { id: 'prov-scripted' }, catalog: catalogFixture() };
    expect(adoptProviderCatalog(wrapped)?.active_model_id).toBe('pm-k3');
  });

  it('refuses anything that is not a catalog — honest empty state, never a fake', () => {
    expect(adoptProviderCatalog(null)).toBeNull();
    expect(adoptProviderCatalog(undefined)).toBeNull();
    expect(adoptProviderCatalog({})).toBeNull();
    expect(adoptProviderCatalog({ error: 'forbidden' })).toBeNull();
    expect(adoptProviderCatalog({ catalog: null })).toBeNull();
    expect(adoptProviderCatalog({ catalog: { nope: true } })).toBeNull();
    expect(adoptProviderCatalog({ providers: 'not-an-array' })).toBeNull();
  });
});

describe('C2 resolveCurrentModel: the value the rail DISPLAYS', () => {
  it('resolves the exact label pair the rail renders into aside.w-rail', () => {
    // Rendered as "{modelName} · {providerName}" — the on-screen strings.
    expect(resolveCurrentModel(catalogFixture(), 'pm-k3')).toEqual({
      providerName: 'Scripted Provider',
      modelName: 'Kimi K3 (scripted)',
    });
  });

  it('returns null for a task model id outside the catalog — the rail says so honestly', () => {
    expect(resolveCurrentModel(catalogFixture(), 'pm-gone')).toBeNull();
    expect(resolveCurrentModel(catalogFixture(), null)).toBeNull();
  });
});

describe('C3 source contracts: this regression class cannot silently return', () => {
  const railSrc = readSrc('app/work/WorkGovernanceRail.tsx');
  const producersSrc = readSrc('app/api/providers/route.ts');
  const harnessSrc = readSrc('scripts/recapture-03-work.mjs');

  it('the rail fetches /api/providers and adopts the body THROUGH the helper', () => {
    expect(railSrc).toContain("fetch('/api/providers', { cache: 'no-store' })");
    expect(railSrc).toContain('adoptProviderCatalog(body)');
    expect(railSrc).toContain('resolveCurrentModel(');
  });

  it('the shipped v1.25.0 miss (reading body?.catalog from the GET) stays gone', () => {
    expect(railSrc).not.toContain('body?.catalog');
  });

  it('GET /api/providers keeps returning the BARE catalog (producer contract)', () => {
    expect(producersSrc).toContain('NextResponse.json(await getProviderCatalogSafe(user.id))');
  });

  it('the live-UI harness stays hard-fail: the RENDERED rail text is the assertion surface', () => {
    expect(harnessSrc).toContain('Kimi K3 (scripted)');
    expect(harnessSrc).toContain('No model selected');
    expect(harnessSrc).toContain('aside.w-rail');
    expect(harnessSrc).toContain('Approve and build');
  });
});
