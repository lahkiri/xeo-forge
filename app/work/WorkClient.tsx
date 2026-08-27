'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Message, Task, TaskEvent, Upload } from '@/lib/types';
import {
  buildTimeline,
  isRunningStatus,
  isTerminalStatus,
  latestEventOfType,
  parseEvents,
  splitRuns,
  type ParsedEvent,
} from '@/lib/agent/timeline';
import { renderMarkdown } from '@/lib/markdown';
import { deriveChatRuntime, formatElapsed } from '@/lib/agent/runtime-state';
import { eventTypesFor } from '@/lib/agent/events';
import { ExecutionTimeline, buildActivityRows } from '@/components/ExecutionTimeline';
import { FileActivity } from '@/components/FileActivity';
import {
  AuthorityRow,
  RuntimeBanner,
  XeoFlow,
  authorityForMode,
  deriveFlow,
  type FlowStage,
} from '@/components/AgentPrimitives';
import {
  Alert,
  Badge,
  Button,
  Divider,
  EmptyState,
  IconButton,
  KeyHint,
  Meter,
  Panel,
  PanelHeader,
  StatusBadge,
  Tabs,
  cx,
  useModKey,
  useToast,
} from '@/components/ui';
import { DecisionGate, PlanReview, ToolRow, pairToolEvents } from '@/components/WorkPrimitives';
import { useHotkeys } from '@/components/CommandPalette';
import { ContextInspector } from '@/components/ContextInspector';
import { MemoryReview } from '@/components/MemoryReview';
import { WorkspaceViewer } from '@/components/WorkspaceViewer';
import { PreviewPanel } from '@/components/PreviewPanel';
import TaskContextPanel from '@/app/tasks/[id]/TaskContextPanel';
import { UploadButton } from '@/components/UploadButton';
import { DiffView } from '@/components/DiffView';
import Terminal from '@/components/Terminal';
import { ThinkingBlock, reasoningTextOf } from '@/components/ThinkingBlock';

/* ------------------------------------------------------------------ */
/*  WORK SURFACE                                                       */
/*                                                                     */
/*  Work is governed agency, so the layout leads with governance:       */
/*  what the agent intends, what it is allowed to do, what it did, and  */
/*  what it costs. Three panes — run log, artifact, governance rail.    */
/* ------------------------------------------------------------------ */

type CenterTab = 'run' | 'activity' | 'project' | 'preview' | 'context' | 'memory' | 'terminal' | 'diff';

/**
 * Product language for the deterministic intent kinds. The DB stores the
 * machine token (conversation / explicit_plan / ...); the UI shows the words
 * a person would use. Same pattern as STATUS_LABEL in ui.tsx — one mapping,
 * every surface.
 */
const INTENT_LABEL: Record<string, string> = {
  conversation: 'ordinary conversation',
  explicit_plan: 'planning requested',
  direct_execution: 'direct execution',
  clarification_needed: 'needs your choice',
};

export default function WorkClient({
  runs,
  task,
  initialEvents,
  initialMessages,
  initialUploads,
  demoMode = false,
  demoSource = [],
}: {
  runs: { id: string; goal: string; status: string; mode: string }[];
  task: Task;
  initialEvents: TaskEvent[];
  initialMessages: Message[];
  initialUploads: Upload[];
  /** Recorded-demo pacing: reveal events over time instead of all at once. */
  demoMode?: boolean;
  demoSource?: TaskEvent[];
}) {
  const router = useRouter();
  const toast = useToast();
  const mod = useModKey();

  // Demo replay starts visually empty; the pacer below reveals the recorded
  // script through the same addEvent path live events use.
  const [events, setEvents] = useState<ParsedEvent[]>(() => parseEvents(demoMode ? [] : initialEvents));
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [uploads, setUploads] = useState<Upload[]>(initialUploads);
  const [status, setStatus] = useState(task.status);
  const [proposedPlan, setProposedPlan] = useState(task.plan ?? '');
  const [tab, setTab] = useState<CenterTab>('run');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [creditsSpent, setCreditsSpent] = useState(task.credits_spent);
  const [contextPct, setContextPct] = useState<number | null>(null);
  const [contextTokens, setContextTokens] = useState(0);
  const [contextWindow, setContextWindow] = useState(0);
  const [todos, setTodos] = useState<{ id: string; description: string; status: string }[]>([]);
  // Count of memory candidates awaiting a decision. Drives the Memory tab badge
  // so a proposal is never silently dropped.
  const [pendingMemory, setPendingMemory] = useState(0);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [diffBlocked, setDiffBlocked] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [fileChanges, setFileChanges] = useState<{ action: string; path: string }[]>([]);
  const [gitStatus, setGitStatus] = useState<{
    branch: string | null;
    detached: boolean;
    dirtyCount: number;
    staged: number;
    unstaged: number;
    untracked: number;
    lastCommit: { hash: string; subject: string } | null;
  } | null>(null);
  const [gitStatusLoaded, setGitStatusLoaded] = useState(false);
  const [decisionSeconds, setDecisionSeconds] = useState(() =>
    task.decision_expires_at
      ? Math.max(0, Math.ceil((Date.parse(task.decision_expires_at) - Date.now()) / 1000))
      : 0,
  );

  const seenSeq = useRef<Set<number>>(new Set(initialEvents.map((e) => e.seq)));
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  /**
   * True between a git_op(diff) tool_call and its tool_result, so the Diff tab
   * can capture the unified diff the agent asked for. Tool calls in one run are
   * sequential, so a boolean (not a queue) is exact.
   */
  const pendingGitDiffRef = useRef(false);

  const isTerminal = isTerminalStatus(status);
  const isRunning = isRunningStatus(status);
  const isPlanned = status === 'planned';
  const awaitingDecision =
    status === 'awaiting_decision' && task.decision_state === 'pending' && decisionSeconds > 0;
  const decisionExpired = status === 'awaiting_decision' && decisionSeconds <= 0;

  const { currentRunEvents, currentRunText } = useMemo(() => splitRuns(events), [events]);
  const liveThinking = useMemo(() => reasoningTextOf(currentRunEvents), [currentRunEvents]);
  const timeline = useMemo(
    () => buildTimeline({ events, messages, status, goal: task.goal }),
    [events, messages, status, task.goal],
  );

  // Xeo Flow: derived only from observable state, never a step counter.
  const flowStages = useMemo(
    () =>
      deriveFlow({
        status,
        mode: task.mode,
        hasContextEvent: events.some((e) => e.type === 'context' || e.type === 'context_layers'),
        hasPlan: Boolean(proposedPlan),
        hasApprovedPlan: Boolean(task.approved_plan),
        hasToolActivity: events.some((e) => e.type === 'tool_call'),
      }),
    [status, task.mode, task.approved_plan, events, proposedPlan],
  );

  const openFlowStage = useCallback((stage: FlowStage) => {
    if (stage === 'context') setTab('context');
    else if (stage === 'execute') setTab('activity');
    else setTab('run');
  }, []);
  const toolPairs = useMemo(() => pairToolEvents(events), [events]);
  // Rows the Activity timeline will actually render, so the tab badge matches.
  const activityCount = useMemo(() => buildActivityRows(events).length, [events]);
  const liveTools = useMemo(() => pairToolEvents(currentRunEvents), [currentRunEvents]);

  // Tick while running so the elapsed timer and provider-stall threshold are
  // live rather than frozen at the last event.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const runtime = useMemo(
    () => deriveChatRuntime({ status, currentRunEvents, now: tick }),
    [status, currentRunEvents, tick],
  );

  const errorEvent = latestEventOfType(events, 'error');
  const errorMessage = errorEvent ? String(errorEvent.data.message ?? 'The run failed.') : '';
  const filesTouched = useMemo(() => {
    const set = new Set<string>();
    for (const { call } of toolPairs) {
      const name = String(call.data.name);
      if (name !== 'file_write' && name !== 'file_edit') continue;
      const args = call.data.args as unknown as Record<string, unknown> | undefined;
      if (args && typeof args.path === 'string') set.add(args.path);
    }
    return Array.from(set);
  }, [toolPairs]);

  /* ── Autoscroll the run log ── */
  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  useEffect(() => {
    if (pinnedRef.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [timeline, currentRunText, liveTools.length]);

  /* ── Decision countdown (presentation only) ── */
  useEffect(() => {
    if (status !== 'awaiting_decision' || !task.decision_expires_at) return;
    const tick = () =>
      setDecisionSeconds(
        Math.max(0, Math.ceil((Date.parse(task.decision_expires_at as string) - Date.now()) / 1000)),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, task.decision_expires_at]);

  /* ── Git rail + Diff tab data ── */
  const loadGitStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/git`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setGitStatus(body.status ?? null);
      setGitStatusLoaded(true);
    } catch (err) {
      console.warn('[work] could not read git status:', err);
    }
  }, [task.id]);

  useEffect(() => { void loadGitStatus(); }, [loadGitStatus]);

  // Seed the Diff tab from PERSISTED history: the most recent successful
  // git diff the agent ran. Without this, a reload would forget a diff the
  // live stream would still be showing.
  useEffect(() => {
    let pending = false;
    let last: string | null = null;
    for (const event of parseEvents(initialEvents)) {
      if (event.type === 'tool_call' && event.data.name === 'git_op') {
        const args = event.data.args as unknown as Record<string, unknown> | undefined;
        pending = args?.op === 'diff';
      } else if (event.type === 'tool_result' && event.data.name === 'git_op') {
        if (pending) {
          pending = false;
          if (event.data.ok === true && typeof event.data.result === 'string') {
            last = event.data.result;
          }
        }
      }
    }
    if (last !== null) setDiffText(last);
  }, [initialEvents]);

  /**
   * Fetch the workspace diff on demand. `path` scopes the diff to one file so
   * a click on a Files-changed row shows that file's changes. A blocked
   * outcome (not a repo, git missing) is displayed as an explanation, never
   * as a fake empty diff.
   */
  const loadWorkspaceDiff = useCallback(async (path?: string) => {
    setDiffLoading(true);
    try {
      const qs = path ? `?path=${encodeURIComponent(path)}` : '';
      const res = await fetch(`/api/tasks/${task.id}/git/diff${qs}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDiffBlocked(body.error || `Could not load diff (${res.status}).`);
        return;
      }
      const body = await res.json();
      if (typeof body.diff === 'string') {
        setDiffText(body.diff);
        setDiffBlocked(null);
      } else {
        setDiffText(null);
        setDiffBlocked(typeof body.blocked === 'string' ? body.blocked : 'No diff available.');
      }
    } catch (err) {
      setDiffBlocked(err instanceof Error ? err.message : 'Could not load diff.');
    } finally {
      setDiffLoading(false);
    }
  }, [task.id]);

  /* ── Live stream ── */
  const addEvent = useCallback((event: ParsedEvent) => {
    if (seenSeq.current.has(event.seq)) return;
    seenSeq.current.add(event.seq);
    setEvents((prev) => [...prev, event].sort((a, b) => a.seq - b.seq));

    const { type, data } = event;
    if (type === 'task_status' && typeof data.status === 'string') {
      if (data.status !== 'completed' && data.status !== 'failed') setStatus(data.status as Task['status']);
    } else if (type === 'done' && typeof data.status === 'string') {
      setStatus(data.status as Task['status']);
      if (typeof data.summary === 'string' && data.summary) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.content === data.summary) return prev;
          return [
            ...prev,
            {
              id: Date.now(),
              task_id: task.id,
              role: 'assistant' as const,
              content: data.summary as string,
              active: 1,
              created_at: new Date().toISOString(),
            },
          ];
        });
      }
    } else if (type === 'plan' && typeof data.plan === 'string') {
      setProposedPlan(data.plan);
    } else if (type === 'credits' && typeof data.spent === 'number') {
      setCreditsSpent(data.spent);
    } else if (type === 'context' && typeof data.percentage === 'number') {
      setContextPct(data.percentage);
      if (typeof data.used_tokens === 'number') setContextTokens(data.used_tokens);
      if (typeof data.context_window === 'number') setContextWindow(data.context_window);
    } else if (type === 'todo_update' && Array.isArray(data.items)) {
      setTodos(data.items as { id: string; description: string; status: string }[]);
    } else if (type === 'upload' && typeof data.id === 'string') {
      setUploads((prev) => prev.map((u) => (u.id === data.id ? { ...u, ...(data as Partial<Upload>) } : u)));
    } else if (type === 'file_activity' && typeof data.path === 'string') {
      setFileChanges((prev) => [...prev, { action: String(data.action ?? 'changed'), path: String(data.path) }]);
    } else if (type === 'tool_call' && data.name === 'git_op') {
      // Mark a pending diff so the matching tool_result can feed the Diff tab.
      const args = data.args as unknown as Record<string, unknown> | undefined;
      pendingGitDiffRef.current = args?.op === 'diff';
    } else if (type === 'tool_result' && data.name === 'git_op') {
      if (pendingGitDiffRef.current) {
        pendingGitDiffRef.current = false;
        if (data.ok === true && typeof data.result === 'string') {
          // The agent ran a diff; show exactly what git returned — including
          // "(no differences)", which is an honest answer, not an error.
          setDiffText(data.result);
          setDiffBlocked(null);
        }
      }
    } else if (type === 'git_status' || type === 'git_commit') {
      // The run just observed repository state; refresh the rail.
      void loadGitStatus();
    }
  }, [task.id, loadGitStatus]);

  useEffect(() => {
    // Demo replay feeds the same events through the pacer; a parallel live
    // subscription here would double-deliver everything.
    if (isTerminal || demoMode) return;
    const source = new EventSource(`/api/tasks/${task.id}/stream`);
    // Subscriptions come from the shared registry. A hardcoded array here is
    // how v1.10.0's context_layers/memory events were silently dropped.
    const types = eventTypesFor('work');
    const handler = (e: MessageEvent) => {
      const seq = Number(e.lastEventId);
      if (!Number.isFinite(seq)) return;
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(e.data); } catch { data = { raw: e.data }; }
      addEvent({ seq, type: e.type, data, ts: Date.now() });
    };
    types.forEach((t) => source.addEventListener(t, handler as EventListener));
    return () => {
      types.forEach((t) => source.removeEventListener(t, handler as EventListener));
      source.close();
    };
  }, [task.id, isTerminal, demoMode, addEvent]);

  /* ── Recorded-demo pacer ── */
  // When opened with ?demo=1 the seeded task already contains every event;
  // instead of dumping them we reveal them on the recorded cadence through
  // addEvent — the exact path live SSE events take. The Skip control dumps
  // the remainder at once via a ref mirror (restarting the effect would
  // replay from the top; seenSeq dedupes, but the timer chain is cleaner).
  const [demoDone, setDemoDone] = useState(false);
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoRevealAllRef = useRef(false);
  useEffect(() => {
    if (!demoMode || demoSource.length === 0) return;
    let cancelled = false;
    const dtmsOf = (e: unknown): number => {
      const d = (e as { content?: { dtms?: unknown } })?.content;
      return typeof d?.dtms === 'number' ? Math.min(2500, Math.max(150, d.dtms)) : 500;
    };
    const revealFrom = (idx: number) => {
      if (cancelled || idx >= demoSource.length) {
        if (!cancelled) setDemoDone(true);
        return;
      }
      const ev = demoSource[idx];
      addEvent({ seq: ev.seq, type: ev.type, data: (ev.content ?? {}) as unknown as Record<string, unknown>, ts: Date.now() });
      if (demoRevealAllRef.current) {
        for (let j = idx + 1; j < demoSource.length; j += 1) {
          const e2 = demoSource[j];
          addEvent({ seq: e2.seq, type: e2.type, data: (e2.content ?? {}) as unknown as Record<string, unknown>, ts: Date.now() });
        }
        setDemoDone(true);
        return;
      }
      const nextDelay = dtmsOf(demoSource[idx]);
      demoTimerRef.current = setTimeout(() => revealFrom(idx + 1), nextDelay);
    };
    demoTimerRef.current = setTimeout(() => revealFrom(0), 300);
    return () => {
      cancelled = true;
      if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
    };
  }, [demoMode, demoSource, addEvent]);

  /* ── Governance actions ── */
  async function post(path: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/tasks/${task.id}${path}`, {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || `Request failed (${res.status}).` };
  }

  // Memory candidates are proposed at completion. Poll once per terminal state
  // change so the Memory tab badge reflects pending decisions.
  const loadPendingMemory = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/memory`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setPendingMemory(Array.isArray(body.candidates) ? body.candidates.length : 0);
    } catch (err) {
      console.warn('[work] could not read memory candidates:', err);
    }
  }, [task.id]);

  useEffect(() => { void loadPendingMemory(); }, [loadPendingMemory, status]);

  const approve = async () => {
    setBusy(true);
    const result = await post('/approve');
    setBusy(false);
    if (!result.ok) { toast.push('error', result.error!); return; }
    toast.push('success', 'Plan approved and frozen. Build started.');
    setStatus('pending');
    setTab('run');
  };

  const reject = async (reason: string) => {
    setBusy(true);
    const result = await post('/reject', { reason });
    setBusy(false);
    if (!result.ok) { toast.push('error', result.error!); return; }
    toast.push('info', 'Sent back for revision. A new planning run started.');
    setStatus('pending');
    setProposedPlan('');
  };

  const decide = async (choice: 'direct' | 'plan') => {
    setBusy(true);
    const result = await post('/decision', { choice });
    setBusy(false);
    if (!result.ok) { toast.push('error', result.error!); return; }
    toast.push('success', choice === 'direct' ? 'Execution brief frozen. Building.' : 'Planning run started.');
    setStatus('pending');
  };

  const cancelRun = async () => {
    setBusy(true);
    const result = await post('/cancel');
    setBusy(false);
    if (!result.ok) { toast.push('error', result.error!); return; }
    toast.push('info', 'Run cancelled. The event trail shows where it stopped.');
    setStatus('cancelled');
  };

  const sendFollowUp = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    const result = await post('/messages', { content: text });
    setBusy(false);
    if (!result.ok) { toast.push('error', result.error!); return; }
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(), task_id: task.id, role: 'user' as const,
        content: text, active: 1, created_at: new Date().toISOString(),
      },
    ]);
    setDraft('');
    setStatus('pending');
    pinnedRef.current = true;
  };

  /* ── Keyboard ── */
  useHotkeys([
    { combo: 'mod+1', run: () => setTab('run') },
    { combo: 'mod+2', run: () => setTab('activity') },
    { combo: 'mod+3', run: () => setTab('project') },
    { combo: 'mod+4', run: () => setTab('preview') },
    { combo: 'mod+5', run: () => setTab('context') },
    { combo: 'mod+6', run: () => setTab('memory') },
    { combo: 'mod+7', run: () => setTab('terminal') },
    { combo: 'mod+8', run: () => setTab('diff') },
    { combo: 'mod+Enter', run: () => void sendFollowUp(), allowInInput: true },
  ]);

  const tabs = [
    { id: 'run', label: 'Run', hint: `${mod}+1` },
    { id: 'activity', label: 'Activity', hint: `${mod}+2`, count: activityCount },
    { id: 'project', label: 'Project', hint: `${mod}+3` },
    { id: 'preview', label: 'Preview', hint: `${mod}+4` },
    { id: 'context', label: 'Context', hint: `${mod}+5` },
    { id: 'memory', label: 'Memory', hint: `${mod}+6`, count: pendingMemory },
    { id: 'terminal', label: 'Terminal', hint: `${mod}+7` },
    { id: 'diff', label: 'Diff', hint: `${mod}+8` },
  ];

  return (
    <div className="flex h-full min-h-0">
      {/* ── Run list ── */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line-subtle 2xl:flex">
        <div className="flex items-center justify-between px-3 pt-3">
          <Link href="/chat" className="text-micro font-semibold uppercase tracking-[0.16em] text-content-muted hover:text-content-primary">
            ← Workspace
          </Link>
        </div>
        <PanelHeader title="Work">
          <Link href="/work">
            <IconButton label="New work" size="sm">
              <span aria-hidden="true" className="text-ui leading-none">+</span>
            </IconButton>
          </Link>
        </PanelHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {runs.map((run) => (
            <Link
              key={run.id}
              href={`/work/${run.id}`}
              className={cx(
                'mb-0.5 block rounded-control px-2.5 py-2 transition',
                run.id === task.id
                  ? 'bg-ink-600 text-content-primary'
                  : 'text-content-muted hover:bg-ink-700 hover:text-content-secondary',
              )}
            >
              <span className="block truncate text-ui leading-5">{run.goal}</span>
              <StatusBadge status={run.status} className="mt-1" />
            </Link>
          ))}
        </div>
      </aside>

      {/* ── Center ── */}
      <Panel className="flex-1 border-r">
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line-subtle px-3">
          <Tabs items={tabs} active={tab} onChange={(id) => setTab(id as CenterTab)} />
          <div className="hidden min-w-0 items-center gap-3 lg:flex">
            {/* Clickable stage trail: each stage opens the surface that explains
                it, so progress is navigation rather than decoration. Overflow-safe:
                the trail can shrink (scroll-x) instead of clipping under the tabs. */}
            <div className="min-w-0 overflow-x-auto">
              <XeoFlow stages={flowStages} onOpen={openFlowStage} />
            </div>
            {isRunning && (
              <Button size="sm" variant="secondary" onClick={cancelRun} loading={busy} className="ml-1">
                Cancel
              </Button>
            )}
          </div>
        </div>

        {awaitingDecision && <DecisionGate seconds={decisionSeconds} busy={busy} onChoose={decide} />}

        {decisionExpired && (
          <div className="border-b border-line-subtle px-4 py-3">
            <Alert tone="warn" title="The decision window closed">
              Nothing was executed. Send a new message to start again — expiry never defaults to execution.
            </Alert>
          </div>
        )}

        {tab === 'run' && (
          <>
            {isPlanned && proposedPlan ? (
              <PlanReview plan={proposedPlan} busy={busy} onApprove={approve} onReject={reject} />
            ) : (
              <div ref={logRef} onScroll={onLogScroll} className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-3xl px-4 py-6">
                  {timeline.length === 0 && !isRunning ? (
                    <div className="run-empty mx-auto mt-16 flex max-w-md flex-col items-center text-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-panel border border-line-subtle bg-ink-900/60" aria-hidden="true">
                        <span className="ember-rule" />
                      </span>
                      <h3 className="mt-5 text-title font-semibold text-content-primary">Nothing has run yet</h3>
                      <p className="mt-2 text-body leading-6 text-content-muted">
                        Describe the change below and start a planning run. The agent inspects read-only first —
                        you approve before anything is written.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {timeline.map((turn) => (
                        <div key={turn.id}>
                          {turn.role === 'user' ? (
                            <div className="flex justify-end">
                              <div className="max-w-[85%] rounded-modal rounded-br-md bg-signal-plan/1 px-3.5 py-2.5 text-body leading-6 text-signal-plan">
                                <p className="whitespace-pre-wrap">{turn.content}</p>
                              </div>
                            </div>
                          ) : turn.role === 'system' ? (
                            <div className="rounded-control border border-line-subtle bg-ink-700/60 px-3 py-2">
                              <p className="text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
                                Context compacted
                              </p>
                              <p className="mt-1 text-ui leading-5 text-content-muted">{turn.content}</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {turn.toolEvents && turn.toolEvents.length > 0 && (
                                <div className="overflow-hidden rounded-control border border-line-subtle bg-black/15">
                                  {pairToolEvents(turn.toolEvents).map(({ call, result }) => (
                                    <ToolRow key={call.seq} call={call} result={result} />
                                  ))}
                                </div>
                              )}
                              {turn.content && (
                                <div
                                  className="markdown-content text-body leading-6 text-content-secondary"
                                  dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.content) }}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ))}

                      {isRunning && liveThinking && (
                        <ThinkingBlock text={liveThinking} live />
                      )}
                      {isRunning && liveTools.length === 0 && !currentRunText && (
                        <RuntimeBanner
                          label={runtime.label}
                          detail={runtime.detail}
                          elapsed={
                            runtime.sinceLastEventMs !== null
                              ? formatElapsed(runtime.sinceLastEventMs)
                              : undefined
                          }
                          stalled={runtime.stalled}
                        />
                      )}
                    </div>
                  )}

                  {status === 'failed' && errorMessage && (
                    <div className="run-failure mt-6 rounded-panel border border-signal-fail/25 bg-signal-fail/[0.05] p-5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-signal-fail/15 text-ui text-signal-fail" aria-hidden="true">✕</span>
                        <p className="text-ui font-semibold text-content-primary">Run failed</p>
                      </div>
                      <p className="mt-2.5 max-w-2xl text-body leading-6 text-content-secondary">{errorMessage}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-signal-fail/15 pt-3.5">
                        <p className="text-meta text-content-muted">Every step before the failure is preserved in the Activity tab — nothing was lost.</p>
                        <span className="flex-1" />
                        <button
                          type="button"
                          onClick={() => setTab('activity')}
                          className="rounded-control border border-line-subtle px-3 py-1.5 text-meta font-medium text-content-secondary transition hover:border-line-strong hover:text-content-primary"
                        >
                          Inspect the trail
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Follow-up composer — only when the agent is idle. */}
            {!isRunning && !isPlanned && !awaitingDecision && (
              <div className="shrink-0 border-t border-line-subtle px-4 py-3">
                <div className="mx-auto w-full max-w-3xl">
                  <div className="rounded-panel border border-line bg-ink-900/70 transition focus-within:border-signal-run/40">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={2}
                      placeholder="Follow up, or describe the next change…"
                      aria-label="Follow-up message"
                      className="block w-full resize-none bg-transparent px-3.5 py-2.5 text-body leading-6 text-content-primary outline-none placeholder:text-content-muted"
                    />
                    <div className="flex items-center justify-between gap-3 px-3 pb-2">
                      <UploadButton
                        taskId={task.id}
                        onUploaded={(upload) => setUploads((prev) => [...prev, upload])}
                        label="Attach"
                      />
                      <span className="flex items-center gap-2">
                        <KeyHint keys={[mod, 'Enter']} />
                        <Button size="sm" onClick={sendFollowUp} loading={busy} disabled={!draft.trim()}>
                          Send
                        </Button>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'activity' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {demoMode && !demoDone && (
              <button
                type="button"
                onClick={() => { demoRevealAllRef.current = true; }}
                className="mb-2 rounded-control border border-line-subtle px-3 py-1.5 text-meta text-content-muted transition hover:text-content-primary hover:border-accent-gold/40"
              >
                Skip to the end of the recording
              </button>
            )}
            <FileActivity events={events} isRunning={status === 'running'} />
            <ExecutionTimeline events={events} />
          </div>
        )}
        {tab === 'project' && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <WorkspaceViewer taskId={task.id} />
          </div>
        )}
        {tab === 'preview' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <PreviewPanel taskId={task.id} isTerminal={isTerminal} />
          </div>
        )}
        {tab === 'context' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-8">
              <ContextInspector taskId={task.id} />
              <TaskContextPanel taskId={task.id} />
            </div>
          </div>
        )}
        {tab === 'memory' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <MemoryReview taskId={task.id} onChanged={loadPendingMemory} />
          </div>
        )}
        {tab === 'terminal' && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <Terminal taskId={task.id} />
          </div>
        )}
        {tab === 'diff' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" loading={diffLoading} onClick={() => void loadWorkspaceDiff()}>
                Load workspace diff
              </Button>
              {diffText && (
                <Button size="sm" variant="ghost" onClick={() => { setDiffText(null); setDiffBlocked(null); }}>
                  Clear
                </Button>
              )}
              {gitStatus && (
                <span className="text-micro text-content-muted">
                  {gitStatus.detached ? 'detached HEAD' : gitStatus.branch ?? 'unborn'} ·{' '}
                  {gitStatus.dirtyCount === 0 ? 'clean' : `${gitStatus.dirtyCount} change${gitStatus.dirtyCount === 1 ? '' : 's'}`}
                </span>
              )}
            </div>
            {diffBlocked && !diffText && (
              <Alert tone="warn" title="No diff available">{diffBlocked}</Alert>
            )}
            {diffText ? (
              <DiffView unifiedText={diffText} />
            ) : fileChanges.length > 0 ? (
              <div className="space-y-1">
                <p className="mb-3 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
                  Files changed ({fileChanges.length}) — click a file to diff it against the repository
                </p>
                {fileChanges.map((fc, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => void loadWorkspaceDiff(fc.path)}
                    disabled={diffLoading}
                    className="flex w-full items-center gap-2 rounded-control border border-line-subtle bg-ink-700/40 px-3 py-2 text-left transition hover:border-line-strong disabled:opacity-60"
                  >
                    <span
                      className={
                        fc.action === 'created'
                          ? 'text-signal-pass'
                          : fc.action === 'deleted'
                            ? 'text-signal-fail'
                            : 'text-signal-gate'
                      }
                    >
                      {fc.action === 'created' ? 'A' : fc.action === 'deleted' ? 'D' : 'M'}
                    </span>
                    <span className="truncate font-mono text-ui text-content-secondary">{fc.path}</span>
                  </button>
                ))}
              </div>
            ) : !diffBlocked ? (
              <EmptyState
                icon={<span aria-hidden="true">Diff</span>}
                title="No changes yet"
                description="File changes made by the agent will appear here. When the workspace is a git repository you can also load the full working-tree diff."
              />
            ) : null}
          </div>
        )}
      </Panel>

      {/* ── Governance rail ── */}
      <aside className="hidden w-rail shrink-0 flex-col overflow-y-auto border-l border-line-subtle xl:flex">
        <PanelHeader title="Governance" />
        <div className="space-y-4 p-3">
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">State</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={status} />
              <Badge tone={task.mode === 'build' ? 'violet' : 'amber'}>{task.mode}</Badge>
              {task.intent_kind && <Badge tone="gray">{INTENT_LABEL[task.intent_kind] ?? task.intent_kind}</Badge>}
              {demoMode && (
                <Badge tone="amber">recorded demo</Badge>
              )}
            </div>          </div>

          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
              Authority
            </p>
            {/* Mirrors what executeTool + authorizeToolCall enforce at dispatch.
                The stored autonomy level shapes these rows live, so the panel
                shows the same policy the executor applies. Each row carries a
                "why" in its title attribute rather than a separate help page. */}
            <div className="space-y-0.5">
              {authorityForMode(task.mode, task.autonomy_level).map((row) => (
                <AuthorityRow key={row.label} label={row.label} state={row.state} reason={row.reason} />
              ))}
              <AuthorityRow
                label="Plan frozen"
                state={task.approved_plan ? 'allowed' : 'locked'}
                reason={
                  task.approved_plan
                    ? 'An approved plan was snapshotted and is immutable during this build.'
                    : 'No plan has been approved, so there is no immutable contract yet.'
                }
              />
            </div>
          </div>

          {task.project_path && (
            <div>
              <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
                Boundary
              </p>
              <p className="break-all rounded-control border border-line-subtle bg-black/20 px-2.5 py-2 font-mono text-micro leading-4 text-content-secondary">
                {task.project_path}
              </p>
            </div>
          )}

          {/* Git rail. Renders NOTHING while the workspace is not a repository
              root — an invented "clean" state for a directory with no history
              would be a UI truth violation (AGENTS.md §16). */}
          {gitStatus && (
            <div>
              <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
                Repository
              </p>
              <div className="rounded-control border border-line-subtle bg-black/20 px-2.5 py-2">
                <p className="flex items-center gap-1.5 text-ui text-content-secondary">
                  <span className={gitStatus.dirtyCount === 0 ? 'text-signal-pass' : 'text-signal-gate'}>
                    {gitStatus.detached ? 'detached HEAD' : gitStatus.branch ?? 'unborn'}
                  </span>
                  {gitStatus.dirtyCount > 0 && (
                    <span className="text-micro text-content-muted">
                      · {gitStatus.dirtyCount} change{gitStatus.dirtyCount === 1 ? '' : 's'}
                    </span>
                  )}
                </p>
                {gitStatus.lastCommit && (
                  <p className="mt-1 truncate font-mono text-micro leading-4 text-content-muted" title={gitStatus.lastCommit.subject}>
                    {gitStatus.lastCommit.hash.slice(0, 7)} {gitStatus.lastCommit.subject}
                  </p>
                )}
                <p className="mt-1.5 text-micro leading-4 text-content-faint">
                  {gitStatus.staged} staged · {gitStatus.unstaged} unstaged · {gitStatus.untracked} untracked
                </p>
              </div>
            </div>
          )}
          {/* The rail asked and git answered "not a repo here" — say so rather
              than leaving the user wondering whether the rail is broken. */}
          {gitStatusLoaded && !gitStatus && task.project_path && (
            <div>
              <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
                Repository
              </p>
              <p className="rounded-control border border-line-subtle bg-black/20 px-2.5 py-2 text-micro leading-4 text-content-faint">
                Not a git repository root. Parent repositories are deliberately ignored.
              </p>
            </div>
          )}

          <Divider />

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-control border border-line-subtle bg-black/20 px-2.5 py-2">
              <p className="text-micro uppercase tracking-[0.12em] text-content-muted">Credits</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-content-primary">{creditsSpent}</p>
            </div>
            <div className="rounded-control border border-line-subtle bg-black/20 px-2.5 py-2">
              <p className="text-micro uppercase tracking-[0.12em] text-content-muted">Actions</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-content-primary">{toolPairs.length}</p>
            </div>
          </div>

          {contextPct !== null && (
            <Meter
              value={contextPct}
              label="Context"
              detail={
                contextWindow > 0
                  ? `${contextTokens.toLocaleString()} of ${contextWindow.toLocaleString()} tokens`
                  : `${contextTokens.toLocaleString()} tokens`
              }
            />
          )}

          {todos.length > 0 && (
            <div>
              <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
                Checklist
              </p>
              <ul className="space-y-1">
                {todos.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-meta leading-5">
                    <span
                      className={cx(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        item.status === 'done' ? 'bg-signal-pass/80' : item.status === 'in_progress' ? 'animate-live-pulse bg-signal-run' : 'bg-gray-700',
                      )}
                    />
                    <span className={item.status === 'done' ? 'text-content-muted line-through' : 'text-content-secondary'}>
                      {item.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filesTouched.length > 0 && (
            <div>
              <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
                Files changed ({filesTouched.length})
              </p>
              <ul className="space-y-0.5">
                {filesTouched.map((path) => (
                  <li key={path} className="truncate font-mono text-micro leading-5 text-signal-gate/80" title={path}>
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {uploads.length > 0 && (
            <div>
              <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
                Uploads
              </p>
              <ul className="space-y-0.5">
                {uploads.map((upload) => (
                  <li key={upload.id} className="flex items-center justify-between gap-2 text-micro leading-5">
                    <span className="truncate font-mono text-content-muted">{upload.filename}</span>
                    <Badge tone={upload.status === 'ready' ? 'emerald' : upload.status === 'rejected' ? 'red' : 'gray'}>
                      {upload.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Divider />

          <div className="space-y-1.5">
            {isTerminal && (
              <a
                href={`/api/tasks/${task.id}/export`}
                className="block rounded-control border border-line-subtle px-2.5 py-2 text-center text-meta text-content-secondary transition hover:border-line-strong hover:text-content-primary"
              >
                Export audit trail
              </a>
            )}
            {!isRunning && task.mode === 'build' && (
              <button
                type="button"
                onClick={async () => {
                  const result = await post('/mode', { mode: 'planning' });
                  if (!result.ok) { toast.push('error', result.error!); return; }
                  toast.push('info', 'Switched to planning. Approved plan cleared.');
                  router.refresh();
                }}
                className="w-full rounded-control border border-line-subtle px-2.5 py-2 text-meta text-content-secondary transition hover:border-line-strong hover:text-content-primary"
              >
                Re-plan this task
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
