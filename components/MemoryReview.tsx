'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AgentMemory } from '@/lib/types';
import { Alert, Badge, Button, Card, EmptyState, Skeleton, cx } from './ui';

/* ------------------------------------------------------------------ */
/*  MEMORY REVIEW                                                      */
/*                                                                     */
/*  Candidates are persisted as status='proposed' and are NEVER         */
/*  injected into a run — getActiveAgentMemories filters on 'active'.   */
/*  This component is the only path from proposed to approved, and it   */
/*  requires an explicit click. No silent learning.                     */
/* ------------------------------------------------------------------ */

const KIND_TONE: Record<string, 'cyan' | 'violet' | 'amber' | 'emerald' | 'gray'> = {
  preference: 'cyan',
  fact: 'gray',
  decision: 'violet',
  constraint: 'amber',
  lesson: 'emerald',
};

function CandidateCard({
  memory,
  busy,
  onDecide,
}: {
  memory: AgentMemory;
  busy: boolean;
  onDecide: (id: string, decision: 'keep' | 'reject', content?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const confidence = Math.round(Math.max(0, Math.min(1, memory.confidence)) * 100);

  return (
    <Card tone="amber">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={KIND_TONE[memory.kind] ?? 'gray'}>{memory.kind}</Badge>
        <Badge tone={memory.scope === 'task' ? 'cyan' : 'gray'}>{memory.scope}</Badge>
        <span className="text-micro tabular-nums text-content-muted">{confidence}% confidence</span>
      </div>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          autoFocus
          aria-label="Edit memory content"
          className="mt-2.5 w-full resize-none rounded-control border border-line bg-ink-900/60 px-3 py-2 text-ui leading-5 text-content-primary outline-none focus:border-signal-run/40"
        />
      ) : (
        <p className="mt-2.5 text-body leading-6 text-content-secondary">{memory.content}</p>
      )}

      <p className="mt-2 text-micro leading-4 text-content-muted">
        Proposed by this run. It will not reach any future run until you keep it.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="success"
          disabled={busy || (editing && !draft.trim())}
          onClick={() => onDecide(memory.id, 'keep', editing ? draft.trim() : undefined)}
        >
          Keep
        </Button>
        {editing ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setDraft(memory.content); }}>
            Cancel edit
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        <Button size="sm" variant="danger" disabled={busy} onClick={() => onDecide(memory.id, 'reject')}>
          Reject
        </Button>
      </div>
    </Card>
  );
}

export function MemoryReview({ taskId, onChanged }: { taskId: string; onChanged?: () => void }) {
  const [candidates, setCandidates] = useState<AgentMemory[]>([]);
  const [approved, setApproved] = useState<AgentMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/memory`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load memory.');
      setCandidates(body.candidates ?? []);
      setApproved(body.approved ?? []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load memory.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (memoryId: string, decision: 'keep' | 'reject', content?: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/tasks/${taskId}/memory`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memoryId, decision, ...(content ? { content } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not record the decision.');
      setNotice(decision === 'keep' ? 'Kept. It will be available to future runs.' : 'Rejected and archived.');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the decision.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (memoryId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/memory?memoryId=${encodeURIComponent(memoryId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not delete this memory.');
      }
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this memory.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-16 w-full" /></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <p className="text-micro font-semibold uppercase tracking-[0.2em] text-signal-gate/80">Memory</p>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-white">
          {candidates.length > 0 ? 'The agent proposed something to remember' : 'Approved memory'}
        </h2>
        <p className="mt-1.5 text-ui leading-5 text-content-muted">
          Nothing is remembered without your approval. Memory is reference data for future runs — it never
          grants a capability.
        </p>
      </div>

      {error && <Alert tone="error" title="Memory">{error}</Alert>}
      {notice && !error && <Alert tone="success">{notice}</Alert>}

      {candidates.length > 0 && (
        <div className="space-y-2.5">
          {candidates.map((memory) => (
            <CandidateCard key={memory.id} memory={memory} busy={busy} onDecide={decide} />
          ))}
        </div>
      )}

      <div>
        <p className="mb-2 text-micro font-semibold uppercase tracking-[0.16em] text-content-muted">
          Active for future runs ({approved.length})
        </p>
        {approved.length === 0 ? (
          <EmptyState
            title="No approved memory yet"
            description="Approved memories appear here and are injected as reference data into later runs on this task."
          />
        ) : (
          <div className="overflow-hidden rounded-panel border border-line-subtle bg-ink-700/60">
            {approved.map((memory) => (
              <div key={memory.id} className="border-b border-line-subtle px-3 py-2.5 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND_TONE[memory.kind] ?? 'gray'}>{memory.kind}</Badge>
                  <Badge tone={memory.scope === 'task' ? 'cyan' : 'gray'}>{memory.scope}</Badge>
                  {memory.pinned ? <span className="text-micro text-signal-run/80">pinned</span> : null}
                  <span className="ml-auto shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(memory.id)}
                      className={cx(
                        'text-micro text-content-muted transition hover:text-signal-fail',
                        busy && 'pointer-events-none opacity-50',
                      )}
                    >
                      forget
                    </button>
                  </span>
                </div>
                <p className="mt-1.5 text-ui leading-5 text-content-secondary">{memory.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
