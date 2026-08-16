'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';
import type { AgentInstruction, AgentMemory, AuthUser } from '@/lib/types';
import ProfileStudio from './ProfileStudio';

const MEMORY_KINDS = ['preference', 'fact', 'decision', 'constraint', 'lesson'] as const;

type ContextResponse = { instructions: AgentInstruction[]; memories: AgentMemory[] };

async function requestContext(init?: RequestInit): Promise<ContextResponse | { ok: true }> {
  const response = await fetch('/api/agent/context', {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function statusTone(status: AgentMemory['status']): string {
  if (status === 'active') return 'bg-green-500/15 text-green-300';
  if (status === 'proposed') return 'bg-amber-500/15 text-amber-300';
  return 'bg-white/10 text-gray-400';
}

export default function SettingsClient({ user }: { user: AuthUser }) {
  const [data, setData] = useState<ContextResponse>({ instructions: [], memories: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [instructionName, setInstructionName] = useState('');
  const [instructionContent, setInstructionContent] = useState('');
  const [instructionPriority, setInstructionPriority] = useState('100');
  const [memoryContent, setMemoryContent] = useState('');
  const [memoryKind, setMemoryKind] = useState<(typeof MEMORY_KINDS)[number]>('lesson');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await requestContext() as ContextResponse;
      setData(result);
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Could not load Prompt Studio.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runMutation = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await requestContext({ method: 'POST', body: JSON.stringify(payload) });
      setNotice({ type: 'ok', text: success });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Action failed.' });
    } finally {
      setBusy(false);
    }
  };

  const patch = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await requestContext({ method: 'PATCH', body: JSON.stringify(payload) });
      setNotice({ type: 'ok', text: success });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (type: 'instruction' | 'memory', id: string) => {
    if (!window.confirm('Remove this item from your agent context?')) return;
    setBusy(true);
    try {
      await requestContext({ method: 'DELETE', body: JSON.stringify({ type, id }) });
      setNotice({ type: 'ok', text: 'Removed.' });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed.' });
    } finally {
      setBusy(false);
    }
  };

  const addInstruction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!instructionName.trim() || !instructionContent.trim()) return;
    await runMutation({
      type: 'instruction',
      scope: 'global',
      name: instructionName,
      content: instructionContent,
      priority: Number(instructionPriority) || 100,
    }, 'Instruction pinned globally.');
    setInstructionName('');
    setInstructionContent('');
  };

  const addMemory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!memoryContent.trim()) return;
    await runMutation({
      type: 'memory',
      scope: 'global',
      kind: memoryKind,
      content: memoryContent,
      status: 'active',
      confidence: 1,
      pinned: true,
    }, 'Memory pinned globally.');
    setMemoryContent('');
  };

  return (
    <main className="min-h-screen bg-[#0b0d10] text-gray-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.06] pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-400">XEO FORGE / PROMPT STUDIO</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Agent control center</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
              Configure durable behavior and approve what your agent learns. These settings are compiled into future runs without editing source code.
            </p>
          </div>
          <a href="/dashboard" className="text-sm text-gray-400 transition hover:text-white">Back to dashboard</a>
        </header>

        {notice && (
          <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${notice.type === 'ok' ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-red-500/20 bg-red-500/10 text-red-300'}`}>
            {notice.text}
          </div>
        )}

        <ProfileStudio />

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="space-y-6">
            <Card>
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">Pinned instructions</h2>
                  <p className="mt-1 text-xs leading-5 text-gray-500">Reusable preferences applied to every task. They never grant new permissions or bypass approval.</p>
                </div>
                <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[10px] text-blue-300">{data.instructions.length} active layers</span>
              </div>
              <form onSubmit={addInstruction} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                  <input value={instructionName} onChange={(e) => setInstructionName(e.target.value)} placeholder="Name, e.g. Product voice" className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none placeholder:text-gray-600 focus:border-blue-400/50" />
                  <input value={instructionPriority} onChange={(e) => setInstructionPriority(e.target.value)} type="number" min="0" max="1000" placeholder="Priority" className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none placeholder:text-gray-600 focus:border-blue-400/50" />
                </div>
                <textarea value={instructionContent} onChange={(e) => setInstructionContent(e.target.value)} placeholder="Always use concise English UI copy..." rows={4} className="w-full resize-y rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm leading-6 outline-none placeholder:text-gray-600 focus:border-blue-400/50" />
                <Button type="submit" disabled={busy || !instructionName.trim() || !instructionContent.trim()}>Pin instruction</Button>
              </form>
            </Card>

            <Card>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold">Current instructions</h2>
                  <p className="mt-1 text-xs text-gray-500">Edit or disable a layer without touching the repository.</p>
                </div>
              </div>
              {loading ? <p className="text-sm text-gray-600">Loading…</p> : data.instructions.length === 0 ? <p className="rounded-md border border-dashed border-white/10 p-4 text-sm text-gray-600">No pinned instructions yet.</p> : (
                <div className="space-y-3">
                  {data.instructions.map((instruction) => (
                    <div key={instruction.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="text-sm font-medium">{instruction.name}</p><p className="mt-1 text-[11px] text-gray-600">Priority {instruction.priority} · v{instruction.version}</p></div>
                        <span className={`rounded-full px-2 py-1 text-[10px] ${instruction.enabled ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-gray-500'}`}>{instruction.enabled ? 'enabled' : 'disabled'}</span>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-400">{instruction.content}</p>
                      <div className="mt-3 flex gap-2">
                        <Button variant="ghost" disabled={busy} onClick={() => patch({ type: 'instruction', id: instruction.id, enabled: !instruction.enabled }, instruction.enabled ? 'Instruction disabled.' : 'Instruction enabled.')}>{instruction.enabled ? 'Disable' : 'Enable'}</Button>
                        <Button variant="ghost" disabled={busy} onClick={() => remove('instruction', instruction.id)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

          <section className="space-y-6">
            <Card>
              <div className="mb-5">
                <h2 className="font-semibold">Persistent memory</h2>
                <p className="mt-1 text-xs leading-5 text-gray-500">The agent proposes memories after verified runs. You decide what becomes active context.</p>
              </div>
              <form onSubmit={addMemory} className="space-y-3">
                <select value={memoryKind} onChange={(e) => setMemoryKind(e.target.value as (typeof MEMORY_KINDS)[number])} className="w-full rounded-md border border-white/10 bg-[#111419] px-3 py-2 text-sm text-gray-300 outline-none focus:border-blue-400/50">
                  {MEMORY_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                </select>
                <textarea value={memoryContent} onChange={(e) => setMemoryContent(e.target.value)} placeholder="The project uses a dark, dense developer dashboard..." rows={4} className="w-full resize-y rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm leading-6 outline-none placeholder:text-gray-600 focus:border-blue-400/50" />
                <Button type="submit" disabled={busy || !memoryContent.trim()}>Pin memory</Button>
              </form>
            </Card>

            <Card>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div><h2 className="font-semibold">Memory inbox</h2><p className="mt-1 text-xs text-gray-500">Review proposals before they influence future runs.</p></div>
                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] text-amber-300">{data.memories.filter((m) => m.status === 'proposed').length} proposed</span>
              </div>
              {loading ? <p className="text-sm text-gray-600">Loading…</p> : data.memories.length === 0 ? <p className="rounded-md border border-dashed border-white/10 p-4 text-sm text-gray-600">No memories yet. Complete a verified task to generate proposals.</p> : (
                <div className="space-y-3">
                  {data.memories.map((memory) => (
                    <div key={memory.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
                      <div className="flex items-center justify-between gap-3"><span className="text-[10px] uppercase tracking-wider text-gray-600">{memory.kind}</span><span className={`rounded-full px-2 py-1 text-[10px] ${statusTone(memory.status)}`}>{memory.status}</span></div>
                      <p className="mt-3 text-sm leading-6 text-gray-300">{memory.content}</p>
                      <p className="mt-2 text-[11px] text-gray-600">{memory.scope} · {Math.round(memory.confidence * 100)}% confidence{memory.pinned ? ' · pinned' : ''}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {memory.status !== 'active' && <Button variant="ghost" disabled={busy} onClick={() => patch({ type: 'memory', id: memory.id, status: 'active', pinned: true }, 'Memory activated.')}>Activate</Button>}
                        {memory.status === 'active' && <Button variant="ghost" disabled={busy} onClick={() => patch({ type: 'memory', id: memory.id, status: 'archived', pinned: false }, 'Memory archived.')}>Archive</Button>}
                        <Button variant="ghost" disabled={busy} onClick={() => remove('memory', memory.id)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>
        </div>

        <p className="mt-8 text-xs leading-5 text-gray-600">Signed in as {user.displayName || user.email || 'user'}. Task-scoped instructions, memories, and reusable profiles can be managed from the task control surface and dashboard.</p>
      </div>
    </main>
  );
}
