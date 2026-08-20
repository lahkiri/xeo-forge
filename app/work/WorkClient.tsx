'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Message, Task, TaskEvent, Upload } from '@/lib/types';
import {
  buildTimeline,
  derivePhase,
  isRunningStatus,
  isTerminalStatus,
  latestEventOfType,
  parseEvents,
  splitRuns,
  type ParsedEvent,
  type Phase,
} from '@/lib/agent/timeline';
import { renderMarkdown } from '@/lib/markdown';
import { deriveChatRuntime, formatElapsed } from '@/lib/agent/runtime-state';
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
  Spinner,
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

/* ------------------------------------------------------------------ */
/*  WORK SURFACE                                                       */
/*                                                                     */
/*  Work is governed agency, so the layout leads with governance:       */
/*  what the agent intends, what it is allowed to do, what it did, and  */
/*  what it costs. Three panes — run log, artifact, governance rail.    */
/* ------------------------------------------------------------------ */

const PHASE_STEPS: { id: Phase; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'execute', label: 'Execute' },
  { id: 'verify', label: 'Verify' },
  { id: 'done', label: 'Done' },
];

function PhaseTrail({ phase }: { phase: Phase }) {
  const activeIndex = PHASE_STEPS.findIndex((s) => s.id === phase);
  return (
    <div className="flex items-center gap-1.5">
      {PHASE_STEPS.map((step, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <div key={step.id} className="flex items-center gap-1.5">
            <span
              className={cx(
                'text-[10px] font-medium uppercase tracking-[0.12em] transition',
                active ? 'text-cyan-200' : done ? 'text-gray-500' : 'text-gray-700',
              )}
            >
              {step.label}
            </span>
            {index < PHASE_STEPS.length - 1 && (
              <span className={cx('h-px w-4', done ? 'bg-gray-600' : 'bg-white/[0.08]')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

type CenterTab = 'run' | 'project' | 'preview' | 'context' | 'memory';

export default function WorkClient({
  runs,
  task,
  initialEvents,
  initialMessages,
  initialUploads,
}: {
  runs: { id: string; goal: string; status: string; mode: string }[];
  task: Task;
  initialEvents: TaskEvent[];
  initialMessages: Message[];
  initialUploads: Upload[];
}) {
  const router = useRouter();
  const toast = useToast();
  const mod = useModKey();

  const [events, setEvents] = useState<ParsedEvent[]>(() => parseEvents(initialEvents));
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
  const [decisionSeconds, setDecisionSeconds] = useState(() =>
    task.decision_expires_at
      ? Math.max(0, Math.ceil((Date.parse(task.decision_expires_at) - Date.now()) / 1000))
      : 0,
  );

  const seenSeq = useRef<Set<number>>(new Set(initialEvents.map((e) => e.seq)));
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const isTerminal = isTerminalStatus(status);
  const isRunning = isRunningStatus(status);
  const isPlanned = status === 'planned';
  const awaitingDecision =
    status === 'awaiting_decision' && task.decision_state === 'pending' && decisionSeconds > 0;
  const decisionExpired = status === 'awaiting_decision' && decisionSeconds <= 0;

  const { currentRunEvents, currentRunText } = useMemo(() => splitRuns(events), [events]);
  const timeline = useMemo(
    () => buildTimeline({ events, messages, status, goal: task.goal }),
    [events, messages, status, task.goal],
  );
  const phase = derivePhase({ status, isChat: false, currentRunEvents });
  const toolPairs = useMemo(() => pairToolEvents(events), [events]);
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
      const args = call.data.args as Record<string, unknown> | undefined;
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
    }
  }, [task.id]);

  useEffect(() => {
    if (isTerminal) return;
    const source = new EventSource(`/api/tasks/${task.id}/stream`);
    const types = [
      'task_status', 'mode', 'intent', 'plan', 'text', 'reasoning', 'tool_call', 'tool_result',
      'credits', 'context', 'compaction', 'model_retry', 'error', 'done', 'upload',
      'todo_update', 'verification', 'file_activity',
    ];
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
  }, [task.id, isTerminal, addEvent]);

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
    { combo: 'mod+2', run: () => setTab('project') },
    { combo: 'mod+3', run: () => setTab('preview') },
    { combo: 'mod+4', run: () => setTab('context') },
    { combo: 'mod+5', run: () => setTab('memory') },
    { combo: 'mod+Enter', run: () => void sendFollowUp(), allowInInput: true },
  ]);

  const tabs = [
    { id: 'run', label: 'Run', hint: `${mod}+1` },
    { id: 'project', label: 'Project', hint: `${mod}+2` },
    { id: 'preview', label: 'Preview', hint: `${mod}+3` },
    { id: 'context', label: 'Context', hint: `${mod}+4` },
    { id: 'memory', label: 'Memory', hint: `${mod}+5`, count: pendingMemory },
  ];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0">
      {/* ── Run list ── */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-white/[0.07] xl:flex">
        <PanelHeader title="Work">
          <Link href="/work">
            <IconButton label="New work" size="sm">
              <span aria-hidden="true" className="text-sm leading-none">+</span>
            </IconButton>
          </Link>
        </PanelHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {runs.map((run) => (
            <Link
              key={run.id}
              href={`/work/${run.id}`}
              className={cx(
                'mb-0.5 block rounded-lg px-2.5 py-2 transition',
                run.id === task.id
                  ? 'bg-white/[0.08] text-gray-100'
                  : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300',
              )}
            >
              <span className="block truncate text-[12px] leading-5">{run.goal}</span>
              <StatusBadge status={run.status} className="mt-1" />
            </Link>
          ))}
        </div>
      </aside>

      {/* ── Center ── */}
      <Panel className="flex-1 border-r">
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] px-3">
          <Tabs items={tabs} active={tab} onChange={(id) => setTab(id as CenterTab)} />
          <div className="hidden items-center gap-3 lg:flex">
            <PhaseTrail phase={phase} />
          </div>
        </div>

        {awaitingDecision && <DecisionGate seconds={decisionSeconds} busy={busy} onChoose={decide} />}

        {decisionExpired && (
          <div className="border-b border-white/[0.07] px-4 py-3">
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
                    <EmptyState
                      icon={<span aria-hidden="true">⚙</span>}
                      title="No activity yet"
                      description="This run has not produced any events."
                    />
                  ) : (
                    <div className="space-y-5">
                      {timeline.map((turn) => (
                        <div key={turn.id}>
                          {turn.role === 'user' ? (
                            <div className="flex justify-end">
                              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-violet-300/[0.1] px-3.5 py-2.5 text-[13px] leading-6 text-violet-50">
                                <p className="whitespace-pre-wrap">{turn.content}</p>
                              </div>
                            </div>
                          ) : turn.role === 'system' ? (
                            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
                                Context compacted
                              </p>
                              <p className="mt-1 text-[12px] leading-5 text-gray-500">{turn.content}</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {turn.toolEvents && turn.toolEvents.length > 0 && (
                                <div className="overflow-hidden rounded-lg border border-white/[0.06] bg-black/15">
                                  {pairToolEvents(turn.toolEvents).map(({ call, result }) => (
                                    <ToolRow key={call.seq} call={call} result={result} />
                                  ))}
                                </div>
                              )}
                              {turn.content && (
                                <div
                                  className="markdown-content text-[13px] leading-6 text-gray-300"
                                  dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.content) }}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ))}

                      {isRunning && liveTools.length === 0 && !currentRunText && (
                        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <Spinner className="text-gray-600" />
                            <span className="text-[12px] text-gray-300">{runtime.label}</span>
                            {runtime.sinceLastEventMs !== null && (
                              <span className="text-[11px] tabular-nums text-gray-600">
                                {formatElapsed(runtime.sinceLastEventMs)}
                              </span>
                            )}
                          </div>
                          {runtime.detail && (
                            <p className="mt-1 truncate font-mono text-[11px] text-gray-600" title={runtime.detail}>
                              {runtime.detail}
                            </p>
                          )}
                          {runtime.stalled && (
                            <p className="mt-1.5 text-[11px] leading-5 text-amber-200/90">
                              The provider has not returned a response yet.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {status === 'failed' && errorMessage && (
                    <div className="mt-5">
                      <Alert tone="error" title="Run failed">{errorMessage}</Alert>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Follow-up composer — only when the agent is idle. */}
            {!isRunning && !isPlanned && !awaitingDecision && (
              <div className="shrink-0 border-t border-white/[0.07] px-4 py-3">
                <div className="mx-auto w-full max-w-3xl">
                  <div className="rounded-xl border border-white/10 bg-[#0c1320]/90 transition focus-within:border-cyan-300/40">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={2}
                      placeholder="Follow up, or describe the next change…"
                      aria-label="Follow-up message"
                      className="block w-full resize-none bg-transparent px-3.5 py-2.5 text-[13px] leading-6 text-gray-100 outline-none placeholder:text-gray-600"
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
      </Panel>

      {/* ── Governance rail ── */}
      <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto lg:flex">
        <PanelHeader title="Governance" />
        <div className="space-y-4 p-3">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">State</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={status} />
              <Badge tone={task.mode === 'build' ? 'violet' : 'amber'}>{task.mode}</Badge>
              {task.intent_kind && <Badge tone="gray">{task.intent_kind}</Badge>}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
              Authority
            </p>
            <div className="space-y-1.5 text-[11px] leading-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Write files</span>
                <Badge tone={task.mode === 'build' ? 'emerald' : 'gray'}>
                  {task.mode === 'build' ? 'allowed' : 'locked'}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Run commands</span>
                <Badge tone={task.mode === 'build' ? 'emerald' : 'gray'}>
                  {task.mode === 'build' ? 'allowed' : 'locked'}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Plan frozen</span>
                <Badge tone={task.approved_plan ? 'emerald' : 'gray'}>
                  {task.approved_plan ? 'yes' : 'no'}
                </Badge>
              </div>
            </div>
          </div>

          {task.project_path && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
                Boundary
              </p>
              <p className="break-all rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-2 font-mono text-[10px] leading-4 text-gray-400">
                {task.project_path}
              </p>
            </div>
          )}

          <Divider />

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.12em] text-gray-600">Credits</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-gray-200">{creditsSpent}</p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.12em] text-gray-600">Actions</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-gray-200">{toolPairs.length}</p>
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
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
                Checklist
              </p>
              <ul className="space-y-1">
                {todos.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-[11px] leading-5">
                    <span
                      className={cx(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        item.status === 'done' ? 'bg-emerald-400/80' : item.status === 'in_progress' ? 'animate-pulse bg-cyan-300' : 'bg-gray-700',
                      )}
                    />
                    <span className={item.status === 'done' ? 'text-gray-600 line-through' : 'text-gray-400'}>
                      {item.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filesTouched.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
                Files changed ({filesTouched.length})
              </p>
              <ul className="space-y-0.5">
                {filesTouched.map((path) => (
                  <li key={path} className="truncate font-mono text-[10px] leading-5 text-amber-200/80" title={path}>
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {uploads.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
                Uploads
              </p>
              <ul className="space-y-0.5">
                {uploads.map((upload) => (
                  <li key={upload.id} className="flex items-center justify-between gap-2 text-[10px] leading-5">
                    <span className="truncate font-mono text-gray-500">{upload.filename}</span>
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
                className="block rounded-lg border border-white/[0.08] px-2.5 py-2 text-center text-[11px] text-gray-400 transition hover:border-white/20 hover:text-gray-100"
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
                className="w-full rounded-lg border border-white/[0.08] px-2.5 py-2 text-[11px] text-gray-400 transition hover:border-white/20 hover:text-gray-100"
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
