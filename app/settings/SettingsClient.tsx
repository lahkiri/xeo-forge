'use client';

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { Button, Card, Eyebrow } from '@/components/ui';
import type { AgentInstruction, AgentMemory, AuthUser } from '@/lib/types';
import ProfileStudio from './ProfileStudio';
import SkillStudio from './SkillStudio';

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

export default function SettingsClient({ user, localMode }: { user: AuthUser; localMode: boolean }) {
  const [data, setData] = useState<ContextResponse>({ instructions: [], memories: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [instructionName, setInstructionName] = useState('');
  const [instructionContent, setInstructionContent] = useState('');
  const [instructionPriority, setInstructionPriority] = useState('100');
  const [memoryContent, setMemoryContent] = useState('');
  const [memoryKind, setMemoryKind] = useState<(typeof MEMORY_KINDS)[number]>('lesson');
  const [browserState, setBrowserState] = useState<DesktopBrowserState | null>(null);
  const [showBrowserToken, setShowBrowserToken] = useState(false);

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

  useEffect(() => {
    const desktop = window.xeoDesktop;
    if (!desktop) return;
    let active = true;
    const refresh = () => desktop.getBrowserState().then((state) => { if (active) setBrowserState(state); }).catch((error) => console.warn('[desktop] browser state unavailable', error));
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

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
    <AppShell user={user} localMode={localMode} title={localMode ? 'Control Center' : 'Workspace Control Center'} subtitle={localMode ? 'Shape how Xeo works locally—without accounts, billing, or source-code edits.' : 'Shape how agents think, what they remember, and which workflows they can reuse—without editing source code.'}>
      <div className="space-y-8">
        <header className="max-w-3xl">
          <Eyebrow>Prompt Studio</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Make agent behavior explicit.</h2>
          <p className="mt-3 text-sm leading-6 text-gray-400">Persistent instructions, reusable roles, skills, and memory are compiled into future runs as visible control layers. You decide what is active.</p>
        </header>

        {notice && (
          <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${notice.type === 'ok' ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-red-500/20 bg-red-500/10 text-red-300'}`}>
            {notice.text}
          </div>
        )}

        <section className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.035] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Eyebrow>Optional local capability</Eyebrow>
              <h2 className="mt-2 font-semibold text-white">User-controlled browser</h2>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-gray-400">Install the extension in the browser profile you want Xeo Forge to use. The selected local profile remains attached to Work until you change it; the bridge never silently switches to another browser.</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] ${browserState?.connected ? 'bg-emerald-400/10 text-emerald-300' : browserState?.selection === 'selected_disconnected' ? 'bg-amber-400/10 text-amber-300' : 'bg-white/[0.06] text-gray-500'}`}>{browserState?.connected ? 'selected · connected' : browserState?.selection === 'selected_disconnected' ? 'selected · disconnected' : 'connect a profile'}</span>
          </div>
          {browserState && (
            <div className="mt-5 space-y-4">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                <div className="rounded-xl border border-white/[0.07] bg-black/10 p-4">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-gray-600">Local extension token · port {browserState.port}</p>
                  <code className="mt-2 block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-cyan-200/80">{showBrowserToken ? browserState.token : '••••••••••••••••••••••••••••••••'}</code>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => setShowBrowserToken((value) => !value)}>{showBrowserToken ? 'Hide token' : 'Reveal token'}</Button>
                    <Button variant="ghost" disabled={!browserState.token} onClick={() => browserState.token && navigator.clipboard.writeText(browserState.token)}>Copy token</Button>
                    <Button variant="ghost" onClick={() => window.xeoDesktop?.openBrowserExtension().catch((error) => setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not open extension folder.' }))}>Open extension folder</Button>
                  </div>
                </div>
                <div className="max-w-xs text-xs leading-5 text-gray-500"><p className="text-gray-300">Read access is the default.</p><p className="mt-1">Navigation, clicks, typing, and form submission remain blocked until a separate interaction policy is granted.</p></div>
              </div>
              {browserState.profiles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-gray-500">No browser profile is connected yet. Load the unpacked extension, paste the token, and give this profile a name.</div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {browserState.profiles.map((profile) => {
                    const selected = profile.browserId === browserState.selectedBrowserId;
                    return (
                      <div key={profile.browserId} className={`rounded-xl border p-4 ${selected ? 'border-cyan-300/30 bg-cyan-300/[0.06]' : 'border-white/[0.07] bg-black/10'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{profile.profileName}</p>
                            <p className="mt-1 text-[11px] text-gray-500">{profile.browserName} · {profile.connected ? 'connected' : 'disconnected'}</p>
                          </div>
                          {selected && <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-200">selected for Work</span>}
                        </div>
                        <p className="mt-3 truncate text-xs text-gray-400">{profile.tab?.title || 'No active tab reported'}</p>
                        <p className="mt-1 truncate text-[11px] text-gray-600">{profile.tab?.url || '—'}</p>
                        <Button variant="ghost" className="mt-3" disabled={!profile.connected || selected} onClick={() => window.xeoDesktop?.selectBrowser(profile.browserId).then(setBrowserState).catch((error) => setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not select browser profile.' }))}>{selected ? 'Using this profile' : 'Use for Work'}</Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        <ProfileStudio />
        <SkillStudio />

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

        <p className="pt-2 text-xs leading-5 text-gray-600">{localMode ? 'Local Owner workspace. Instructions, memories, browser profiles, and reusable roles stay on this device.' : `Signed in as ${user.displayName || user.email || 'user'}. Task-scoped instructions, memories, and reusable profiles can be managed from the task control surface and dashboard.`}</p>
      </div>
    </AppShell>
  );
}
