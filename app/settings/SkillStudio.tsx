'use client';

import { useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';
import type { AgentProfile, AgentSkill, AgentSkillKind } from '@/lib/types';

const kinds: AgentSkillKind[] = ['build', 'research', 'analysis', 'operations', 'content', 'custom'];

export default function SkillStudio() {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AgentSkillKind>('build');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [profileId, setProfileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const [skillRes, profileRes] = await Promise.all([fetch('/api/agent/skills'), fetch('/api/agent/profiles')]);
    const skillBody = await skillRes.json();
    const profileBody = await profileRes.json();
    if (!skillRes.ok) throw new Error(skillBody.error || 'Could not load skills.');
    setSkills(skillBody.skills || []);
    if (profileRes.ok) setProfiles(profileBody.profiles || []);
  }

  useEffect(() => { void load().catch((err) => setError(err instanceof Error ? err.message : 'Could not load skills.')); }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !instructions.trim()) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/agent/skills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, kind, description, instructions, profileId: profileId || null }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not create skill.');
      setName(''); setDescription(''); setInstructions(''); setProfileId('');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create skill.'); }
    finally { setBusy(false); }
  }

  async function toggle(skill: AgentSkill) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/agent/skills', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: skill.id, enabled: !skill.enabled }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not update skill.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update skill.'); }
    finally { setBusy(false); }
  }

  async function remove(skill: AgentSkill) {
    if (!window.confirm(`Delete the ${skill.name} workflow? Existing tasks keep their reference.`)) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/agent/skills', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: skill.id }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not delete skill.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete skill.'); }
    finally { setBusy(false); }
  }

  return (
    <Card className="mb-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">SKILL STUDIO</p>
          <h2 className="mt-1 font-semibold">Reusable workflows</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-content-muted">Turn a repeatable process into a selectable skill. A skill provides workflow guidance and an optional profile; approvals, policies, and sandbox limits remain enforced by Xeo.</p>
        </div>
        <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-micro text-cyan-300">{skills.filter((s) => s.enabled).length} enabled</span>
      </div>
      {error && <p className="mb-3 rounded-md border border-red-500/20 bg-signal-fail/10 px-3 py-2 text-xs text-signal-fail">{error}</p>}
      <form onSubmit={create} className="grid gap-3 md:grid-cols-[1fr_150px]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Skill name, e.g. Ship a production feature" className="rounded-md border border-line bg-ink-700/60 px-3 py-2 text-sm outline-none placeholder:text-content-muted focus:border-cyan-400/50" />
        <select value={kind} onChange={(e) => setKind(e.target.value as AgentSkillKind)} className="rounded-md border border-line bg-[#111419] px-3 py-2 text-sm text-content-secondary outline-none focus:border-cyan-400/50">{kinds.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" className="rounded-md border border-line bg-ink-700/60 px-3 py-2 text-sm outline-none placeholder:text-content-muted focus:border-cyan-400/50 md:col-span-2" />
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={4} placeholder="1. Inspect the repository. 2. Propose a plan. 3. Implement in small slices. 4. Run tests and report evidence…" className="w-full resize-y rounded-md border border-line bg-ink-700/60 px-3 py-2 text-sm leading-6 outline-none placeholder:text-content-muted focus:border-cyan-400/50 md:col-span-2" />
        <div className="flex flex-wrap items-center gap-3 md:col-span-2"><select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="rounded-md border border-line bg-[#111419] px-3 py-2 text-xs text-content-secondary outline-none focus:border-cyan-400/50"><option value="">No profile override</option>{profiles.filter((p) => p.enabled).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><Button type="submit" disabled={busy || !name.trim() || !instructions.trim()}>Create skill</Button></div>
      </form>
      {skills.length > 0 && <div className="mt-5 grid gap-3 md:grid-cols-2">{skills.map((skill) => <div key={skill.id} className="rounded-control border border-line-subtle bg-ink-700/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-content-primary">{skill.name}</p><p className="mt-1 text-micro uppercase tracking-wider text-content-muted">{skill.kind} · v{skill.version}</p></div><span className={`rounded-full px-2 py-1 text-micro ${skill.enabled ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-content-muted'}`}>{skill.enabled ? 'enabled' : 'disabled'}</span></div><p className="mt-3 line-clamp-3 text-xs leading-5 text-content-muted">{skill.description || skill.instructions}</p><div className="mt-3 flex gap-2"><Button variant="ghost" disabled={busy} onClick={() => void toggle(skill)}>{skill.enabled ? 'Disable' : 'Enable'}</Button><Button variant="ghost" disabled={busy} onClick={() => void remove(skill)}>Delete</Button></div></div>)}</div>}
    </Card>
  );
}
