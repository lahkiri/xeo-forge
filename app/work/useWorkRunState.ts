'use client';

/**
 * Work run state — every piece of state the Work surface mirrors from the
 * run, its ingestion path, and the three healing inputs (SSE stream, server
 * reconciliation poll, recorded-demo pacer).
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM: the
 * addEvent chain, the SSE subscription, the reconciliation poll and the demo
 * pacer are byte-identical to the v1.23 implementations; only the module
 * boundary moved. The contracts are pinned by test/chat-hang-reconciliation
 * (H3), test/demo-replay-contract and test/run-agent-behavior — the hooks'
 * source is read by those tests, so this file is part of the audited surface.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { useRouter } from 'next/navigation';
import type { Message, Task, TaskEvent, Upload } from '@/lib/types';
import {
  isRunningStatus,
  isTerminalStatus,
  parseEvents,
  splitRuns,
  type ParsedEvent,
} from '@/lib/agent/timeline';
import { eventTypesFor } from '@/lib/agent/events';
import { pairToolEvents } from '@/components/WorkPrimitives';

/** Setter bundle handed over by useWorkspaceDiff (see addEvent's git_op arms). */
export interface DiffSink {
  setDiffText: (value: string | null) => void;
  setDiffBlocked: (value: string | null) => void;
  pendingGitDiffRef: { current: boolean };
}

export function useWorkRunState({
  task,
  initialEvents,
  initialMessages,
  initialUploads,
  demoMode,
  demoSource,
  router,
  loadGitStatus,
  diff,
}: {
  task: Task;
  initialEvents: TaskEvent[];
  initialMessages: Message[];
  initialUploads: Upload[];
  demoMode: boolean;
  demoSource: TaskEvent[];
  router: ReturnType<typeof useRouter>;
  loadGitStatus: () => Promise<void>;
  diff: DiffSink;
}) {
  // Demo replay starts visually empty; the pacer below reveals the recorded
  // script through the same addEvent path live events use.
  const [events, setEvents] = useState<ParsedEvent[]>(() => parseEvents(demoMode ? [] : initialEvents));
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [uploads, setUploads] = useState<Upload[]>(initialUploads);
  const [status, setStatus] = useState(task.status);
  const [proposedPlan, setProposedPlan] = useState(task.plan ?? '');
  const [creditsSpent, setCreditsSpent] = useState(task.credits_spent);
  const [contextPct, setContextPct] = useState<number | null>(null);
  const [contextTokens, setContextTokens] = useState(0);
  const [contextWindow, setContextWindow] = useState(0);
  const [todos, setTodos] = useState<{ id: string; description: string; status: string }[]>([]);
  const [fileChanges, setFileChanges] = useState<{ action: string; path: string }[]>([]);

  const seenSeq = useRef<Set<number>>(new Set(initialEvents.map((e) => e.seq)));

  const isTerminal = isTerminalStatus(status);
  const isRunning = isRunningStatus(status);

  const { currentRunEvents, currentRunText } = splitRuns(events);

  // Tick while running so the elapsed timer and provider-stall threshold are
  // live rather than frozen at the last event.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  /* ── Live stream ingestion ── */
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
      diff.pendingGitDiffRef.current = args?.op === 'diff';
    } else if (type === 'tool_result' && data.name === 'git_op') {
      if (diff.pendingGitDiffRef.current) {
        diff.pendingGitDiffRef.current = false;
        if (data.ok === true && typeof data.result === 'string') {
          // The agent ran a diff; show exactly what git returned — including
          // "(no differences)", which is an honest answer, not an error.
          diff.setDiffText(data.result);
          diff.setDiffBlocked(null);
        }
      }
    } else if (type === 'git_status' || type === 'git_commit') {
      // The run just observed repository state; refresh the rail.
      void loadGitStatus();
    }
  }, [task.id, loadGitStatus, diff]);

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

  /* ── Server reconciliation poll (v1.22 hang fix) ──
     Same contract as the chat surface: the SSE stream is one input, the task
     row is the truth. If the stream dies mid-run (window reload, network
     drop, provider crash without a terminal event), the run used to look
     "running" forever with the composer locked. While the status is live we
     re-read the row every few seconds and adopt the server's terminal state;
     a refresh then rebuilds the timeline from persisted events so nothing
     the run actually did is missing from the log. */
  const eventsRef = useRef(events);
  eventsRef.current = events;
  useEffect(() => {
    if (demoMode || !isRunning) return;
    let cancelled = false;
    const reconcile = async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const serverStatus: string | undefined = body?.task?.status;
        if (!serverStatus || cancelled) return;
        if (isTerminalStatus(serverStatus) && serverStatus !== status) {
          setStatus(serverStatus as Task['status']);
          const sawLiveOutput =
            splitRuns(eventsRef.current).currentRunText.trim().length > 0 ||
            pairToolEvents(splitRuns(eventsRef.current).currentRunEvents).length > 0;
          if (!sawLiveOutput) router.refresh();
        }
      } catch {
        // Offline / transient: keep the stream and the last known state.
      }
    };
    const id = setInterval(() => void reconcile(), 4_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [task.id, demoMode, isRunning, status, router]);

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

  return {
    events,
    messages,
    setMessages,
    uploads,
    setUploads,
    status,
    setStatus,
    proposedPlan,
    setProposedPlan,
    creditsSpent,
    contextPct,
    contextTokens,
    contextWindow,
    todos,
    fileChanges,
    isTerminal,
    isRunning,
    currentRunEvents,
    currentRunText,
    tick,
    demoDone,
    demoRevealAllRef,
  };
}
