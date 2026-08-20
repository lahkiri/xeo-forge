'use client';

import { useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';
import type { AgentProfile, AgentProfileKind } from '@/lib/types';

const kinds: AgentProfileKind[] = ['builder', 'researcher', 'analyst', 'operator', 'custom'];

export default function ProfileStudio() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AgentProfileKind>('builder');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const res = await fetch('/api/agent/profiles');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not load profiles.');
    setProfiles(body.profiles || []);
  }

  useEffect(() => { void load().catch((err) => setError(err instanceof Error ? err.message : 'Could not load profiles.')); }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !instructions.trim()) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/agent/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, kind, description, instructions }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not create profile.');
      setName(''); setDescription(''); setInstructions('');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create profile.'); }
    finally { setBusy(false); }
  }

  async function toggle(profile: AgentProfile) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/agent/profiles', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: profile.id, enabled: !profile.enabled }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not update profile.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update profile.'); }
    finally { setBusy(false); }
  }

  async function remove(profile: AgentProfile) {
    if (!window.confirm(`Delete the ${profile.name} profile? Existing tasks keep their snapshot reference.`)) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/agent/profiles', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: profile.id }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not delete profile.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete profile.'); }
    finally { setBusy(false); }
  }

  return (
    <Card className="mb-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">PROFILE STUDIO</p>
          <h2 className="mt-1 font-semibold">Reusable agent roles</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-content-muted">Create a focused operating mode for building, research, analysis, or operations. Profiles guide behavior; they never grant permissions or bypass approval.</p>
        </div>
        <span className="rounded-full bg-purple-500/10 px-2.5 py-1 text-micro text-purple-300">{profiles.filter((p) => p.enabled).length} enabled</span>
      </div>
      {error && <p className="mb-3 rounded-md border border-red-500/20 bg-signal-fail/10 px-3 py-2 text-xs text-signal-fail">{error}</p>}
      <form onSubmit={create} className="grid gap-3 md:grid-cols-[1fr_150px]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Profile name, e.g. Senior Builder" className="rounded-md border border-line bg-ink-700/60 px-3 py-2 text-sm outline-none placeholder:text-content-muted focus:border-purple-400/50" />
        <select value={kind} onChange={(e) => setKind(e.target.value as AgentProfileKind)} className="rounded-md border border-line bg-[#111419] px-3 py-2 text-sm text-content-secondary outline-none focus:border-purple-400/50">{kinds.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" className="rounded-md border border-line bg-ink-700/60 px-3 py-2 text-sm outline-none placeholder:text-content-muted focus:border-purple-400/50 md:col-span-2" />
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} placeholder="You are a senior engineer. Prefer small reversible changes, run tests, and explain trade-offs…" className="w-full resize-y rounded-md border border-line bg-ink-700/60 px-3 py-2 text-sm leading-6 outline-none placeholder:text-content-muted focus:border-purple-400/50 md:col-span-2" />
        <div className="md:col-span-2"><Button type="submit" disabled={busy || !name.trim() || !instructions.trim()}>Create profile</Button></div>
      </form>
      {profiles.length > 0 && <div className="mt-5 grid gap-3 md:grid-cols-2">{profiles.map((profile) => <div key={profile.id} className="rounded-control border border-line-subtle bg-ink-700/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-content-primary">{profile.name}</p><p className="mt-1 text-micro uppercase tracking-wider text-content-muted">{profile.kind} · v{profile.version}</p></div><span className={`rounded-full px-2 py-1 text-micro ${profile.enabled ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-content-muted'}`}>{profile.enabled ? 'enabled' : 'disabled'}</span></div><p className="mt-3 line-clamp-3 text-xs leading-5 text-content-muted">{profile.description || profile.instructions}</p><div className="mt-3 flex gap-2"><Button variant="ghost" disabled={busy} onClick={() => void toggle(profile)}>{profile.enabled ? 'Disable' : 'Enable'}</Button><Button variant="ghost" disabled={busy} onClick={() => void remove(profile)}>Delete</Button></div></div>)}</div>}
    </Card>
  );
}
