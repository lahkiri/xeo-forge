'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AgentInstruction, AgentMemory } from '@/lib/types';

const kinds = ['preference', 'fact', 'decision', 'constraint', 'lesson'] as const;

type Data = { instructions: AgentInstruction[]; memories: AgentMemory[] };

export default function TaskContextPanel({ taskId }: { taskId: string }) {
  const [data, setData] = useState<Data>({ instructions: [], memories: [] });
  const [instruction, setInstruction] = useState('');
  const [memory, setMemory] = useState('');
  const [kind, setKind] = useState<(typeof kinds)[number]>('constraint');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/agent/context?taskId=${encodeURIComponent(taskId)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not load task context.');
    setData(body);
  }, [taskId]);

  useEffect(() => { void load().catch((err) => setError(err instanceof Error ? err.message : 'Load failed.')); }, [load]);

  async function create(payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/agent/context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not save context.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  }

  async function updateMemory(id: string, status: 'active' | 'archived') {
    setBusy(true);
    try {
      const res = await fetch('/api/agent/context', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'memory', id, status, pinned: status === 'active' }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not update memory.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Update failed.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <p className="text-micro uppercase tracking-[0.22em] text-blue-400">TASK CONTEXT</p>
        <h2 className="mt-1 text-lg font-semibold text-content-primary">Instructions for this task</h2>
        <p className="mt-1 text-xs leading-5 text-content-muted">Task context is injected only for this workspace. It cannot override safety, approval, or tool permissions.</p>
      </div>

      {error && <div className="rounded-md border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-xs text-signal-fail">{error}</div>}

      <form onSubmit={(e) => { e.preventDefault(); if (instruction.trim()) { void create({ type: 'instruction', scope: 'task', taskId, name: 'Task instruction', content: instruction }); setInstruction(''); } }} className="rounded-control border border-line-subtle bg-ink-700/60 p-4">
        <label className="text-meta uppercase tracking-widest text-content-muted">Pin instruction</label>
        <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} placeholder="Use the existing design system and do not introduce a new dependency…" className="mt-2 w-full resize-y rounded-md border border-line bg-black/20 px-3 py-2 text-sm leading-6 text-content-secondary outline-none placeholder:text-content-faint focus:border-blue-400/50" />
        <button type="submit" disabled={busy || !instruction.trim()} className="mt-2 rounded-md bg-blue-500/15 px-3 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/25 disabled:opacity-40">Add task instruction</button>
      </form>

      <form onSubmit={(e) => { e.preventDefault(); if (memory.trim()) { void create({ type: 'memory', scope: 'task', taskId, kind, content: memory, status: 'active', confidence: 1, pinned: true }); setMemory(''); } }} className="rounded-control border border-line-subtle bg-ink-700/60 p-4">
        <label className="text-meta uppercase tracking-widest text-content-muted">Pin task memory</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <select value={kind} onChange={(e) => setKind(e.target.value as (typeof kinds)[number])} className="rounded-md border border-line bg-[#111419] px-3 py-2 text-xs text-content-secondary outline-none"><option value="constraint">constraint</option>{kinds.filter((k) => k !== 'constraint').map((k) => <option key={k} value={k}>{k}</option>)}</select>
          <input value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="This task must preserve the public API…" className="min-w-0 flex-1 rounded-md border border-line bg-black/20 px-3 py-2 text-sm text-content-secondary outline-none placeholder:text-content-faint focus:border-blue-400/50" />
        </div>
        <button type="submit" disabled={busy || !memory.trim()} className="mt-2 rounded-md bg-blue-500/15 px-3 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/25 disabled:opacity-40">Add task memory</button>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-control border border-line-subtle bg-ink-700/60 p-4">
          <h3 className="text-xs font-semibold text-content-secondary">Pinned instructions</h3>
          <div className="mt-3 space-y-2">{data.instructions.length === 0 ? <p className="text-xs text-content-muted">None yet.</p> : data.instructions.map((item) => <div key={item.id} className="rounded-md bg-black/20 p-3"><p className="text-xs leading-5 text-content-secondary">{item.content}</p></div>)}</div>
        </section>
        <section className="rounded-control border border-line-subtle bg-ink-700/60 p-4">
          <h3 className="text-xs font-semibold text-content-secondary">Task memories</h3>
          <div className="mt-3 space-y-2">{data.memories.length === 0 ? <p className="text-xs text-content-muted">None yet.</p> : data.memories.map((item) => <div key={item.id} className="rounded-md bg-black/20 p-3"><div className="flex items-center justify-between gap-2"><span className="text-micro uppercase text-content-muted">{item.kind}</span><span className={`text-micro ${item.status === 'active' ? 'text-green-300' : 'text-amber-300'}`}>{item.status}</span></div><p className="mt-2 text-xs leading-5 text-content-secondary">{item.content}</p>{item.status !== 'active' && <button disabled={busy} onClick={() => void updateMemory(item.id, 'active')} className="mt-2 text-micro text-blue-300 hover:text-blue-200">activate</button>}</div>)}</div>
        </section>
      </div>
    </div>
  );
}
