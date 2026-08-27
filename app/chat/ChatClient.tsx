'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Message, Task, TaskEvent, TaskStatus } from '@/lib/types';
import { parseEvents, splitRuns, separateThinkTags, type ParsedEvent } from '@/lib/agent/timeline';
import { deriveChatRuntime, formatElapsed, isTerminalTaskStatus } from '@/lib/agent/runtime-state';
import { eventTypesFor } from '@/lib/agent/events';
import { RuntimeBanner } from '@/components/AgentPrimitives';
import {
  Alert,
  Button,
  EmptyState,
  IconButton,
  KeyHint,
  cx,
  useModKey,
  useToast,
} from '@/components/ui';
import { renderMarkdown } from '@/lib/markdown';
import { ThinkingBlock, reasoningTextOf } from '@/components/ThinkingBlock';
import {
  IconArrowLeft,
  IconArrowRight,
  IconPlus,
  IconSparkles,
  IconSquare,
} from '@/components/icons';

/* ------------------------------------------------------------------ */
/*  CHAT SURFACE                                                       */
/*                                                                     */
/*  Chat is conversation. It cannot plan and cannot write, so this      */
/*  layout deliberately has no tabs, no phase indicator, no workspace   */
/*  browser, and no approval affordances. One column, one composer.     */
/*  Anything that hints at agency belongs to /work.                     */
/* ------------------------------------------------------------------ */

const STARTERS = [
  'Explain the tradeoffs between SQLite and Postgres for a local-first desktop app.',
  'What does this error mean: ECONNREFUSED 127.0.0.1:5432?',
  'Compare optimistic and pessimistic locking for a credit ledger.',
];

interface ChatThread {
  id: string;
  goal: string;
  status: string;
  updated_at: string;
}

export default function ChatClient({
  threads,
  activeTask,
  initialMessages,
  initialEvents,
}: {
  threads: ChatThread[];
  activeTask: Task | null;
  initialMessages: Message[];
  initialEvents: TaskEvent[];
}) {
  const router = useRouter();
  const toast = useToast();
  const mod = useModKey();

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [events, setEvents] = useState<ParsedEvent[]>(() => parseEvents(initialEvents));
  const [status, setStatus] = useState(activeTask?.status ?? 'completed');
  const [error, setError] = useState('');

  const seenSeq = useRef<Set<number>>(new Set(initialEvents.map((e) => e.seq)));
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pinnedRef = useRef(true);

  const isStreaming = status === 'running' || status === 'pending';
  const { currentRunEvents, currentRunText } = useMemo(() => splitRuns(events), [events]);
  // Reasoning reaches the UI through TWO channels: `reasoning` events (models
  // with a native reasoning_content stream) and inline <think>…</think> tags
  // inside text deltas (DeepSeek-R1-style gateways — the server strips them
  // from the persisted answer, the client mirrors that here for the live
  // view). Both merge into one collapsible thinking surface; the answer text
  // stays clean either way.
  const { reasoning: taggedThinking, answer: runAnswer } = useMemo(
    () => separateThinkTags(currentRunText),
    [currentRunText],
  );
  const liveThinking = useMemo(
    () => [reasoningTextOf(currentRunEvents), taggedThinking].filter(Boolean).join('\n'),
    [currentRunEvents, taggedThinking],
  );
  // After a run completes, the thinking must not vanish — reconstruct the
  // last completed run's reasoning from persisted events so the user can
  // still open "Thought process" above the final answer.
  const finalRunThinking = useMemo(() => {
    if (isStreaming) return '';
    const dones = events.filter((e) => e.type === 'done').map((e) => e.seq);
    if (dones.length === 0) return '';
    const end = dones[dones.length - 1];
    const start = dones.length > 1 ? dones[dones.length - 2] : 0;
    const runEvents = events.filter((e) => e.seq > start && e.seq <= end);
    const rawText = runEvents
      .filter((e) => e.type === 'text')
      .map((e) => (typeof e.data.delta === 'string' ? e.data.delta : ''))
      .join('');
    return [reasoningTextOf(runEvents), separateThinkTags(rawText).reasoning]
      .filter(Boolean)
      .join('\n');
  }, [events, isStreaming]);
  const shownThinking = isStreaming ? liveThinking : finalRunThinking;

  // v1.22 hang fix: the composer used to lock forever when a `done` event was
  // never delivered (dead EventSource, provider crash without an error event,
  // server restart mid-run). The stream is now treated as one input among two:
  // a reconciliation poll re-reads the task row, and the SERVER's status always
  // wins. If the server reached a terminal state we never saw streamed, the
  // persisted answer is already in the DB — a refresh surfaces it.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const [streamLost, setStreamLost] = useState(false);
  const sawDoneRef = useRef(false);

  // Tick while streaming so the elapsed timer and the provider-stall threshold
  // are live rather than frozen at the last event.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  const runtime = useMemo(
    () => deriveChatRuntime({ status, currentRunEvents, now: tick }),
    [status, currentRunEvents, tick],
  );

  /* ── Autoscroll, but never fight the user ── */
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (pinnedRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, runAnswer]);

  /* ── Composer autosize ── */
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  /* ── Live stream ── */
  const addEvent = useCallback((event: ParsedEvent) => {
    if (seenSeq.current.has(event.seq)) return;
    seenSeq.current.add(event.seq);
    setEvents((prev) => [...prev, event].sort((a, b) => a.seq - b.seq));

    if (event.type === 'done') {
      sawDoneRef.current = true;
      const summary = typeof event.data.summary === 'string' ? event.data.summary : '';
      // The server persists the verbatim streamed answer in chat mode (loop.ts
      // chatTextBuffer). If that streamed text is present and already CONTAINS
      // the terse task_complete summary, appending it would duplicate a subset
      // of what the user just read. Skip; reload shows the persisted prose.
      // (Read through the ref mirror — the memoized closure would otherwise
      // dedupe against a stale snapshot.)
      const streamedNow = separateThinkTags(splitRuns(eventsRef.current).currentRunText).answer;
      if (summary && streamedNow && streamedNow.includes(summary)) {
        setStatus(typeof event.data.status === 'string' ? (event.data.status as TaskStatus) : status);
        return;
      }
      if (summary) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.content === summary) return prev;
          return [
            ...prev,
            {
              id: Date.now(),
              task_id: activeTask?.id ?? '',
              role: 'assistant' as const,
              content: summary,
              active: 1,
              created_at: new Date().toISOString(),
            },
          ];
        });
      }
      setStatus(typeof event.data.status === 'string' ? (event.data.status as TaskStatus) : 'completed');
    } else if (event.type === 'error') {
      setError(typeof event.data.message === 'string' ? event.data.message : 'Something went wrong.');
    }
  }, [activeTask?.id, status]);

  useEffect(() => {
    // Terminal per the SERVER's vocabulary: completed / failed / cancelled and
    // the work-surface 'planned' (a promote can flip mode mid-thread). Without
    // 'cancelled' here the composer stayed locked after a stop.
    if (!activeTask || isTerminalTaskStatus(status)) return;
    const source = new EventSource(`/api/tasks/${activeTask.id}/stream`);
    // Subscriptions come from the shared registry, never a local literal.
    const types = eventTypesFor('chat');
    const handler = (e: MessageEvent) => {
      const seq = Number(e.lastEventId);
      if (!Number.isFinite(seq)) return;
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(e.data); } catch { data = { raw: e.data }; }
      setStreamLost(false);
      addEvent({ seq, type: e.type, data, ts: Date.now() });
    };
    types.forEach((t) => source.addEventListener(t, handler as EventListener));
    source.onopen = () => setStreamLost(false);
    // EventSource auto-reconnects, but if the run already ended server-side
    // the replay may carry nothing new. The reconciliation poll below is the
    // authoritative healer; this handler only keeps the banner honest.
    source.onerror = () => setStreamLost(true);
    return () => {
      types.forEach((t) => source.removeEventListener(t, handler as EventListener));
      source.onopen = null;
      source.onerror = null;
      source.close();
    };
  }, [activeTask, status, addEvent]);

  /* ── Server reconciliation poll (v1.22 hang fix) ──
     While a turn is in flight, re-read the task row every few seconds and
     adopt the server's status when it reaches a terminal state. This heals
     every variant of the "thinking forever" hang: SSE dropped mid-run, a run
     that crashed without emitting `done`, an Electron reload that orphaned
     the stream, or a provider stall the server already failed. If the server
     finished but we never streamed the answer, the persisted messages are
     already in the DB — refresh surfaces them verbatim. */
  useEffect(() => {
    if (!activeTask || !isStreaming) return;
    let cancelled = false;
    const reconcile = async () => {
      try {
        const res = await fetch(`/api/tasks/${activeTask.id}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const serverStatus: string | undefined = body?.task?.status;
        if (!serverStatus || cancelled) return;
        if (isTerminalTaskStatus(serverStatus) && serverStatus !== status) {
          sawDoneRef.current = true;
          setStatus(serverStatus as TaskStatus);
          // We never received the streamed answer — load the persisted one.
          if (!splitRuns(eventsRef.current).currentRunText.trim()) router.refresh();
        }
      } catch {
        // Offline / transient: keep the stream and the last known state.
      }
    };
    const id = setInterval(() => void reconcile(), 4_000);
    void reconcile();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeTask, isStreaming, status, router]);

  /* ── Stop: the escape hatch must always exist while a turn is live ── */
  const stopRun = useCallback(async () => {
    if (!activeTask) return;
    try {
      await fetch(`/api/tasks/${activeTask.id}/cancel`, { method: 'POST' });
      // The cancel route flips the row to 'cancelled' and emits done; the
      // reconciliation poll adopts it even if the stream never delivers.
    } catch {
      setError('Could not reach the server to stop this run. Try again.');
    }
  }, [activeTask]);

  /* ── Send ── */
  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setError('');
    setSending(true);
    pinnedRef.current = true;

    try {
      if (!activeTask) {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ goal: text, mode: 'chat', surface: 'chat' }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Could not start this conversation.');
          return;
        }
        setDraft('');
        router.push(`/chat/${data.task.id}`);
        return;
      }

      const res = await fetch(`/api/tasks/${activeTask.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not send that message.');
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          task_id: activeTask.id,
          role: 'user' as const,
          content: text,
          active: 1,
          created_at: new Date().toISOString(),
        },
      ]);
      setDraft('');
      setStatus('pending');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSending(false);
    }
  };

  const promoteToWork = async () => {
    if (!activeTask) return;
    try {
      const res = await fetch(`/api/tasks/${activeTask.id}/mode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'planning' }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.push('error', data.error || 'Could not switch this thread to Work.');
        return;
      }
      toast.push('success', 'Switched to Work. Planning run started.');
      router.push(`/work/${activeTask.id}`);
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Network error.');
    }
  };

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const turns = useMemo(() => {
    const rows = messages.map((m) => ({
      key: `m${m.id}`,
      role: m.role,
      content: m.content.replace(/^<user_task>\n?/, '').replace(/\n?<\/user_task>$/, '').replace(/^Task:\n/, ''),
    }));
    if (isStreaming && runAnswer) {
      rows.push({ key: 'streaming', role: 'assistant' as const, content: runAnswer });
    }
    return rows;
  }, [messages, isStreaming, runAnswer]);

  return (
    <div className="flex h-full min-h-0">
      {/* ── Thread list ── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line-subtle md:flex">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line-subtle px-3">
          <Link href="/chat" className="inline-flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.16em] text-content-muted hover:text-content-primary">
            <IconArrowLeft size={12} /> Workspace
          </Link>
          <Link href="/chat">
            <IconButton label="New chat" size="sm">
              <span aria-hidden="true" className="inline-flex leading-none"><IconPlus size={13} /></span>
            </IconButton>
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {threads.length === 0 && (
            <p className="px-2.5 py-6 text-meta leading-5 text-content-muted">
              No conversations yet. Ask something below.
            </p>
          )}
          {threads.map((thread) => {
            const active = thread.id === activeTask?.id;
            return (
              <Link
                key={thread.id}
                href={`/chat/${thread.id}`}
                className={cx(
                  'mb-0.5 block rounded-control px-2.5 py-2 transition',
                  active ? 'bg-ink-600 text-content-primary' : 'text-content-muted hover:bg-ink-700 hover:text-content-secondary',
                )}
              >
                <span className="block truncate text-ui leading-5">{thread.goal}</span>
              </Link>
            );
          })}
        </div>
      </aside>

      {/* ── Conversation ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
            {turns.length === 0 ? (
              <div className="pt-[12vh]">
                <EmptyState
                  icon={<span aria-hidden="true" className="inline-flex text-title text-signal-run"><IconSparkles size={22} /></span>}
                  title="Ask anything"
                  description="Chat is read-only conversation. It never writes files, runs commands, or creates a plan. Switch a thread to Work when you want the agent to act."
                />
                <div className="mt-2 grid gap-2">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => { setDraft(starter); composerRef.current?.focus(); }}
                      className="rounded-control border border-line-subtle bg-ink-700/60 px-3.5 py-2.5 text-left text-ui leading-5 text-content-secondary transition hover:border-signal-run/20 hover:bg-signal-run/04 hover:text-content-primary"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {shownThinking && <ThinkingBlock text={shownThinking} live={isStreaming} />}

                {turns.map((turn) =>
                  turn.role === 'user' ? (
                    <div key={turn.key} className="flex justify-end">
                      <div dir="auto" className="max-w-[85%] rounded-modal rounded-br-md bg-signal-run/1 px-3.5 py-2.5 text-body leading-6 text-cyan-50">
                        <p className="whitespace-pre-wrap">{turn.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div key={turn.key} className="flex justify-start">
                      <div
                        dir="auto"
                        className="markdown-content max-w-[92%] text-body leading-6 text-content-secondary"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.content) }}
                      />
                    </div>
                  ),
                )}
                {isStreaming && !runAnswer && (
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

            {error && (
              <div className="mt-5">
                <Alert tone="error" title="Chat could not continue">{error}</Alert>
              </div>
            )}

            {isStreaming && streamLost && (
              <p role="status" className="mt-4 text-micro text-content-muted">
                Live connection interrupted — still reconciling with the saved task state. The answer is not lost.
              </p>
            )}
          </div>
        </div>

        {/* ── Composer ── */}
        <div className="shrink-0 border-t border-line-subtle bg-ink-900/60 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <div className="rounded-panel border border-line bg-ink-900/70 transition focus-within:border-signal-run/40 focus-within:ring-4 focus-within:ring-cyan-300/[0.07]">
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKey}
                rows={1}
                autoFocus
                placeholder="Ask a question…"
                aria-label="Message"
                className="block max-h-[200px] w-full resize-none bg-transparent px-3.5 py-3 text-body leading-6 text-content-primary outline-none placeholder:text-content-muted"
              />
              <div className="flex items-center justify-between gap-3 px-3 pb-2.5">
                <span className="inline-flex items-center gap-1.5 text-micro text-content-muted">
                  <KeyHint keys={['Enter']} /> send
                  <span className="mx-0.5 text-content-faint">·</span>
                  <KeyHint keys={['Shift', 'Enter']} /> newline
                </span>
                <div className="flex items-center gap-2">
                  {activeTask && !isStreaming && (
                    <Button variant="ghost" size="sm" onClick={promoteToWork} className="inline-flex items-center gap-1.5">
                      Switch to Work <IconArrowRight size={13} />
                    </Button>
                  )}
                  {activeTask && isStreaming && (
                    <Button variant="ghost" size="sm" onClick={() => void stopRun()} className="inline-flex items-center gap-1.5">
                      <IconSquare size={11} /> Stop
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={send}
                    loading={sending}
                    disabled={!draft.trim() || isStreaming}
                  >
                    Send
                  </Button>
                </div>
              </div>
            </div>
            <p className="mt-2 text-center text-micro text-content-muted">
              Chat never writes files or runs commands.
              <span className="mx-1.5 text-content-faint">·</span>
              <KeyHint keys={[mod, 'K']} /> for commands
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
