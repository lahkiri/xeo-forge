'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Card, Dialog } from '@/components/ui';
import type { AgentProfile, AgentSkill, AgentSkillKind } from '@/lib/types';
import SkillHub from './SkillHub';

const kinds: AgentSkillKind[] = ['build', 'research', 'analysis', 'operations', 'content', 'custom'];

type Notice = { tone: 'ok' | 'error'; text: string } | null;

export default function SkillStudio() {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AgentSkillKind>('build');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [profileId, setProfileId] = useState('');
  const [studioOpen, setStudioOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubSource, setGithubSource] = useState('');
  const [githubSkillId, setGithubSkillId] = useState('');
  const [githubRef, setGithubRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const localFileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [skillRes, profileRes] = await Promise.all([fetch('/api/agent/skills'), fetch('/api/agent/profiles')]);
    const skillBody = await skillRes.json();
    const profileBody = await profileRes.json();
    if (!skillRes.ok) throw new Error(skillBody.error || 'Could not load skills.');
    setSkills(skillBody.skills || []);
    if (profileRes.ok) setProfiles(profileBody.profiles || []);
  }

  useEffect(() => { void load().catch((err) => setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not load skills.' })); }, []);

  function resetCreateForm() {
    setName(''); setKind('build'); setDescription(''); setInstructions(''); setProfileId('');
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !instructions.trim()) return;
    setBusy(true); setNotice(null);
    try {
      const res = await fetch('/api/agent/skills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, kind, description, instructions, profileId: profileId || null }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not create skill.');
      resetCreateForm(); setStudioOpen(false); setNotice({ tone: 'ok', text: 'Skill created and is ready to select in Work.' }); await load();
    } catch (err) { setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not create skill.' }); }
    finally { setBusy(false); }
  }

  async function importGithub(event: React.FormEvent) {
    event.preventDefault();
    if (!githubSource.trim() || !githubSkillId.trim()) return;
    setBusy(true); setNotice(null);
    try {
      const res = await fetch('/api/skill-hub/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: githubSource, skillId: githubSkillId, ref: githubRef || undefined }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not import GitHub skill.');
      setGithubOpen(false); setGithubSource(''); setGithubSkillId(''); setGithubRef(''); setNotice({ tone: 'ok', text: 'GitHub skill imported with its supporting files.' }); await load();
    } catch (err) { setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not import GitHub skill.' }); }
    finally { setBusy(false); }
  }

  async function importLocal(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLocalBusy(true); setNotice(null);
    try {
      const form = new FormData(); form.append('file', file);
      const res = await fetch('/api/skill-hub/import-local', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not import local skill.');
      setNotice({ tone: 'ok', text: 'Local skill imported with its supporting files.' }); await load();
    } catch (err) { setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not import local skill.' }); }
    finally { setLocalBusy(false); }
  }

  async function toggle(skill: AgentSkill) {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch('/api/agent/skills', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: skill.id, enabled: !skill.enabled }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not update skill.');
      await load();
    } catch (err) { setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not update skill.' }); }
    finally { setBusy(false); }
  }

  async function remove(skill: AgentSkill) {
    if (!window.confirm(`Delete the ${skill.name} workflow? Existing tasks keep their reference.`)) return;
    setBusy(true); setNotice(null);
    try {
      const res = await fetch('/api/agent/skills', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: skill.id }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not delete skill.');
      await load();
    } catch (err) { setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not delete skill.' }); }
    finally { setBusy(false); }
  }

  return (
    <Card className="mb-6">
      <SkillHub installedSources={skills.filter((skill) => skill.source_id && ['skills_sh', 'github'].includes(skill.source_type)).map((skill) => skill.source_id as string)} onInstalled={load} />
      <section className="mt-8">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-meta font-semibold uppercase tracking-[0.18em] text-signal-run">SKILL STUDIO</p><h2 className="mt-1 font-semibold">Installed skills</h2><p className="mt-1 max-w-2xl text-meta leading-5 text-content-muted">Create, import, and manage the workflows that appear in Work. Discovery stays in Skill Hub; these actions change your local catalog.</p></div>
          <span className="rounded-full bg-signal-run/10 px-2.5 py-1 text-micro text-signal-run">{skills.filter((skill) => skill.enabled).length} enabled</span>
        </div>
        <div className="skill-studio-actions"><Button onClick={() => { setNotice(null); setStudioOpen(true); }}>+ Create skill</Button><Button variant="secondary" onClick={() => localFileRef.current?.click()} loading={localBusy}>Import from local</Button><Button variant="secondary" onClick={() => { setNotice(null); setGithubOpen(true); }}>Import from GitHub</Button><input ref={localFileRef} type="file" className="hidden" accept=".md,.zip,.tar,.gz,.tgz" onChange={importLocal} /></div>
        {notice && <p className={`mt-4 skill-hub-notice ${notice.tone}`}>{notice.text}</p>}
        {skills.length > 0 && <div className="mt-5 grid gap-3 md:grid-cols-2">{skills.map((skill) => <div key={skill.id} className="rounded-control border border-line-subtle bg-ink-700/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-ui font-medium text-content-primary">{skill.name}</p><p className="mt-1 text-micro uppercase tracking-wider text-content-muted">{skill.kind} · v{skill.version}{skill.source_type === 'skills_sh' ? ` · Skill Hub${skill.source_id ? ` · ${skill.source_id}` : ''}` : skill.source_type === 'local' && skill.source_id ? ' · Local import' : ''}</p></div><span className={`rounded-full px-2 py-1 text-micro ${skill.enabled ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-content-muted'}`}>{skill.enabled ? 'enabled' : 'disabled'}</span></div><p className="mt-3 line-clamp-3 text-meta leading-5 text-content-muted">{skill.description || skill.instructions}</p>{skill.source_type !== 'local' || skill.source_id ? <p className="mt-2 text-micro text-content-muted">Imported folder · {(() => { try { return JSON.parse(skill.files_json || '[]').length; } catch { return 0; } })()} files · resources remain inert until explicitly used.</p> : null}<div className="mt-3 flex gap-2"><Button variant="ghost" disabled={busy} onClick={() => void toggle(skill)}>{skill.enabled ? 'Disable' : 'Enable'}</Button><Button variant="ghost" disabled={busy} onClick={() => void remove(skill)}>Delete</Button></div></div>)}</div>}
      </section>
      <Dialog open={studioOpen} onClose={() => setStudioOpen(false)} title="Create a skill" description="Define a reusable workflow. It will appear in Work after you save it." width="lg"><form onSubmit={create} className="grid gap-3 md:grid-cols-[1fr_150px]"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Skill name" className="skill-modal-input" /><select value={kind} onChange={(event) => setKind(event.target.value as AgentSkillKind)} className="skill-modal-input">{kinds.map((item) => <option key={item} value={item}>{item}</option>)}</select><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short description" className="skill-modal-input md:col-span-2" /><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={8} placeholder="Write the workflow instructions…" className="skill-modal-input resize-y md:col-span-2" /><select value={profileId} onChange={(event) => setProfileId(event.target.value)} className="skill-modal-input md:col-span-2"><option value="">No profile override</option>{profiles.filter((profile) => profile.enabled).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><div className="flex justify-end gap-2 md:col-span-2"><Button type="button" variant="ghost" onClick={() => setStudioOpen(false)}>Cancel</Button><Button type="submit" loading={busy} disabled={!name.trim() || !instructions.trim()}>Create skill</Button></div></form></Dialog>
      <Dialog open={githubOpen} onClose={() => setGithubOpen(false)} title="Import from GitHub" description="Import a public repository skill folder containing SKILL.md and optional resources." width="md"><form onSubmit={importGithub} className="grid gap-3"><label className="skill-modal-label">Repository source<input autoFocus value={githubSource} onChange={(event) => setGithubSource(event.target.value)} placeholder="owner/repository" className="skill-modal-input mt-1" /></label><label className="skill-modal-label">Skill folder<input value={githubSkillId} onChange={(event) => setGithubSkillId(event.target.value)} placeholder="skill-name" className="skill-modal-input mt-1" /></label><label className="skill-modal-label">Git ref <span className="text-content-faint">optional</span><input value={githubRef} onChange={(event) => setGithubRef(event.target.value)} placeholder="main" className="skill-modal-input mt-1" /></label><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setGithubOpen(false)}>Cancel</Button><Button type="submit" loading={busy} disabled={!githubSource.trim() || !githubSkillId.trim()}>Import skill</Button></div></form></Dialog>
    </Card>
  );
}
