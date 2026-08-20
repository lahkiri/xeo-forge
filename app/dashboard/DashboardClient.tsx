'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { Button, Card, Eyebrow, StatusBadge } from '@/components/ui';
import { UploadButton, uploadToTask } from '@/components/UploadButton';
import type { AgentProfile, AgentSkill, AuthUser, Task, TaskMode } from '@/lib/types';

function modeLabel(mode: TaskMode): string {
  return mode === 'chat' ? 'Conversation' : mode === 'planning' ? 'Planned task' : 'Build run';
}

const STARTER_PROMPTS = [
  { label: 'Explore an idea', mode: 'chat' as const, prompt: 'Help me think through the next best step for this project.' },
  { label: 'Review my project', mode: 'planning' as const, prompt: 'Inspect this project and tell me what should be improved first.' },
  { label: 'Fix a problem', mode: 'planning' as const, prompt: 'Find the cause of this issue, propose a safe fix, and verify it.' },
];

export default function DashboardClient({
  user,
    initialTasks,
    initialBalance,
    localMode,
  }: {
    user: AuthUser;
    initialTasks: Task[];
    initialBalance?: number;
    localMode: boolean;
  }) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<'chat' | 'planning'>('chat');
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [profileId, setProfileId] = useState('');
  const [skillId, setSkillId] = useState('');
  const [staged, setStaged] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [choosingProject, setChoosingProject] = useState(false);

  useEffect(() => {
    Promise.all([fetch('/api/agent/profiles'), fetch('/api/agent/skills')])
      .then(async ([profileRes, skillRes]) => {
        if (profileRes.ok) setProfiles((await profileRes.json()).profiles || []);
        if (skillRes.ok) setSkills((await skillRes.json()).skills || []);
      })
      .catch((err) => {
        // Context layers are optional: a failed fetch must not block starting a
        // run, but it is logged rather than swallowed (AGENTS.md rule 3).
        console.warn('[workbench] could not load roles and workflows:', err);
      });

    window.xeoDesktop?.getProject()
      .then((project) => setProjectPath(project.path))
      .catch((err) => console.warn('[workbench] could not read the active project:', err));
    return window.xeoDesktopEvents?.onProjectChanged((project) => setProjectPath(project.path));
  }, []);

  async function refresh() {
    const response = await fetch('/api/tasks', { cache: 'no-store' });
    if (response.ok) setTasks((await response.json()).tasks || []);
  }

  async function chooseProject() {
    setError('');
    if (!window.xeoDesktop) {
      setError('Project folder selection is available in the Windows desktop app.');
      return;
    }
    setChoosingProject(true);
    try {
      const result = await window.xeoDesktop.chooseProject();
      if (result.error) setError(result.error);
      else if (result.path) setProjectPath(result.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not select project folder.');
    } finally {
      setChoosingProject(false);
    }
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!goal.trim()) return;
    if (localMode && mode === 'planning' && !projectPath) {
      setError('Choose a project folder before starting Work. Chat can run without a project folder.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: goal.trim(),
          mode,
          surface: mode === 'chat' ? 'chat' : 'work',
          projectPath,
          profileId: profileId || null,
          skillId: skillId || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Could not start this request.');
        return;
      }
      setGoal('');
      setProfileId('');
      setSkillId('');
      if (staged.length > 0) {
        for (const file of staged) {
          const upload = await uploadToTask(data.task.id, file);
          if (!upload.ok) console.error(`[workbench] upload failed for ${file.name}: ${upload.error}`);
        }
        setStaged([]);
      }
      router.push(`/tasks/${data.task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  const activeRuns = tasks.filter((task) => task.status === 'running' || task.status === 'pending' || task.status === 'planned').length;
  // Only enabled layers can be selected — a disabled role or workflow is
  // rejected server-side when the task is created.
  const enabledProfiles = profiles.filter((profile) => profile.enabled);
  const enabledSkills = skills.filter((skill) => skill.enabled);

  return (
    <AppShell user={user} balance={initialBalance} localMode={localMode} title="Workbench" subtitle="Chat with your agent, or start governed Work when you want it to inspect and change a project.">
      <div className="space-y-7">
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Card className="relative overflow-hidden border-cyan-300/10 bg-gradient-to-br from-cyan-300/[0.08] via-white/[0.035] to-violet-400/[0.06] p-6 sm:p-8">
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-300/[0.08] blur-3xl" />
            <div className="relative">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <Eyebrow>New interaction</Eyebrow>
                  <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">Start with the right level of agency.</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">{localMode ? 'Chat stays conversational. Work understands your intent, asks when needed, and only plans or changes the selected local project when you choose that path.' : 'Chat stays conversational. Work understands your intent, asks when needed, and only plans or changes a hosted project when you choose that path.'}</p>
                </div>
                <span className={`rounded-2xl border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${localMode ? 'border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-200/80' : 'border-violet-300/15 bg-violet-300/[0.07] text-violet-200/80'}`}>{localMode ? 'Local-first' : 'Hosted workspace'}</span>
              </div>

              <div className="mt-7 grid grid-cols-2 gap-2 rounded-2xl border border-white/[0.08] bg-black/20 p-1.5">
                <button type="button" onClick={() => setMode('chat')} className={`rounded-xl px-4 py-3 text-left transition ${mode === 'chat' ? 'bg-white/[0.1] text-white shadow-lg' : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'}`}>
                  <span className="block text-sm font-semibold">Chat</span>
                  <span className="mt-1 block text-[11px] text-current/60">Ask, explore, decide</span>
                </button>
                <button type="button" onClick={() => setMode('planning')} className={`rounded-xl px-4 py-3 text-left transition ${mode === 'planning' ? 'bg-violet-300/[0.14] text-violet-100 shadow-lg' : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'}`}>
                  <span className="block text-sm font-semibold">Work</span>
                  <span className="mt-1 block text-[11px] text-current/60">Understand, plan, execute</span>
                </button>
              </div>

              <form onSubmit={submitRequest} className="mt-4 space-y-4">
                <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={5} autoFocus placeholder={mode === 'chat' ? 'Ask a question, compare options, or explore an idea…' : 'Describe the outcome you want. Xeo will clarify, plan, and ask before acting…'} className="workbench-input w-full resize-y rounded-2xl px-4 py-4 text-sm leading-6 outline-none placeholder:text-gray-500" />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <UploadButton taskId={null} onStaged={(file) => setStaged((previous) => [...previous, file])} label="Attach files" />
                  <Button type="submit" size="lg" disabled={submitting || !goal.trim()}>{submitting ? 'Opening…' : mode === 'chat' ? 'Start chat' : 'Start Work'}<span aria-hidden="true">→</span></Button>
                </div>

                {/* Context layers. The API and schema have always accepted a
                    role and a workflow per task, and the task header renders
                    "role active" / "workflow active" — but there was no way to
                    choose them here, so they were permanently null. */}
                {(enabledProfiles.length > 0 || enabledSkills.length > 0) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {enabledProfiles.length > 0 && (
                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">Role</span>
                        <select
                          value={profileId}
                          onChange={(event) => setProfileId(event.target.value)}
                          className="workbench-input w-full rounded-xl px-3 py-2.5 text-xs outline-none"
                        >
                          <option value="">Default agent</option>
                          {enabledProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>{profile.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {enabledSkills.length > 0 && (
                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">Workflow</span>
                        <select
                          value={skillId}
                          onChange={(event) => setSkillId(event.target.value)}
                          className="workbench-input w-full rounded-xl px-3 py-2.5 text-xs outline-none"
                        >
                          <option value="">No workflow</option>
                          {enabledSkills.map((skill) => (
                            <option key={skill.id} value={skill.id}>{skill.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                )}

                {staged.length > 0 && <div className="flex flex-wrap gap-2">{staged.map((file, index) => <span key={`${file.name}-${index}`} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] text-gray-300"><span className="max-w-[13rem] truncate">{file.name}</span><button type="button" onClick={() => setStaged((previous) => previous.filter((_, itemIndex) => itemIndex !== index))} className="text-gray-500 hover:text-white" aria-label={`Remove ${file.name}`}>×</button></span>)}</div>}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[11px] text-gray-500"><span><strong className="font-medium text-gray-300">{mode === 'chat' ? 'Chat mode' : 'Work mode'}</strong> · {mode === 'chat' ? 'No plan or project changes unless you ask.' : projectPath ? `Working inside ${projectPath}` : 'Choose a project folder to enable execution.'}</span><span className={`rounded-full px-2 py-1 ${mode === 'chat' ? 'bg-cyan-300/10 text-cyan-200' : projectPath ? 'bg-violet-300/10 text-violet-200' : 'bg-amber-300/10 text-amber-200'}`}>{mode === 'chat' ? 'conversational' : projectPath ? 'governed work' : 'folder required'}</span></div>
                {error && <div role="alert" className="rounded-xl border border-red-300/15 bg-red-400/[0.08] px-3 py-2.5 text-xs leading-5 text-red-100"><strong className="font-semibold">Before you continue: </strong>{error}</div>}
              </form>
            </div>
          </Card>

          <Card className="p-5">
            <Eyebrow tone="violet">{localMode ? 'Project context' : 'Workspace context'}</Eyebrow>
            <h3 className="mt-3 text-lg font-semibold text-white">{localMode ? 'Where should the agent work?' : 'Keep each run focused.'}</h3>
            <p className="mt-2 text-xs leading-5 text-gray-500">{localMode ? 'Choose one folder. Tasks and tools stay inside this project boundary instead of using an invisible temporary workspace.' : 'Hosted tasks keep their project context with the task. Account, billing, and team controls remain on the web surface.'}</p>
            {localMode ? <>
              <div className="mt-5 rounded-xl border border-white/[0.08] bg-black/20 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-600">Active project</p>
                <p className="mt-2 break-all text-xs leading-5 text-gray-300">{projectPath || 'No folder selected yet'}</p>
              </div>
              <button type="button" onClick={chooseProject} disabled={choosingProject} className="mt-3 w-full rounded-xl border border-cyan-300/20 bg-cyan-300/[0.07] px-3 py-2.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/[0.13] disabled:opacity-50">{choosingProject ? 'Opening folder picker…' : projectPath ? 'Change project folder' : 'Choose project folder'}</button>
            </> : <div className="mt-5 rounded-xl border border-violet-300/10 bg-violet-300/[0.05] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200/60">Hosted surface</p><p className="mt-2 text-xs leading-5 text-gray-400">Project selection and team context are managed by the hosted workspace.</p></div>}
            <div className="mt-6 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">Active</p><p className="mt-1 text-lg font-semibold text-white">{activeRuns}</p></div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">Threads</p><p className="mt-1 text-lg font-semibold text-white">{tasks.length}</p></div>
            </div>
          </Card>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-3"><div><Eyebrow>{localMode ? 'Local history' : 'Workspace history'}</Eyebrow><h2 className="mt-2 text-xl font-semibold text-white">Conversations and tasks</h2></div><button onClick={refresh} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-white/[0.05] hover:text-gray-200">Refresh</button></div>
          {tasks.length === 0 ? <Card className="border-dashed border-cyan-300/15 bg-cyan-300/[0.025] p-6 sm:p-8"><div className="mx-auto max-w-2xl text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-200"><span className="text-xl">✦</span></div><p className="mt-4 text-lg font-semibold text-white">Your workspace is ready.</p><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-gray-400">Start with a conversation to explore an idea, or choose Work when you want Xeo to inspect and change a selected project under local safety controls.</p></div><div className="mt-7 grid gap-3 md:grid-cols-3">{STARTER_PROMPTS.map((starter) => <button key={starter.label} type="button" onClick={() => { setMode(starter.mode); setGoal(starter.prompt); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/25 hover:bg-cyan-300/[0.06]"><span className="text-sm font-semibold text-gray-100">{starter.label}</span><span className="mt-2 block text-xs leading-5 text-gray-500">{starter.prompt}</span><span className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Use starter →</span></button>)}</div></Card> : <div className="grid gap-3">{tasks.map((task) => <Link key={task.id} href={`/tasks/${task.id}`}><Card interactive className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><span className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${task.mode === 'chat' ? 'bg-cyan-300/[0.08] text-cyan-200/80' : 'bg-violet-300/[0.08] text-violet-200/80'}`}>{modeLabel(task.mode)}</span>{task.project_path && <span className="max-w-[18rem] truncate text-[10px] text-gray-600">{task.project_path}</span>}</div><p className="line-clamp-2 text-sm font-medium text-gray-200">{task.goal}</p><div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500"><span>{new Date(task.created_at).toLocaleString()}</span><span>{task.status}</span></div></div><StatusBadge status={task.status} /></div></Card></Link>)}</div>}
        </section>
      </div>
    </AppShell>
  );
}
