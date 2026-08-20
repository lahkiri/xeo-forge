'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ContextLayer, ContextLayerState } from '@/lib/agent/context-pack';
import { Alert, Badge, Card, EmptyState, Meter, Skeleton, cx, type BadgeTone } from './ui';

/* ------------------------------------------------------------------ */
/*  CONTEXT INSPECTOR                                                  */
/*                                                                     */
/*  Answers the one question every agent user has: what instructions   */
/*  actually reached the model, and why? It reads the same resolution   */
/*  pass the agent loop uses, so it cannot report a layer the model     */
/*  did not receive.                                                    */
/* ------------------------------------------------------------------ */

const STATE_TONE: Record<ContextLayerState, BadgeTone> = {
  active: 'emerald',
  excluded: 'gray',
  overridden: 'amber',
  duplicate: 'violet',
};

const STATE_LABEL: Record<ContextLayerState, string> = {
  active: 'in prompt',
  excluded: 'withheld',
  overridden: 'overridden',
  duplicate: 'deduped',
};

const KIND_LABEL: Record<ContextLayer['kind'], string> = {
  base: 'Platform policy',
  skill: 'Workflow',
  profile: 'Role',
  instruction: 'Instruction',
  memory: 'Memory',
};

interface InspectorData {
  mode: string;
  layers: ContextLayer[];
  totals: {
    activeLayers: number;
    excludedLayers: number;
    promptTokens: number;
    baseTokens: number;
    contextTokens: number;
  };
}

function LayerRow({ layer, byId }: { layer: ContextLayer; byId: Map<string, ContextLayer> }) {
  const winner = layer.supersededBy ? byId.get(layer.supersededBy) : undefined;
  return (
    <div
      className={cx(
        'border-b border-line-subtle px-3 py-2.5 last:border-0',
        layer.state !== 'active' && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATE_TONE[layer.state]}>{STATE_LABEL[layer.state]}</Badge>
        <span className="text-micro uppercase tracking-[0.12em] text-content-muted">
          {KIND_LABEL[layer.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-content-primary">{layer.label}</span>
        {layer.scope !== 'system' && (
          <Badge tone={layer.scope === 'task' ? 'cyan' : 'gray'}>{layer.scope}</Badge>
        )}
        {typeof layer.priority === 'number' && (
          <span className="text-micro tabular-nums text-content-muted" title="Instruction priority">
            p{layer.priority}
          </span>
        )}
        <span className="shrink-0 text-micro tabular-nums text-content-muted">
          {layer.tokens > 0 ? `~${layer.tokens.toLocaleString()} tok` : '—'}
        </span>
      </div>

      <p className="mt-1.5 text-meta leading-5 text-content-muted">
        {layer.reason}
        {winner && <span className="text-content-secondary"> Winner: {winner.label}.</span>}
        {layer.truncated && <span className="text-signal-gate/90"> Content was clamped to fit its budget.</span>}
      </p>

      {layer.preview && (
        <p className="mt-1.5 truncate font-mono text-micro leading-4 text-content-muted" title={layer.preview}>
          {layer.preview}
        </p>
      )}
    </div>
  );
}

export function ContextInspector({ taskId }: { taskId: string }) {
  const [data, setData] = useState<InspectorData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showWithheld, setShowWithheld] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/context`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load the effective context.');
      setData(body);
      setError('');
    } catch (err) {
      // Surfaced rather than swallowed (AGENTS.md rule 3).
      setError(err instanceof Error ? err.message : 'Could not load the effective context.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return <div className="mx-auto max-w-3xl"><Alert tone="error" title="Context Inspector">{error}</Alert></div>;
  }

  if (!data) return null;

  const byId = new Map(data.layers.map((layer) => [layer.id, layer]));
  const visible = showWithheld ? data.layers : data.layers.filter((layer) => layer.state === 'active');
  const withheldCount = data.layers.filter((layer) => layer.state !== 'active').length;
  // Context budget share: how much of the prompt is user context vs platform policy.
  const sharePct = data.totals.promptTokens > 0
    ? (data.totals.contextTokens / data.totals.promptTokens) * 100
    : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <p className="text-micro font-semibold uppercase tracking-[0.2em] text-signal-run/80">
          Effective context
        </p>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-white">
          What actually reaches the model
        </h2>
        <p className="mt-1.5 text-ui leading-5 text-content-muted">
          Resolved for <span className="text-content-secondary">{data.mode}</span> mode by the same pass the agent
          loop uses. Every layer below is context only — none of them can grant a capability.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card className="px-3 py-2.5">
          <p className="text-micro uppercase tracking-[0.12em] text-content-muted">In prompt</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-signal-pass">{data.totals.activeLayers}</p>
        </Card>
        <Card className="px-3 py-2.5">
          <p className="text-micro uppercase tracking-[0.12em] text-content-muted">Withheld</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-content-secondary">{data.totals.excludedLayers}</p>
        </Card>
        <Card className="px-3 py-2.5">
          <p className="text-micro uppercase tracking-[0.12em] text-content-muted">Your context</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-content-primary">
            {data.totals.contextTokens.toLocaleString()}
          </p>
        </Card>
        <Card className="px-3 py-2.5">
          <p className="text-micro uppercase tracking-[0.12em] text-content-muted">Whole prompt</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-content-primary">
            {data.totals.promptTokens.toLocaleString()}
          </p>
        </Card>
      </div>

      <Card>
        <Meter
          value={sharePct}
          label="Share of the system prompt that is your context"
          detail={`${data.totals.contextTokens.toLocaleString()} of ${data.totals.promptTokens.toLocaleString()} estimated tokens (platform policy: ${data.totals.baseTokens.toLocaleString()})`}
          warnAt={60}
          dangerAt={80}
        />
      </Card>

      <div className="overflow-hidden rounded-panel border border-line-subtle bg-ink-700/60">
        <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-3 py-2">
          <span className="text-micro font-semibold uppercase tracking-[0.16em] text-content-muted">
            Layers, in prompt order
          </span>
          {withheldCount > 0 && (
            <button
              type="button"
              onClick={() => setShowWithheld((v) => !v)}
              className="text-meta text-content-muted transition hover:text-content-secondary"
            >
              {showWithheld ? 'Hide withheld' : `Show ${withheldCount} withheld`}
            </button>
          )}
        </div>
        {visible.length === 0 ? (
          <EmptyState title="No context layers" description="Only the platform policy is in the prompt." />
        ) : (
          visible.map((layer) => <LayerRow key={layer.id} layer={layer} byId={byId} />)
        )}
      </div>

      <p className="text-meta leading-5 text-content-muted">
        Detection here is deterministic: scope specificity, disabled flags, approval status, expiry,
        duplicate content, and budget clamping. Xeo does not use a model to guess whether two
        instructions disagree.
      </p>
    </div>
  );
}
