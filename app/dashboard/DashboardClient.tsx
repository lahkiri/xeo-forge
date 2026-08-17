'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { Button, Card, Eyebrow, Metric, StatusBadge } from '@/components/ui';
import { UploadButton, uploadToTask } from '@/components/UploadButton';
import type { AgentProfile, AgentSkill, AuthUser, Task } from '@/lib/types';

export default function DashboardClient({
  user,
  initialTasks,
  initialBalance,
}: {
  user: AuthUser;
  initialTasks: Task[];
  initialBalance: number;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [balance, setBalance] = useState(initialBalance);
  const [goal, setGoal] = useState('');
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [profileId, setProfileId] = useState('');
  const [skillId, setSkillId] = useState('');
  const [staged, setStaged] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([fetch('/api/agent/profiles'), fetch('/api/agent/skills')]).then(async ([profileRes, skillRes]) => {
      if (profileRes.ok) setProfiles((await profileRes.json()).profiles || []);
      if (skillRes.ok) setSkills((await skillRes.json()).skills || []);
    }).catch(() => {});
  }, []);

  async function refresh() {
    const [tRes, cRes] = await Promise.all([fetch('/api/tasks'), fetch('/api/credits')]);
    if (tRes.ok) setTasks((await tRes.json()).tasks);
    if (cRes.ok) setBalance((await cRes.json()).balance);
  }

  async function submitTask(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!goal.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal, profileId: profileId || null, skillId: skillId || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(res.status === 402 ? `Insufficient credits (balance ${data.balance}, need ${data.needed}).` : data.error || 'Failed to create task');
        return;
      }
      setGoal('');
      setProfileId('');
      setSkillId('');
      if (staged.length > 0) {
        for (const f of staged) {
          const r = await uploadToTask(data.task.id, f);
          if (!r.ok) console.error(`[dashboard] upload failed for ${f.name}: ${r.error}`);
        }
        setStaged([]);
      }
      router.push(`/tasks/${data.task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  const activeTasks = tasks.filter((task) => task.status === 'running' || task.status === 'planned').length;
  const completedTasks = tasks.filter((task) => task.status === 'completed').length;
  const enabledProfiles = profiles.filter((profile) => profile.enabled).length;
  const enabledSkills = skills.filter((skill) => skill.enabled).length;

  return (
    <AppShell user={user} balance={balance} title="Workbench" subtitle="Turn intent into governed execution. Pick the behavior layers first, then let the run prove its work.">
      <div className="space-y-8">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Active runs" value={activeTasks} detail="Planning or executing now" />
          <Metric label="Completed" value={completedTasks} detail="Auditable outcomes" />
          <Metric label="Control layers" value={`${enabledProfiles + enabledSkills}`} detail={`${enabledProfiles} roles · ${enabledSkills} workflows`} />
          <Metric label="Credits" value={balance} detail="Available execution budget" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <Card className="relative overflow-hidden border-cyan-300/10 bg-gradient-to-br from-cyan-300/[0.08] via-white/[0.035] to-violet-400/[0.06] p-6 sm:p-8">
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-300/[0.08] blur-3xl" />
            <div className="relative">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <Eyebrow>New governed run</Eyebrow>
                  <h2 className="mt-3 max-w-xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">What should your agents accomplish?</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">Describe the outcome, attach the evidence, and choose the operating model. Xeo Forge keeps the boundary visible before work begins.</p>
                </div>
                <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.08] px-3 py-2 text-right">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">Execution model</p>
                  <p className="mt-1 text-xs font-semibold text-cyan-100">Plan → Approve → Build</p>
                </div>
              </div>

              <form onSubmit={submitTask} className="mt-7 space-y-4">
                <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={4} placeholder="e.g. Audit the onboarding flow, identify the highest-risk friction, and propose reversible changes with evidence..." className="w-full resize-y rounded-2xl border border-white/[0.1] bg-[#070b12]/70 px-4 py-3.5 text-sm leading-6 text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-cyan-300/50 focus:ring-4 focus:ring-cyan-300/[0.08]" />
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">Role / profile</span>
                    <select id="agent-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)} className="w-full rounded-xl border border-white/[0.1] bg-[#070b12]/80 px-3 py-2.5 text-xs text-gray-200 outline-none focus:border-violet-300/50">
                      <option value="">Xeo default · balanced operator</option>
                      {profiles.filter((p) => p.enabled).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.kind}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">Workflow / skill</span>
                    <select id="agent-skill" value={skillId} onChange={(e) => setSkillId(e.target.value)} className="w-full rounded-xl border border-white/[0.1] bg-[#070b12]/80 px-3 py-2.5 text-xs text-gray-200 outline-none focus:border-cyan-300/50">
                      <option value="">No workflow override</option>
                      {skills.filter((s) => s.enabled).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.kind}</option>)}
                    </select>
                  </label>
                </div>
                {(profiles.length > 0 || skills.length > 0) && <Link href="/settings" className="inline-flex text-xs text-cyan-300/80 transition hover:text-cyan-200">Configure control layers →</Link>}
                {error && <p className="rounded-xl border border-red-300/15 bg-red-400/[0.08] px-3 py-2 text-xs text-red-200">{error}</p>}
                {staged.length > 0 && <div className="flex flex-wrap gap-2">{staged.map((f, i) => <span key={`${f.name}-${i}`} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] text-gray-300"><span className="max-w-[13rem] truncate">{f.name}</span><button type="button" onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))} className="text-gray-500 hover:text-white" aria-label={`Remove ${f.name}`}>×</button></span>)}</div>}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <UploadButton taskId={null} onStaged={(f) => setStaged((prev) => [...prev, f])} label="Attach evidence" />
                  <Button type="submit" size="lg" disabled={submitting || !goal.trim()}>{submitting ? 'Preparing run…' : 'Create governed run'}<span aria-hidden="true">→</span></Button>
                </div>
              </form>
            </div>
          </Card>

          <Card className="p-5">
            <Eyebrow tone="violet">Control posture</Eyebrow>
            <h3 className="mt-3 text-lg font-semibold text-white">Behavior is a product surface.</h3>
            <p className="mt-2 text-xs leading-5 text-gray-500">Profiles define how an agent thinks. Skills define how it moves. Memory makes the next run smarter.</p>
            <div className="mt-6 space-y-3">
              {[['Profile', enabledProfiles, 'Reusable roles'], ['Skill', enabledSkills, 'Repeatable workflows'], ['Memory', '∞', 'Persistent context']].map(([label, value, detail]) => <div key={label as string} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-black/10 px-3 py-2.5"><span><span className="block text-xs font-medium text-gray-300">{label}</span><span className="block text-[10px] text-gray-600">{detail}</span></span><span className="text-sm font-semibold text-cyan-200">{value}</span></div>)}
            </div>
            <Link href="/settings" className="mt-5 block text-center text-xs font-medium text-violet-300/90 hover:text-violet-200">Open Control Center →</Link>
          </Card>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-3"><div><Eyebrow>Run ledger</Eyebrow><h2 className="mt-2 text-xl font-semibold text-white">Your work</h2></div><button onClick={refresh} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-white/[0.05] hover:text-gray-200">Refresh</button></div>
          {tasks.length === 0 ? <Card className="border-dashed py-14 text-center"><p className="text-sm font-medium text-gray-300">Your run ledger is empty.</p><p className="mt-1 text-xs text-gray-500">Create a governed run above to start building an auditable trail.</p></Card> : <div className="grid gap-3">{tasks.map((t) => <Link key={t.id} href={`/tasks/${t.id}`}><Card interactive className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="line-clamp-2 text-sm font-medium text-gray-200">{t.goal}</p><div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500"><span>{new Date(t.created_at).toLocaleString()}</span><span>{t.credits_spent} credits</span><span className="text-gray-600">Open run details →</span></div></div><StatusBadge status={t.status} /></div></Card></Link>)}</div>}
        </section>
      </div>
    </AppShell>
  );
}
