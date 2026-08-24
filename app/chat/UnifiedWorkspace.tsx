'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AgentProfile, AgentSkill } from '@/lib/types';
import {
  Alert,
  Button,
  IconButton,
  KeyHint,
  Select,
  StatusBadge,
  cx,
  useModKey,
} from '@/components/ui';
import { UploadButton, uploadToTask } from '@/components/UploadButton';

type WorkspaceMode = 'chat' | 'work';

type Thread = { id: string; goal: string; status: string; updated_at: string };
type Run = { id: string; goal: string; status: string; mode: string };

const CHAT_STARTERS = [
  { label: 'Think through a decision', prompt: 'Help me compare the tradeoffs and recommend a practical path.' },
  { label: 'Explain a technical issue', prompt: 'Explain this error clearly, then suggest the safest next step.' },
  { label: 'Shape an idea', prompt: 'Help me turn this rough idea into a focused, executable brief.' },
];

const WORK_STARTERS = [
  { label: 'Fix a failing test', prompt: 'The auth session test is failing. Find the cause and fix it.' },
  { label: 'Add a feature', prompt: 'Add pagination to the users list endpoint, with tests.' },
  { label: 'Audit the code', prompt: 'Review error handling across the API routes and report every silent failure.' },
];

export default function UnifiedWorkspace({
  threads,
  runs,
  profiles,
  skills,
  balance,
  localMode,
}: {
  threads: Thread[];
  runs: Run[];
  profiles: AgentProfile[];
  skills: AgentSkill[];
  balance?: number;
  localMode: boolean;
}) {
  const router = useRouter();
  const mod = useModKey();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<WorkspaceMode>('chat');
  const [draft, setDraft] = useState('');
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [profileId, setProfileId] = useState('');
  const [skillId, setSkillId] = useState('');
  const [staged, setStaged] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [choosingProject, setChoosingProject] = useState(false);

  const workNeedsProject = mode === 'work' && localMode && !projectPath;
  const starters = mode === 'chat' ? CHAT_STARTERS : WORK_STARTERS;
  const title = mode === 'chat' ? 'A calmer place to think.' : 'A clear path from intent to execution.';
  const description = mode === 'chat'
    ? 'Ask questions, explore decisions, and shape the next move. Chat is read-only and keeps the conversation focused.'
    : 'Describe the outcome. Xeo inspects the project first, prepares a plan, and waits for your approval before writing or running commands.';

  async function chooseProject() {
    setError('');
    if (!window.xeoDesktop) {
      setError('Project folder selection is available in the desktop app.');
      return;
    }
    setChoosingProject(true);
    try {
      const result = await window.xeoDesktop.chooseProject();
      if (result.error) setError(result.error);
      else if (result.path) setProjectPath(result.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not select a project folder.');
    } finally {
      setChoosingProject(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setError('');
    if (workNeedsProject) {
      setError('Choose a project folder first. Work always runs inside an explicit boundary.');
      return;
    }
    setSending(true);
    try {
      const isWork = mode === 'work';
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: text,
          mode: isWork ? 'planning' : 'chat',
          surface: isWork ? 'work' : 'chat',
          ...(isWork ? {
            projectPath,
            profileId: profileId || null,
            skillId: skillId || null,
          } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Could not start this ${mode} session.`);
        return;
      }
      if (isWork) {
        for (const file of staged) {
          const upload = await uploadToTask(data.task.id, file);
          if (!upload.ok) console.warn(`[work] upload failed for ${file.name}: ${upload.error}`);
        }
      }
      router.push(isWork ? `/work/${data.task.id}` : `/chat/${data.task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSending(false);
    }
  }

  function onComposerKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (mode === 'chat' ? !event.shiftKey : (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      void send();
    }
  }

  const recentItems = [
    ...threads.map((thread) => ({ ...thread, kind: 'chat' as const })),
    ...runs.map((run) => ({ ...run, kind: 'work' as const, updated_at: '' })),
  ];

  return (
    <div className="unified-workspace flex h-full min-h-0">
      <aside className="unified-history hidden w-64 shrink-0 flex-col border-r border-line-subtle md:flex">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line-subtle px-4">
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.18em] text-content-faint">Workspace</p>
            <p className="mt-0.5 text-ui font-medium text-content-primary">Recent activity</p>
          </div>
          <Link href="/chat" aria-label="New workspace session">
            <IconButton label="New session" size="sm"><span aria-hidden="true" className="text-ui">+</span></IconButton>
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {recentItems.length === 0 ? (
            <p className="px-2 py-8 text-meta leading-5 text-content-muted">Your recent sessions will appear here.</p>
          ) : (
            <div className="space-y-1">
              {recentItems.map((item) => (
                <Link
                  key={`${item.kind}-${item.id}`}
                  href={item.kind === 'work' ? `/work/${item.id}` : `/chat/${item.id}`}
                  className="unified-history-item group block rounded-control px-3 py-2.5 text-content-muted transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-micro uppercase tracking-[0.14em] text-content-faint">{item.kind === 'work' ? 'Work' : 'Chat'}</span>
                    {item.kind === 'work' && <StatusBadge status={item.status} />}
                  </div>
                  <span className="mt-1 block truncate text-ui leading-5 text-content-secondary group-hover:text-content-primary">{item.goal}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
        {typeof balance === 'number' && (
          <div className="border-t border-line-subtle px-4 py-3 text-micro text-content-muted">{balance.toLocaleString()} credits available</div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="unified-header flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-line-subtle px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-micro font-semibold uppercase tracking-[0.2em] text-signal-run">Workspace</p>
            <h1 className="mt-1 truncate text-ui font-semibold tracking-tight text-content-primary">Think, plan, build.</h1>
          </div>
          <div className="workspace-mode-switch" role="tablist" aria-label="Workspace mode">
            <button type="button" role="tab" aria-selected={mode === 'chat'} onClick={() => { setMode('chat'); setError(''); }} className={cx('workspace-mode-option', mode === 'chat' && 'is-active')}>
              <span className="workspace-mode-index">01</span>
              <span><strong>Chat</strong><small>Explore and decide</small></span>
            </button>
            <button type="button" role="tab" aria-selected={mode === 'work'} onClick={() => { setMode('work'); setError(''); }} className={cx('workspace-mode-option', mode === 'work' && 'is-active')}>
              <span className="workspace-mode-index">02</span>
              <span><strong>Work</strong><small>Plan and execute</small></span>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="unified-main mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-12">
            <section className="unified-hero">
              <span className="unified-hero-rule" aria-hidden="true" />
              <p className="text-micro font-semibold uppercase tracking-[0.18em] text-content-faint">{mode === 'chat' ? 'Conversation mode' : 'Governed work mode'}</p>
              <h2 className="mt-4 max-w-2xl text-[2.15rem] font-semibold leading-[1.08] tracking-[-0.04em] text-content-primary sm:text-[3.2rem]">{title}</h2>
              <p className="mt-4 max-w-xl text-body leading-7 text-content-secondary">{description}</p>
            </section>

            {mode === 'work' && (
              <section className="unified-work-setup mt-8" aria-label="Work setup">
                <div className="unified-setup-heading">
                  <div>
                    <p className="text-micro font-semibold uppercase tracking-[0.16em] text-content-faint">Before you start</p>
                    <h3 className="mt-1 text-ui font-semibold text-content-primary">Set the boundary and working context</h3>
                  </div>
                  <span className={cx('unified-setup-status', workNeedsProject ? 'is-warn' : 'is-ready')}>{workNeedsProject ? 'Setup needed' : 'Ready to plan'}</span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className={cx('unified-setup-cell', workNeedsProject && 'is-warn')}>
                    <span className="unified-setup-number">01</span>
                    <div className="min-w-0"><p className="text-meta font-medium text-content-primary">Project boundary</p><p className="mt-1 truncate text-micro text-content-muted">{projectPath || (localMode ? 'Choose a folder' : 'Managed workspace')}</p></div>
                    {localMode && <Button variant="secondary" size="sm" onClick={chooseProject} loading={choosingProject}>{projectPath ? 'Change' : 'Choose'}</Button>}
                  </div>
                  <div className="unified-setup-cell">
                    <span className="unified-setup-number">02</span>
                    <Select label="Role" value={profileId} onChange={(event) => setProfileId(event.target.value)} className="h-8 text-meta">
                      <option value="">Default agent</option>
                      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                    </Select>
                  </div>
                  <div className="unified-setup-cell">
                    <span className="unified-setup-number">03</span>
                    <Select label="Workflow" value={skillId} onChange={(event) => setSkillId(event.target.value)} className="h-8 text-meta">
                      <option value="">No workflow</option>
                      {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                    </Select>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-3">
                  <p className="text-micro text-content-muted">Read-only inspection comes first. Writes and commands stay behind plan approval.</p>
                  <UploadButton taskId={null} onStaged={(file) => setStaged((previous) => [...previous, file])} label="Attach context" />
                </div>
                {staged.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{staged.map((file, index) => <span key={`${file.name}-${index}`} className="rounded-control border border-line bg-ink-900/40 px-2.5 py-1.5 text-micro text-content-secondary">{file.name}</span>)}</div>}
              </section>
            )}

            <section className="mt-9">
              <div className="mb-3 flex items-center justify-between gap-3"><p className="text-micro font-semibold uppercase tracking-[0.16em] text-content-faint">Start with a direction</p><span className="text-micro text-content-faint">{mode === 'chat' ? 'No files or commands' : 'Approval-first execution'}</span></div>
              <div className="grid gap-2 md:grid-cols-3">
                {starters.map((starter) => <button key={starter.label} type="button" onClick={() => { setDraft(starter.prompt); composerRef.current?.focus(); }} className="unified-starter text-left"><span className="block text-ui font-medium text-content-primary">{starter.label}</span><span className="mt-1.5 block text-meta leading-5 text-content-muted">{starter.prompt}</span></button>)}
              </div>
            </section>

            {error && <div className="mt-5"><Alert tone="error" title="Before you continue">{error}</Alert></div>}
          </div>
        </div>

        <footer className="unified-composer shrink-0 border-t border-line-subtle px-4 py-3 sm:px-6">
          <div className="mx-auto w-full max-w-4xl">
            <div className="unified-composer-shell">
              <textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKey} rows={1} autoFocus placeholder={mode === 'chat' ? 'Ask a question or describe what you are weighing…' : 'Describe the change or outcome you want…'} aria-label={mode === 'chat' ? 'Chat message' : 'Work brief'} className="block max-h-[180px] w-full resize-none bg-transparent px-4 py-3 text-body leading-6 text-content-primary outline-none placeholder:text-content-muted" />
              <div className="flex items-center justify-between gap-3 px-3 pb-2.5">
                <span className="flex items-center gap-1.5 text-micro text-content-muted"><KeyHint keys={mode === 'chat' ? ['Enter'] : [mod, 'Enter']} /> {mode === 'chat' ? 'send' : 'start planning'}<span className="mx-0.5 text-content-faint">·</span><KeyHint keys={['Shift', 'Enter']} /> newline</span>
                <Button size="sm" onClick={() => void send()} loading={sending} disabled={!draft.trim() || workNeedsProject}>{mode === 'chat' ? 'Send' : 'Start planning'}</Button>
              </div>
            </div>
            <p className="mt-2 text-center text-micro text-content-faint">{mode === 'chat' ? 'Chat is read-only. Switch to Work when you want Xeo to act.' : 'You stay in control: inspect, approve, then execute.'}</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
