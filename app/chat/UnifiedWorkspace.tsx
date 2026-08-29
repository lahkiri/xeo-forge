'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AgentProfile, AgentSkill, ProviderCatalog } from '@/lib/types';
import { AUTONOMY_LEVELS, describeAutonomy, type AutonomyLevel } from '@/lib/agent/permissions';
import { ThinkingEffortSelect } from '@/components/ThinkingEffortSelect';
import type { ThinkingEffort } from '@/lib/model/thinking';
import { SANDBOX_MODES as SANDBOX_SPECS, type SandboxMode } from '@/lib/agent/sandbox';
import { Alert, Button, KeyHint, Select, StatusBadge, cx, useModKey } from '@/components/ui';
import { displaySessionLabel, relativeDayLabel } from '@/lib/agent/session-title';
import { UploadButton, uploadToTask } from '@/components/UploadButton';
import { ThemeToggle } from '@/components/Theme';
import {
  IconPlay,
  IconArrowUpRight,
  IconZap,
  IconDiamond,
  IconChevronDown,
  IconCheck,
  IconTerminal,
  IconPlus,
  IconSearch,
  IconPanelLeftClose,
  IconPanelLeftOpen,
  IconMessageCircle,
  IconFolder,
  IconSettings,
  IconUserRound,
  IconPlug,
  IconCommand,
  IconX,
} from '@/components/icons';

type WorkspaceMode = 'chat' | 'work';
type Thread = { id: string; goal: string; title?: string | null; status: string; updated_at: string };
type Run = { id: string; goal: string; status: string; mode: string };

const CHAT_STARTERS = [
  { label: 'Think through a decision', prompt: 'Help me compare the tradeoffs and recommend a practical path.', glyph: 'arrow' },
  { label: 'Explain a technical issue', prompt: 'Explain this error clearly, then suggest the safest next step.', glyph: 'zap' },
  { label: 'Shape an idea', prompt: 'Help me turn this rough idea into a focused, executable brief.', glyph: 'diamond' },
];

const WORK_STARTERS = [
  { label: 'Fix a failing test', prompt: 'The auth session test is failing. Find the cause and fix it.', glyph: 'terminal' },
  { label: 'Add a feature', prompt: 'Add pagination to the users list endpoint, with tests.', glyph: 'plus' },
  { label: 'Audit the code', prompt: 'Review error handling across the API routes and report every silent failure.', glyph: 'check' },
];

export default function UnifiedWorkspace({
  threads,
  runs,
  profiles,
  skills,
  providerCatalog,
  balance,
  localMode,
}: {
  threads: Thread[];
  runs: Run[];
  profiles: AgentProfile[];
  skills: AgentSkill[];
  providerCatalog: ProviderCatalog;
  balance?: number;
  localMode: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeMode: WorkspaceMode = searchParams.get('mode') === 'work' ? 'work' : 'chat';
  const mod = useModKey();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<WorkspaceMode>(routeMode);
  const [draft, setDraft] = useState('');
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [profileId, setProfileId] = useState('');
  const [skillId, setSkillId] = useState('');
  const [staged, setStaged] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [choosingProject, setChoosingProject] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [providerId, setProviderId] = useState(providerCatalog.active_provider_id ?? '');
  const [providerModelId, setProviderModelId] = useState(providerCatalog.active_model_id ?? '');
  // v1.21: authority chosen at Work setup. chat never carries it (chat is read-only).
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>('execute');
  // v1.23: thinking effort is available on BOTH surfaces from the shell —
  // chat tasks get it in the create body; work tasks set it in the context grid.
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('high');
  // v1.23 sandbox tier (Work only — chat has no execution tools to isolate).
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>('standard');
  const [dockerStatus, setDockerStatus] = useState<{ available: boolean; detail: string; version?: string } | null>(null);
  const autonomyCopy = describeAutonomy(autonomyLevel);
  useEffect(() => {
    if (mode !== 'work' || dockerStatus) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/sandbox', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && body?.docker) setDockerStatus(body.docker);
      } catch { /* offline: tier stays selectable, docker checked again at run time */ }
    })();
    return () => { cancelled = true; };
  }, [mode, dockerStatus]);

  const selectedProvider = providerCatalog.providers.find((provider) => provider.id === providerId && provider.enabled);
  const selectedModel = selectedProvider?.models.find((model) => model.id === providerModelId && model.enabled);
  const selectedModelLabel = selectedProvider && selectedModel
    ? `${selectedProvider.name} / ${selectedModel.name}`
    : 'Choose a model';

  const workNeedsProject = mode === 'work' && localMode && !projectPath;
  const starters = mode === 'chat' ? CHAT_STARTERS : WORK_STARTERS;

  // Recorded golden-run demo (Desktop Local): seeds a real task and opens
  // the paced replay through the same components live events use.
  const [demoLoading, setDemoLoading] = useState(false);
  async function startDemo() {
    if (demoLoading) return;
    setDemoLoading(true);
    setError('');
    try {
      const res = await fetch('/api/demo', { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body.task?.id) {
        setError(body.error || 'Could not start the demo.');
        setDemoLoading(false);
        return;
      }
      router.push(`/work/${body.task.id}?demo=1`);
    } catch {
      setError('Network error while starting the demo.');
      setDemoLoading(false);
    }
  }

  // Heartbeat-driven health map: localStorage cache + server sweep on open/interval.
  const [healthMap, setHealthMap] = useState<Record<string, 'ok' | 'warn' | 'bad'>>({});
  const [sweeping, setSweeping] = useState(false);

  const runHeartbeat = useCallback(async () => {
    if (sweeping) return;
    setSweeping(true);
    try {
      const res = await fetch('/api/providers/heartbeat', { method: 'POST' });
      if (!res.ok) return;
      const body = await res.json();
      const next: Record<string, 'ok' | 'warn' | 'bad'> = { ...healthMap };
      for (const r of body.results ?? []) {
        next[r.providerId + ':' + r.modelId] =
          r.verdict === 'healthy' ? 'ok'
          : r.verdict === 'stream_tools_unsupported' ? 'bad'
          : 'warn';
      }
      setHealthMap(next);
      try { window.localStorage.setItem('xeo.modelHealth', JSON.stringify(next)); } catch { /* storage unavailable */ }
    } catch {
      // offline / transient — dots keep last known state
    } finally {
      setSweeping(false);
    }
  }, [sweeping, healthMap]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('xeo.modelHealth');
      if (raw) setHealthMap(JSON.parse(raw));
    } catch { /* corrupt cache — ignore */ }
  }, []);
  useEffect(() => {
    if (!modelPickerOpen || !localMode) return;
    void runHeartbeat();
    const id = setInterval(() => void runHeartbeat(), 5 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelPickerOpen, localMode]);

  function modelHealth(pid: string, mid: string): 'ok' | 'warn' | 'bad' {
    return healthMap[pid + ':' + mid] ?? 'warn';
  }
  useEffect(() => { setMode(routeMode); }, [routeMode]);

  // Model picker: local filter + persisted selection (survives restarts).
  const [modelQuery, setModelQuery] = useState('');

  // Layout control: collapse/expand + width of the workspace sidebar.
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  useEffect(() => {
    try {
      setSidebarHidden(window.localStorage.getItem('xeo.sidebarHidden') === '1');
      const w = Number(window.localStorage.getItem('xeo.sidebarWidth'));
      if (w >= 180 && w <= 420) setSidebarWidth(w);
    } catch { /* corrupt cache — ignore */ }
  }, []);
  function persistSidebar(hidden: boolean, width: number) {
    setSidebarHidden(hidden);
    setSidebarWidth(width);
    try {
      window.localStorage.setItem('xeo.sidebarHidden', hidden ? '1' : '0');
      window.localStorage.setItem('xeo.sidebarWidth', String(width));
    } catch { /* storage unavailable */ }
  }
  async function chooseModel(providerId: string, modelId: string) {
    setProviderId(providerId);
    setProviderModelId(modelId);
    setModelPickerOpen(false);
    setModelQuery('');
    try {
      await fetch('/api/providers/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, providerModelId: modelId }),
      });
    } catch {
      // Selection persistence is best-effort; the in-session choice stands.
    }
  }

  function changeMode(nextMode: WorkspaceMode) {
    setMode(nextMode);
    router.replace(`${pathname}?mode=${nextMode}`, { scroll: false });
  }

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
          ...(isWork ? { projectPath, profileId: profileId || null, skillId: skillId || null, autonomyLevel, thinkingEffort, sandboxMode } : { thinkingEffort }),
          ...(providerId && providerModelId ? { providerId, providerModelId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Could not start this ${mode} session.`);
        return;
      }
      for (const file of staged) {
        const upload = await uploadToTask(data.task.id, file);
        if (!upload.ok) console.warn(`[workspace] upload failed for ${file.name}: ${upload.error}`);
      }
      router.push(isWork ? `/work/${data.task.id}` : `/chat/${data.task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSending(false);
    }
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (mode === 'chat' ? !event.shiftKey : (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      void send();
    }
  }

  const recentItems = [
    ...threads.map((thread) => ({ ...thread, kind: 'chat' as const })),
    ...runs.map((run) => ({ ...run, kind: 'work' as const, title: null as string | null, updated_at: '' })),
  ];

  return (
    <div className="codex-workspace flex h-full min-h-0">
      {!sidebarHidden && (
      <aside style={{ width: sidebarWidth }} className="codex-sidebar shrink-0 flex-col md:flex" aria-label="Workspace navigation">
        <div className="codex-sidebar-top">
          <button type="button" aria-label="Hide sidebar" title="Hide sidebar"
            className="codex-action-icon"
            onClick={() => persistSidebar(true, sidebarWidth)}><IconPanelLeftClose size={14} /></button>
          <Link href="/chat" className="codex-brand" aria-label="Xeo Forge home">
            <span className="brand-mark h-7 w-7" aria-hidden="true"><span /></span>
            <span className="min-w-0"><strong>Xeo Forge</strong><small>Agent workspace</small></span>
          </Link>
          {/* v1.23 (audit #6): this button used to be a dead placeholder.
              It now opens the REAL project chooser in desktop local mode and
              shows the chosen path; on the web it is an honest indicator of
              the managed workspace, not a fake switcher. */}
          {localMode ? (
            <button type="button" className="codex-workspace-switcher" aria-label="Switch workspace" title={projectPath ?? 'Choose a project folder'} onClick={() => void chooseProject()} disabled={choosingProject}>
              <span><small>Workspace</small><strong className="codex-workspace-name">{projectPath ? projectPath.split(/[\\/]/).pop() : 'Choose a folder'}</strong></span><span aria-hidden="true"><IconChevronDown size={12} /></span>
            </button>
          ) : (
            <div className="codex-workspace-switcher is-static" aria-label="Managed workspace">
              <span><small>Workspace</small><strong className="codex-workspace-name">Managed</strong></span>
            </div>
          )}
        </div>

        <div className="codex-sidebar-actions">
          <Link href="/chat?mode=chat" className="codex-new-chat"><span className="codex-action-icon"><IconPlus size={14} /></span><span>New chat</span><KeyHint keys={[mod, 'N']} /></Link>
          <button type="button" className="codex-search-button" onClick={() => window.dispatchEvent(new CustomEvent('xeo:open-command-palette'))}><span aria-hidden="true"><IconSearch size={14} /></span><span>Search sessions</span><KeyHint keys={[mod, 'K']} /></button>
        </div>

        <div className="codex-sidebar-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="codex-nav-heading"><span>Sessions</span><span>{recentItems.length || '—'}</span></div>
          <div className="codex-session-list">
            {recentItems.length === 0 ? (
              <p className="codex-empty-sidebar">Your sessions will appear here.</p>
            ) : recentItems.map((item) => (
              <Link key={`${item.kind}-${item.id}`} href={item.kind === 'work' ? `/work/${item.id}` : `/chat/${item.id}`} className="codex-session-row">
                <span className={cx('codex-session-glyph', item.kind === 'work' && 'is-work')}>{item.kind === 'work' ? <IconFolder size={13} /> : <IconMessageCircle size={13} />}</span>
                {/* v1.25: stored title first (greeting openers fall back to the
                    first exchange server-side), bidi-safe truncation for legacy
                    rows, and a small today/yesterday/date discriminator. */}
                <span className="min-w-0 flex-1"><strong>{displaySessionLabel(item.title, item.goal)}</strong><small>{[relativeDayLabel(item.updated_at), item.kind === 'work' ? 'Work session' : 'Chat session'].filter(Boolean).join(' · ')}</small></span>
                {item.kind === 'work' && <StatusBadge status={item.status} />}
              </Link>
            ))}
          </div>

          <div className="codex-nav-heading codex-capabilities-heading"><span>Capabilities</span><span aria-hidden="true"><IconCommand size={12} /></span></div>
          <nav className="codex-capability-list" aria-label="Capabilities">
            <Link href="/settings" className="codex-capability-row"><span><IconSettings size={13} /></span><span>Settings</span></Link>
            <Link href="/settings/profiles" className="codex-capability-row"><span><IconUserRound size={13} /></span><span>Profiles</span></Link>
            <Link href="/settings/skills" className="codex-capability-row"><span><IconDiamond size={13} /></span><span>Skills</span></Link>
            <Link href="/settings/mcp" className="codex-capability-row"><span><IconPlug size={13} /></span><span>MCP tools</span></Link>
          </nav>
        </div>

        <div className="codex-sidebar-footer">
          <div className="codex-runtime-row"><span><i className="codex-status-dot" />{localMode ? 'Local runtime' : 'Web workspace'}</span><ThemeToggle /></div>
          {/* v1.23 (audit #6): the account-menu glyph was decorative — a span
              that looked like a menu but did nothing. Removed rather than
              left dangling; the identity line stays as honest status. */}
          <div className="codex-account-row"><span className="codex-avatar">{localMode ? 'L' : 'X'}</span><span className="min-w-0 flex-1"><strong>{localMode ? 'Local operator' : 'Xeo account'}</strong><small>{typeof balance === 'number' ? `${balance.toLocaleString()} credits` : 'Offline-first'}</small></span></div>
        </div>
      </aside>
      )}
      {!sidebarHidden && (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = sidebarWidth;
          const onMove = (ev: MouseEvent) => {
            const w = Math.min(420, Math.max(180, startW + (ev.clientX - startX)));
            const aside = document.querySelector<HTMLElement>('.codex-sidebar');
            if (aside) aside.style.width = w + 'px';
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const aside = document.querySelector<HTMLElement>('.codex-sidebar');
            const w = aside ? parseInt(aside.style.width, 10) || startW : startW;
            persistSidebar(false, w);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
        className="w-1 cursor-col-resize bg-transparent hover:bg-[rgb(var(--content-primary)/0.35)] transition-colors"
      />
      )}


      <section className="codex-main min-w-0 flex-1">
        <header className="codex-topbar">
          <div className="codex-breadcrumb"><span className="codex-breadcrumb-muted">Xeo Forge</span><span>/</span><strong>{mode === 'chat' ? 'Chat' : 'Work'}</strong><span className={cx('codex-live-pill', mode === 'work' && workNeedsProject && 'is-warn')}><i className="codex-status-dot" />{mode === 'work' && workNeedsProject ? 'Setup needed' : 'Ready'}</span></div>
          <div className="codex-topbar-actions"><button type="button" className="codex-quiet-action" aria-label="Open command menu" title="Command menu" onClick={() => window.dispatchEvent(new CustomEvent('xeo:open-command-palette'))}><IconCommand size={14} /></button><button type="button" className="codex-quiet-action" aria-label="Open settings" title="Settings" onClick={() => router.push('/settings')}><IconSettings size={14} /></button></div>
        </header>

        <div className="codex-sessionbar">
          <div className="codex-session-title"><span className="codex-session-status" /> <span>{mode === 'chat' ? 'New conversation' : 'New work session'}</span><span className="codex-session-meta">Unsaved</span></div>
          <div className="codex-mode-tabs" role="tablist" aria-label="Workspace mode">
            <button type="button" role="tab" aria-selected={mode === 'chat'} onClick={() => { changeMode('chat'); setError(''); }} className={cx('codex-mode-tab', mode === 'chat' && 'is-active')}><span>Chat</span><small>Explore</small></button>
            <button type="button" role="tab" aria-selected={mode === 'work'} onClick={() => { changeMode('work'); setError(''); }} className={cx('codex-mode-tab', mode === 'work' && 'is-active')}><span>Work</span><small>Execute</small></button>
          </div>
        </div>

        {sidebarHidden && (
        <button type="button" aria-label="Show sidebar" title="Show sidebar"
          onClick={() => persistSidebar(false, sidebarWidth)}
          className="self-start m-1.5 inline-flex items-center gap-1.5 rounded-control border border-[rgb(var(--line)/0.35)] px-2 py-1 text-meta text-content-muted hover:text-content-primary hover:border-[rgb(var(--content-primary)/0.6)]">
          <IconPanelLeftOpen size={13} /> Show sidebar
        </button>
      )}
<div className="codex-body min-h-0 flex-1 overflow-y-auto">
          <div className={cx('codex-transcript', mode === 'work' && 'is-work')}>
            <div className="codex-welcome">
              <span className="codex-welcome-mark" aria-hidden="true"><span /></span>
              <p className="codex-kicker">{mode === 'chat' ? 'Conversation' : 'Execution workspace'}</p>
              <h1>{mode === 'chat' ? 'What are you working on?' : 'What should we build?'}</h1>
              <p className="codex-welcome-copy">{mode === 'chat' ? 'Think with Xeo, explore a problem, or turn an idea into a clear next step.' : 'Give Xeo an outcome. It will inspect first, prepare a plan, and wait for your approval before acting.'}</p>
            </div>

            {mode === 'work' && (
              <section className="codex-work-context" aria-label="Work context">
                <div className="codex-context-header"><div><span className="codex-kicker">Working context</span><h2>Set the boundary before execution</h2></div><span className={cx('codex-context-badge', workNeedsProject ? 'is-warn' : 'is-ready')}>{workNeedsProject ? 'Setup needed' : 'Ready to plan'}</span></div>
                <div className="codex-context-grid">
                  <div className={cx('codex-context-field', workNeedsProject && 'is-warn')}><span className="codex-field-index">01</span><span className="min-w-0 flex-1"><small>Project</small><strong>{projectPath || (localMode ? 'Choose a folder' : 'Managed workspace')}</strong></span>{localMode && <Button variant="secondary" size="sm" onClick={chooseProject} loading={choosingProject}>{projectPath ? 'Change' : 'Choose'}</Button>}</div>
                  <div className="codex-context-field"><span className="codex-field-index">02</span><Select label="Role" value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">Default agent</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</Select></div>
                  <div className="codex-context-field"><span className="codex-field-index">03</span><Select label="Workflow" value={skillId} onChange={(event) => setSkillId(event.target.value)}><option value="">No workflow</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</Select></div>
                  <div className="codex-context-field" title={autonomyCopy.detail}><span className="codex-field-index">04</span><span className="min-w-0 flex-1"><Select label="Authority" value={autonomyLevel} onChange={(event) => setAutonomyLevel(event.target.value as AutonomyLevel)}>{AUTONOMY_LEVELS.map((level) => { const copy = describeAutonomy(level); return <option key={level} value={level}>{copy.title}</option>; })}</Select></span></div>
                  <div className="codex-context-field"><span className="codex-field-index">05</span><span className="min-w-0 flex-1"><ThinkingEffortSelect value={thinkingEffort} onChange={setThinkingEffort} label="Thinking" /></span></div>
                  <div className="codex-context-field" title={SANDBOX_SPECS.find((s) => s.id === sandboxMode)?.describe}><span className="codex-field-index">06</span><span className="min-w-0 flex-1"><Select label="Sandbox" value={sandboxMode} onChange={(event) => setSandboxMode(event.target.value as SandboxMode)}>{SANDBOX_SPECS.map((spec) => <option key={spec.id} value={spec.id}>{spec.label}</option>)}</Select></span>{sandboxMode === 'docker' && <span className={cx('codex-model-dot', dockerStatus ? (dockerStatus.available ? 'is-ok' : 'is-warn') : 'is-warn')} title={dockerStatus?.detail ?? 'Checking Docker…'} aria-hidden="true" />}</div>
                </div>
                <div className="codex-context-footer"><span>{autonomyCopy.detail} It will still never write or run before you approve the plan{autonomyLevel === 'execute' ? ' — and git push or publishing stops for you.' : '.'}</span><UploadButton taskId={null} onStaged={(file) => setStaged((previous) => [...previous, file])} label="Attach context" /></div>
                {staged.length > 0 && <div className="codex-context-files">{staged.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setStaged((previous) => previous.filter((_, fileIndex) => fileIndex !== index))}><IconX size={11} /></button></span>)}</div>}
              </section>
            )}

            <section className="codex-starters"><div className="codex-section-heading"><span>{mode === 'chat' ? 'Start with a prompt' : 'Common starting points'}</span><span className="inline-flex items-center gap-1">{mode === 'chat' ? <><KeyHint keys={[mod, 'Enter']} /> to send</> : 'Approval required'}</span></div><div className="codex-starter-list">{starters.map((starter) => <button key={starter.label} type="button" className="codex-starter-row" onClick={() => { setDraft(starter.prompt); composerRef.current?.focus(); }}><span className="codex-starter-glyph">{starter.glyph === 'arrow' ? <IconArrowUpRight size={13} /> : starter.glyph === 'zap' ? <IconZap size={13} /> : starter.glyph === 'diamond' ? <IconDiamond size={13} /> : starter.glyph === 'plus' ? <IconPlus size={13} /> : starter.glyph === 'check' ? <IconCheck size={13} /> : <IconTerminal size={13} />}</span><span className="min-w-0 flex-1"><strong>{starter.label}</strong><small>{starter.prompt}</small></span><span className="codex-starter-arrow"><IconArrowUpRight size={13} /></span></button>)}</div></section>
            {localMode && (
              <button
                type="button"
                onClick={startDemo}
                disabled={demoLoading}
                className="codex-starter-row"
              >
                <span className="codex-starter-glyph"><IconPlay size={13} /></span>
                <span className="min-w-0 flex-1">
                  <strong>Watch a governed run — no setup</strong>
                  <small>A recorded real task replays the full loop: inspect, plan, approve, build, verify.</small>
                </span>
                <span className="codex-starter-arrow"><IconPlay size={13} /></span>
              </button>
            )}
            {error && <div className="codex-inline-error"><Alert tone="error" title="Before you continue">{error}</Alert></div>}
          </div>
        </div>

        <footer className="codex-composer-dock">
          {mode === 'chat' && staged.length > 0 && <div className="codex-attachment-row"><span>Context</span>{staged.map((file, index) => <button key={`${file.name}-${index}`} type="button" aria-label={`Remove ${file.name}`} onClick={() => setStaged((previous) => previous.filter((_, fileIndex) => fileIndex !== index))}>{file.name} <IconX size={11} /></button>)}</div>}
          <div className="codex-composer-wrap"><div className="codex-composer-topline"><div className="codex-model-picker"><button type="button" className="codex-model-button" aria-haspopup="listbox" aria-expanded={modelPickerOpen} onClick={() => setModelPickerOpen((open) => !open)}><span className="codex-model-button-dot" /><span className="codex-model-button-label">{selectedModelLabel}</span><span aria-hidden="true"><IconChevronDown size={12} /></span></button>{modelPickerOpen && <div className="codex-model-popover" role="listbox" aria-label="Choose provider and model">{sweeping && <span className="codex-model-sweep"><span className={cx('codex-model-dot', 'is-warn')} />checking models…</span>}<input type="search" value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} placeholder="Search models…" aria-label="Search models" className="codex-model-search" />{providerCatalog.providers.filter((provider) => provider.enabled).map((provider) => { const q = modelQuery.trim().toLowerCase(); const availableModels = provider.models.filter((model) => model.enabled && (!q || model.name.toLowerCase().includes(q) || model.model_id.toLowerCase().includes(q))); if (availableModels.length === 0) return null; return <div key={provider.id} className="codex-provider-group"><div className="codex-provider-heading"><span>{provider.name}</span><small>{availableModels.length} model{availableModels.length === 1 ? '' : 's'}</small></div>{availableModels.map((model) => <button key={model.id} type="button" role="option" aria-selected={model.id === providerModelId} className={cx('codex-model-option', model.id === providerModelId && 'is-selected')} onClick={() => void chooseModel(provider.id, model.id)}><span className={cx('codex-model-dot', 'is-' + modelHealth(provider.id, model.id))} aria-hidden="true" /><span className="codex-model-option-copy"><strong>{model.name}</strong><small>{model.model_id}</small></span><span className="codex-model-check">{model.id === providerModelId ? <IconCheck size={12} /> : ''}</span></button>)}</div>; })}{providerCatalog.providers.filter((provider) => provider.enabled && provider.models.some((model) => model.enabled)).length === 0 && <div className="codex-model-empty">Add an enabled provider and model in Settings.</div>}</div>}</div><span className="codex-composer-state">{mode === 'chat' ? 'Read-only conversation' : projectPath ? 'Project bound' : 'Managed workspace'} </span></div><textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKey} rows={2} autoFocus placeholder={mode === 'chat' ? 'Message Xeo…' : 'Describe the outcome you want…'} aria-label={mode === 'chat' ? 'Chat message' : 'Work brief'} /><div className="codex-composer-toolbar"><div className="codex-composer-tools"><UploadButton taskId={null} onStaged={(file) => setStaged((previous) => [...previous, file])} label="Add context" />{mode === 'chat' && <ThinkingEffortSelect value={thinkingEffort} onChange={setThinkingEffort} compact />}<span className="codex-key-hint"><KeyHint keys={mode === 'chat' ? ['Enter'] : [mod, 'Enter']} /> {mode === 'chat' ? 'send' : 'plan'} <span>·</span> <KeyHint keys={['Shift', 'Enter']} /> newline</span></div><Button size="sm" onClick={() => void send()} loading={sending} disabled={!draft.trim() || workNeedsProject}>{mode === 'chat' ? 'Send' : 'Start planning'}</Button></div></div>
          <p className="codex-composer-note">{mode === 'chat' ? 'Switch to Work when you want Xeo to inspect files or make changes.' : 'Xeo will never write or run commands before you approve the plan.'}</p>
        </footer>
      </section>
    </div>
  );
}
