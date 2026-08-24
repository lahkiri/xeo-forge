'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AgentProfile, AgentSkill } from '@/lib/types';
import {
  Alert,
  Button,
  Card,
  Eyebrow,
  IconButton,
  KeyHint,
  PanelHeader,
  Select,
  StatusBadge,
  cx,
  useModKey,
} from '@/components/ui';
import { UploadButton, uploadToTask } from '@/components/UploadButton';

/* ------------------------------------------------------------------ */
/*  WORK INTAKE                                                        */
/*                                                                     */
/*  Work is not "chat with write access". The intake states what the    */
/*  agent will be allowed to do BEFORE the run exists, so the user is   */
/*  never surprised by agency they did not grant.                       */
/* ------------------------------------------------------------------ */

const STARTERS = [
  { label: 'Fix a failing test', prompt: 'The auth session test is failing. Find the cause and fix it.' },
  { label: 'Add a feature', prompt: 'Add pagination to the users list endpoint, with tests.' },
  { label: 'Audit the code', prompt: 'Review error handling across the API routes and report every silent failure.' },
];

export default function WorkIntake({
  runs,
  profiles,
  skills,
  balance,
  localMode,
}: {
  runs: { id: string; goal: string; status: string; mode: string }[];
  profiles: AgentProfile[];
  skills: AgentSkill[];
  balance?: number;
  localMode: boolean;
}) {
  const router = useRouter();
  const mod = useModKey();

  const [goal, setGoal] = useState('');
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [profileId, setProfileId] = useState('');
  const [skillId, setSkillId] = useState('');
  const [staged, setStaged] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [choosingProject, setChoosingProject] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const needsProject = localMode && !projectPath;

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

  async function start() {
    const text = goal.trim();
    if (!text || submitting) return;
    setError('');
    if (needsProject) {
      setError('Choose a project folder first. Work always runs inside an explicit boundary.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: text,
          mode: 'planning',
          surface: 'work',
          projectPath,
          profileId: profileId || null,
          skillId: skillId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not start this run.');
        return;
      }
      for (const file of staged) {
        const upload = await uploadToTask(data.task.id, file);
        if (!upload.ok) console.warn(`[work] upload failed for ${file.name}: ${upload.error}`);
      }
      router.push(`/work/${data.task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void start();
    }
  };

  return (
    <div className="flex h-screen min-h-0">
      {/* ── Run history ── */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line-subtle 2xl:flex">
        <PanelHeader title="Work">
          <IconButton label="New work" size="sm" onClick={() => setGoal('')}>
            <span aria-hidden="true" className="text-ui leading-none">+</span>
          </IconButton>
        </PanelHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {runs.length === 0 && (
            <p className="px-2.5 py-6 text-meta leading-5 text-content-muted">No runs yet.</p>
          )}
          {runs.map((run) => (
            <Link
              key={run.id}
              href={`/work/${run.id}`}
              className="mb-0.5 block rounded-control px-2.5 py-2 text-content-muted transition hover:bg-ink-700 hover:text-content-secondary"
            >
              <span className="block truncate text-ui leading-5">{run.goal}</span>
              <StatusBadge status={run.status} className="mt-1" />
            </Link>
          ))}
        </div>
      </aside>

      {/* ── Intake ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-14 sm:px-6">
          {/* Hero: one confident statement, no decoration competing with it. */}
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-line-subtle bg-ink-900/60 px-3 py-1 text-micro uppercase tracking-[0.18em] text-content-muted">
              <span className="h-1 w-1 rounded-full bg-signal-plan" aria-hidden="true" />
              Governed run
            </span>
            <h1 className="mt-5 text-[2rem] font-semibold leading-[1.15] tracking-tight text-content-primary sm:text-[2.5rem]">
              Describe the outcome.
              <span className="intake-flame block">
                Approve the plan.
              </span>
            </h1>
            <p className="mx-auto mt-4 max-w-lg text-body leading-6 text-content-secondary">
              Work inspects your project read-only and produces a plan you review line by line.
              Nothing is written until you approve it — and every write lands in a diff you can see.
            </p>
          </div>

          {/* Composer: THE product surface. Elevated card, gradient rail on
              focus, generous textarea. */}
          <div className="composer-card mt-9 rounded-modal border border-line bg-ink-900/70 p-1.5 shadow-panel">
            <div className="rounded-[0.7rem] transition focus-within:border-signal-plan/30" >
              <textarea
                ref={composerRef}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={onKey}
                rows={4}
                autoFocus
                placeholder="Add rate limiting to the login route and cover it with tests…"
                aria-label="What should the agent do?"
                className="block w-full resize-none rounded-[0.7rem] bg-ink-800/60 px-4 py-3.5 text-body leading-6 text-content-primary outline-none placeholder:text-content-muted"
              />
              <div className="flex flex-wrap items-center justify-between gap-3 px-2.5 pb-2.5">
                <UploadButton taskId={null} onStaged={(file) => setStaged((p) => [...p, file])} label="Attach files" />
                <span className="flex items-center gap-2">
                  <KeyHint keys={[mod, 'Enter']} />
                  <Button onClick={start} loading={submitting} disabled={!goal.trim()}>
                    Start planning →
                  </Button>
                </span>
              </div>
            </div>
          </div>

          {/* Capability contract — stated under the composer, where the eye
              lands right after typing. One line, scannable. */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5" aria-label="Agent capabilities">
            {[
              'Files', 'Git', 'Terminal', 'Diff review', 'MCP tools', 'Preview', 'Browser',
            ].map((cap) => (
              <span
                key={cap}
                className="rounded-full border border-line-subtle bg-ink-900/50 px-2.5 py-1 text-micro text-content-muted"
              >
                {cap}
              </span>
            ))}
            <span className="rounded-full border border-signal-pass/25 bg-signal-pass/[0.06] px-2.5 py-1 text-micro font-medium text-signal-pass">
              Every write behind your approval
            </span>
          </div>

          {staged.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {staged.map((file, index) => (
                <span
                  key={`${file.name}-${index}`}
                  className="inline-flex items-center gap-2 rounded-control border border-line bg-black/20 px-2.5 py-1.5 text-meta text-content-secondary"
                >
                  <span className="max-w-[13rem] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setStaged((p) => p.filter((_, i) => i !== index))}
                    aria-label={`Remove ${file.name}`}
                    className="text-content-muted hover:text-content-primary"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {error && <div className="mt-4"><Alert tone="error" title="Before you continue">{error}</Alert></div>}

          {/* ── What this run is allowed to do ── */}
          <Card className="mt-9" tone={needsProject ? 'amber' : 'default'}>
            <p className="text-micro font-semibold uppercase tracking-[0.18em] text-content-faint">
              Authority for this run
            </p>
            <ul className="mt-3 space-y-2 text-ui leading-5">
              <li className="flex items-start gap-2.5">
                <span aria-hidden="true" className="mt-0.5 text-signal-pass/80">✓</span>
                <span className="text-content-secondary">Read and analyze files inside the project boundary</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span aria-hidden="true" className="mt-0.5 text-content-muted">○</span>
                <span className="text-content-muted">
                  Write files and run commands — <span className="text-content-secondary">only after you approve the plan</span>
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span aria-hidden="true" className="mt-0.5 text-content-muted">○</span>
                <span className="text-content-muted">Browser actions — separately gated by your safety policy</span>
              </li>
            </ul>

            <div className="mt-4 border-t border-line-subtle pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-micro font-semibold uppercase tracking-[0.18em] text-content-faint">Boundary</p>
                  <p className={cx('mt-1 break-all font-mono text-meta', projectPath ? 'text-content-secondary' : 'text-signal-gate/90')}>
                    {projectPath || (localMode ? 'No folder chosen yet' : 'Managed by the hosted workspace')}
                  </p>
                </div>
                {localMode && (
                  <Button variant="secondary" size="sm" onClick={chooseProject} loading={choosingProject}>
                    {projectPath ? 'Change folder' : 'Choose folder'}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* ── Context layers ── */}
          {(profiles.length > 0 || skills.length > 0) && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {profiles.length > 0 && (
                <Select
                  label="Role"
                  hint="Reusable agent instructions"
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                >
                  <option value="">Default agent</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                  ))}
                </Select>
              )}
              {skills.length > 0 && (
                <Select
                  label="Workflow"
                  hint="Reusable procedure"
                  value={skillId}
                  onChange={(e) => setSkillId(e.target.value)}
                >
                  <option value="">No workflow</option>
                  {skills.map((skill) => (
                    <option key={skill.id} value={skill.id}>{skill.name}</option>
                  ))}
                </Select>
              )}
            </div>
          )}

          {runs.length === 0 && (
            <div className="mt-10">
              <p className="mb-3 text-center text-micro font-semibold uppercase tracking-[0.16em] text-content-faint">
                Try one
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {STARTERS.map((starter) => (
                  <button
                    key={starter.label}
                    type="button"
                    onClick={() => { setGoal(starter.prompt); composerRef.current?.focus(); }}
                    className="starter-card group rounded-control border border-line-subtle bg-ink-900/50 p-3.5 text-left transition hover:border-signal-plan/30 hover:bg-signal-plan/[0.04]"
                  >
                    <span className="block text-ui font-medium text-content-secondary group-hover:text-content-primary">{starter.label}</span>
                    <span className="mt-1 block text-meta leading-5 text-content-muted">{starter.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {typeof balance === 'number' && (
            <p className="mt-6 text-center text-meta text-content-muted">
              {balance} credits available
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
