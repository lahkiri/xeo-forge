'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Message, Task, TaskEvent, TaskStatus } from '@/lib/types';
import { parseEvents, splitRuns, type ParsedEvent } from '@/lib/agent/timeline';
import { deriveChatRuntime, formatElapsed } from '@/lib/agent/runtime-state';
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
  }, [messages, currentRunText]);

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
      const summary = typeof event.data.summary === 'string' ? event.data.summary : '';
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
  }, [activeTask?.id]);

  useEffect(() => {
    if (!activeTask || status === 'completed' || status === 'failed') return;
    const source = new EventSource(`/api/tasks/${activeTask.id}/stream`);
    // Subscriptions come from the shared registry, never a local literal.
    const types = eventTypesFor('chat');
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
  }, [activeTask, status, addEvent]);

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
    if (isStreaming && currentRunText) {
      rows.push({ key: 'streaming', role: 'assistant' as const, content: currentRunText });
    }
    return rows;
  }, [messages, isStreaming, currentRunText]);

  return (
    <div className="flex h-screen min-h-0">
      {/* ── Thread list ── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line-subtle md:flex">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line-subtle px-3">
          <span className="text-micro font-semibold uppercase tracking-[0.16em] text-content-muted">
            Conversations
          </span>
          <Link href="/chat">
            <IconButton label="New chat" size="sm">
              <span aria-hidden="true" className="text-ui leading-none">+</span>
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
                  icon={<span aria-hidden="true" className="text-title">✦</span>}
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
                {turns.map((turn) =>
                  turn.role === 'user' ? (
                    <div key={turn.key} className="flex justify-end">
                      <div className="max-w-[85%] rounded-modal rounded-br-md bg-signal-run/1 px-3.5 py-2.5 text-body leading-6 text-cyan-50">
                        <p className="whitespace-pre-wrap">{turn.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div key={turn.key} className="flex justify-start">
                      <div
                        className="markdown-content max-w-[92%] text-body leading-6 text-content-secondary"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.content) }}
                      />
                    </div>
                  ),
                )}
                {isStreaming && !currentRunText && (
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
                    <Button variant="ghost" size="sm" onClick={promoteToWork}>
                      Switch to Work →
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
