'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Button, StatusBadge } from '@/components/ui';
import { UploadButton } from '@/components/UploadButton';
import { WorkspaceViewer } from '@/components/WorkspaceViewer';
import { PreviewPanel } from '@/components/PreviewPanel';
import { FileActivity } from '@/components/FileActivity';
import TaskContextPanel from './TaskContextPanel';
import type { Task, TaskEvent, TaskStatus, Message, Upload, UploadStatus } from '@/lib/types';

/* ── Event parsing ─────────────────────────────────────────────────── */

interface ParsedEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
  ts: number; // epoch ms — from DB created_at on replay, receipt time for live events
}

function parseEvents(events: TaskEvent[]): ParsedEvent[] {
  return events.map((e) => {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(e.content) as Record<string, unknown>; } catch { data = { raw: e.content }; }
    const ts = e.created_at ? Date.parse(e.created_at) : Date.now();
    return { seq: e.seq, type: e.type, data, ts: Number.isFinite(ts) ? ts : Date.now() };
  });
}

function formatClock(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ''; }
}

/* Short, human summary of a tool's input — execution visibility, not a black box. */
function summarizeArgs(name: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  const pick = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined);
  switch (name) {
    case 'file_read': case 'file_write': case 'file_edit': case 'file_list':
      return pick('path') ?? pick('dir') ?? '';
    case 'code_execute':
      return (pick('command') ?? pick('code') ?? '').slice(0, 60);
    case 'http_request':
      return [pick('method'), pick('url')].filter(Boolean).join(' ');
    case 'todo_update':
      return Array.isArray(a.items) ? `${(a.items as unknown[]).length} item(s)` : '';
    default: {
      const s = JSON.stringify(a);
      return s.length > 60 ? s.slice(0, 60) + '…' : s;
    }
  }
}

/* ── Simple markdown renderer (no deps) ────────────────────────────── */

function renderMarkdown(text: string): string {
  if (!text) return '';
  // Escape HTML entities FIRST to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Then apply markdown transformations
  html = html
    // code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
    // inline code
    .replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // line breaks
    .replace(/\n/g, '<br/>');
  // wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>(<br\/>)?)+/g, (m) => {
    return '<ul>' + m.replace(/<br\/>/g, '') + '</ul>';
  });
  return html;
}

/* ── Tool call display — every action visible, no black box ─────────── */

function ToolRow({ call, res }: { call: ParsedEvent; res?: ParsedEvent }) {
  const [open, setOpen] = useState(false);
  const name = String(call.data.name);
  const argSummary = summarizeArgs(name, call.data.args);
  const ok = res ? res.data.ok !== false : undefined;
  const hasResult = !!res;
  const resultText = res
    ? (res.data.ok === false
        ? String(res.data.error ?? 'failed')
        : String(res.data.result ?? ''))
    : '';
  const expandable = hasResult && resultText.length > 0;

  return (
    <div className="rounded-md border border-white/[0.05] bg-white/[0.015]">
      <button
        onClick={() => expandable && setOpen(!open)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${expandable ? 'hover:bg-white/[0.02]' : 'cursor-default'}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          ok === undefined ? 'bg-blue-400 animate-pulse' : ok ? 'bg-green-500/70' : 'bg-red-500/70'
        }`} />
        <span className="font-mono text-[11px] text-gray-300 shrink-0">{name}</span>
        {argSummary && (
          <span className="truncate font-mono text-[11px] text-gray-500">{argSummary}</span>
        )}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-[10px] tabular-nums text-gray-600">{formatClock(call.ts)}</span>
          {ok !== undefined && (
            <span className={`text-[10px] ${ok ? 'text-green-500/70' : 'text-red-500/70'}`}>
              {ok ? '✓' : '✗'}
            </span>
          )}
          {expandable && (
            <svg className={`h-3 w-3 text-gray-600 transition-transform ${open ? 'rotate-90' : ''}`}
                 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          )}
        </span>
      </button>
      {open && expandable && (
        <div className={`border-t border-white/[0.05] px-2.5 py-1.5 ${ok ? '' : 'bg-red-500/[0.03]'}`}>
          <pre className={`whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed max-h-48 overflow-y-auto ${ok ? 'text-gray-500' : 'text-red-400/80'}`}>
            {resultText.length > 2000 ? resultText.slice(0, 2000) + '\n…' : resultText}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolCalls({ events }: { events: ParsedEvent[] }) {
  const [open, setOpen] = useState(false);
  if (!events.length) return null;

  const calls = events.filter((e) => e.type === 'tool_call');
  const results = events.filter((e) => e.type === 'tool_result');
  if (!calls.length) return null;
  // Pair each call to the next result for the same tool name occurring after it.
  const usedResultSeqs = new Set<number>();
  const pairFor = (call: ParsedEvent): ParsedEvent | undefined => {
    const r = results.find(
      (res) => res.seq > call.seq && !usedResultSeqs.has(res.seq) &&
        String(res.data.name) === String(call.data.name),
    );
    if (r) usedResultSeqs.add(r.seq);
    return r;
  };
  const okCount = results.filter((r) => r.data.ok !== false).length;
  const failCount = results.filter((r) => r.data.ok === false).length;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        <svg
          className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {calls.length} tool {calls.length === 1 ? 'call' : 'calls'}
        {okCount > 0 && <span className="text-green-500/50">· {okCount} ok</span>}
        {failCount > 0 && <span className="text-red-500/50">· {failCount} failed</span>}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {calls.map((call) => (
            <ToolRow key={call.seq} call={call} res={pairFor(call)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Context indicator (tiny, top-right) ───────────────────────────── */

function ContextIndicator({
  pct, tokens, window,
}: { pct: number | null; tokens: number; window: number }) {
  if (pct === null) return null;
  const color = pct >= 90 ? 'text-red-400' : pct >= 70 ? 'text-amber-400' : 'text-gray-500';
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={color}>{Math.round(pct)}%</span>
      <div className="w-16 h-1 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-gray-600'
          }`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

/* ── Upload status helpers ─────────────────────────────────────────── */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const UPLOAD_STATUS_STYLE: Record<UploadStatus, string> = {
  quarantined: 'bg-white/5 text-gray-400',
  validating: 'bg-blue-500/15 text-blue-400',
  extracting: 'bg-blue-500/15 text-blue-400',
  ready: 'bg-green-500/15 text-green-400',
  rejected: 'bg-red-500/15 text-red-400',
};

function UploadChip({ upload }: { upload: Upload }) {
  const inProgress = upload.status === 'validating' || upload.status === 'extracting' || upload.status === 'quarantined';
  const detail = upload.status === 'ready'
    ? (upload.kind === 'archive'
        ? `${upload.file_count} file${upload.file_count === 1 ? '' : 's'} · ${formatBytes(upload.extracted_bytes)}`
        : formatBytes(upload.byte_size))
    : upload.status === 'rejected'
      ? (upload.error || 'rejected')
      : upload.status;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <svg className="h-3.5 w-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
      </svg>
      <span className="text-xs text-gray-300 truncate max-w-[12rem]">{upload.filename}</span>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${UPLOAD_STATUS_STYLE[upload.status]}`}>
        {inProgress && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
        {upload.status === 'ready' || upload.status === 'rejected' ? upload.status : `${upload.status}…`}
      </span>
      <span className="text-[10px] text-gray-500 truncate">{detail}</span>
    </div>
  );
}

/* ── Plan → Execute → Verify phase indicator ───────────────────────────
   PURELY VISUAL. Derived from existing task state + SSE events. Drives no
   logic and introduces no execution flow — if removed, the system is
   unchanged. It only reflects the phase the agent loop is already in. */

type Phase = 'plan' | 'execute' | 'verify' | 'done';

function PhaseIndicator({ phase }: { phase: Phase }) {
  const steps: { key: Phase; label: string }[] = [
    { key: 'plan', label: 'Plan' },
    { key: 'execute', label: 'Execute' },
    { key: 'verify', label: 'Verify' },
  ];
  const order: Record<Phase, number> = { plan: 0, execute: 1, verify: 2, done: 3 };
  const cur = order[phase];
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {steps.map((s, i) => {
        const state = i < cur ? 'done' : i === cur ? 'active' : 'pending';
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium tracking-wide transition ${
              state === 'active' ? 'bg-indigo-500/15 text-indigo-300' :
              state === 'done' ? 'bg-green-500/10 text-green-400/70' :
              'bg-white/[0.03] text-gray-600'
            }`}>
              {state === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />}
              {state === 'done' && (
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span className={`h-px w-4 ${i < cur ? 'bg-green-500/30' : 'bg-white/10'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────── */

export default function TaskClient({
  initialTask,
  initialEvents,
  initialMessages,
  initialUploads,
}: {
  initialTask: Task;
  initialEvents: TaskEvent[];
  initialMessages: Message[];
  initialUploads: Upload[];
}) {
  const [status, setStatus] = useState<TaskStatus>(initialTask.status);
  const [proposedPlan, setProposedPlan] = useState<string | null>(initialTask.plan);
  const [events, setEvents] = useState<ParsedEvent[]>(() => parseEvents(initialEvents));
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [creditsSpent, setCreditsSpent] = useState(initialTask.credits_spent);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [decisionSeconds, setDecisionSeconds] = useState(() => {
    if (!initialTask.decision_expires_at) return 0;
    return Math.max(0, Math.ceil((Date.parse(initialTask.decision_expires_at) - Date.now()) / 1000));
  });
  const [followUp, setFollowUp] = useState('');
  const [sending, setSending] = useState(false);
  const [contextPct, setContextPct] = useState<number | null>(null);
  const [contextWindow, setContextWindow] = useState<number>(0);
  const [contextTokens, setContextTokens] = useState<number>(0);
  const [compactionNotice, setCompactionNotice] = useState<{ before: number; after: number } | null>(null);
  const [expandedReasoning, setExpandedReasoning] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>(initialUploads);
  const [todoItems, setTodoItems] = useState<{id:string;description:string;status:string}[]>([]);
  const [verification, setVerification] = useState<{status:string;message?:string;attempt?:number} | null>(null);
  const [tab, setTab] = useState<'timeline' | 'workspace' | 'preview' | 'context'>('timeline');
  const [fileActivities, setFileActivities] = useState<{data: Record<string, unknown>; ts: number}[]>([]);

  const seenSeq = useRef<Set<number>>(new Set(initialEvents.map((e) => e.seq)));
  const maxSeqRef = useRef<number>(initialEvents.reduce((m, e) => Math.max(m, e.seq), 0));
  const esRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Track whether user is near bottom for auto-scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    autoScrollRef.current = nearBottom;
  }, []);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [events, messages]);

  const addEvent = useCallback((ev: ParsedEvent) => {
    if (seenSeq.current.has(ev.seq)) return;
    seenSeq.current.add(ev.seq);
    if (ev.seq > maxSeqRef.current) maxSeqRef.current = ev.seq;
    setEvents((prev) => [...prev, ev].sort((a, b) => a.seq - b.seq));

    if (ev.type === 'task_status' && typeof ev.data.status === 'string') {
      const s = ev.data.status as TaskStatus;
      if (s !== 'completed' && s !== 'failed') setStatus(s);
    } else if (ev.type === 'done' && typeof ev.data.status === 'string') {
      setStatus(ev.data.status as TaskStatus);
      if (typeof ev.data.summary === 'string' && ev.data.summary) {
        const assistantMsg: Message = {
          id: Date.now(), task_id: initialTask.id, role: 'assistant',
          content: ev.data.summary, active: 1, created_at: new Date().toISOString(),
        };
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.content === ev.data.summary) return prev;
          return [...prev, assistantMsg];
        });
      }
    } else if (ev.type === 'credits' && typeof ev.data.spent === 'number') {
      setCreditsSpent(ev.data.spent);
    } else if (ev.type === 'plan' && typeof ev.data.plan === 'string') {
      setProposedPlan(ev.data.plan);
    } else if (ev.type === 'context' && typeof ev.data.percentage === 'number') {
      setContextPct(ev.data.percentage);
      if (typeof ev.data.context_window === 'number') setContextWindow(ev.data.context_window);
      if (typeof ev.data.used_tokens === 'number') setContextTokens(ev.data.used_tokens);
    } else if (ev.type === 'compaction') {
      setCompactionNotice({
        before: typeof ev.data.before_percentage === 'number' ? ev.data.before_percentage : 0,
        after: typeof ev.data.after_percentage === 'number' ? ev.data.after_percentage : 0,
      });
    } else if (ev.type === 'upload' && typeof ev.data.upload_id === 'string') {
      const uid = ev.data.upload_id as string;
      setUploads((prev) => prev.map((u) => u.id === uid ? {
        ...u,
        status: (typeof ev.data.status === 'string' ? ev.data.status : u.status) as UploadStatus,
        file_count: typeof ev.data.file_count === 'number' ? ev.data.file_count : u.file_count,
        extracted_bytes: typeof ev.data.extracted_bytes === 'number' ? ev.data.extracted_bytes : u.extracted_bytes,
        error: typeof ev.data.error === 'string' ? ev.data.error : u.error,
      } : u));
    } else if (ev.type === 'todo_update' && Array.isArray(ev.data.items)) {
      setTodoItems(ev.data.items as {id:string;description:string;status:string}[]);
    } else if (ev.type === 'verification' && typeof ev.data.status === 'string') {
      setVerification({
        status: ev.data.status,
        message: typeof ev.data.message === 'string' ? ev.data.message : undefined,
        attempt: typeof ev.data.attempt === 'number' ? ev.data.attempt : undefined,
      });
    } else if (ev.type === 'file_activity') {
      setFileActivities((prev) => [...prev.slice(-49), { data: ev.data, ts: ev.ts }]);
    }
  }, []);

  // SSE lifecycle
  useEffect(() => {
    if (status === 'completed' || status === 'failed') return;
    const es = new EventSource(`/api/tasks/${initialTask.id}/stream`);
    esRef.current = es;
    const types = ['task_status','mode','intent','plan','text','reasoning','tool_call','tool_result','credits','context','compaction','model_retry','error','done','upload','todo_update','verification','file_activity'];
    const handler = (e: MessageEvent) => {
      const seq = Number(e.lastEventId);
      if (!Number.isFinite(seq)) return;
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(e.data); } catch { data = { raw: e.data }; }
      addEvent({ seq, type: e.type, data, ts: Date.now() });
    };
    types.forEach((t) => es.addEventListener(t, handler as EventListener));
    es.onerror = () => {};
    return () => { types.forEach((t) => es.removeEventListener(t, handler as EventListener)); es.close(); esRef.current = null; };
  }, [initialTask.id, status]);

  // The countdown is presentation only. The API enforces the same deadline and
  // performs the conditional transition, so a late click can never execute.
  useEffect(() => {
    if (status !== 'awaiting_decision' || !initialTask.decision_expires_at) return;
    const tick = () => setDecisionSeconds(Math.max(0, Math.ceil((Date.parse(initialTask.decision_expires_at as string) - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [status, initialTask.decision_expires_at]);

  // ── Handlers ──

  async function handleDecision(choice: 'direct' | 'plan') {
    if (decisionBusy || decisionSeconds <= 0) return;
    setDecisionBusy(true);
    setDecisionError('');
    try {
      const res = await fetch(`/api/tasks/${initialTask.id}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDecisionError(data.error || 'This decision could not be applied.');
        if (data.task?.decision_state === 'expired') setDecisionSeconds(0);
        return;
      }
      setStatus(data.task?.status === 'pending' ? 'pending' : 'running');
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setDecisionBusy(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    try {
      const res = await fetch(`/api/tasks/${initialTask.id}/approve`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); alert(d.error || 'Approval failed'); }
    } catch (err) { alert(err instanceof Error ? err.message : 'Network error'); }
    finally { setApproving(false); }
  }

  async function handleReject() {
    setRejecting(true);
    try {
      const res = await fetch(`/api/tasks/${initialTask.id}/reject`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Plan rejected — returning to planning mode for revision.' }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || 'Reject failed'); }
    } catch (err) { alert(err instanceof Error ? err.message : 'Network error'); }
    finally { setRejecting(false); }
  }

  async function handleFollowUp(e: React.FormEvent) {
    e.preventDefault();
    if (!followUp.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tasks/${initialTask.id}/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: followUp.trim() }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed to send message'); }
      else {
        setFollowUp('');
        setMessages((prev) => [...prev, {
          id: Date.now(), task_id: initialTask.id, role: 'user',
          content: followUp.trim(), active: 1, created_at: new Date().toISOString(),
        }]);
        setStatus('pending');
      }
    } catch (err) { alert(err instanceof Error ? err.message : 'Network error'); }
    finally { setSending(false); }
  }

  function mergeUpload(upload: Upload) {
    // Merge a returned upload (covers terminal tasks where SSE is closed)
    setUploads((prev) => {
      const exists = prev.some((u) => u.id === upload.id);
      return exists ? prev.map((u) => u.id === upload.id ? upload : u) : [...prev, upload];
    });
  }

  // ── Derived state ──

  const isTerminal = status === 'completed' || status === 'failed';
  const isChat = initialTask.mode === 'chat';
  const awaitingDecision = status === 'awaiting_decision' && initialTask.decision_state === 'pending' && decisionSeconds > 0;
  const decisionExpired = status === 'awaiting_decision' && decisionSeconds <= 0;
  const isPlanned = !isChat && status === 'planned';
  const isRunning = status === 'running' || status === 'pending';
  const canFollowUp = isTerminal;

  // Split events by run boundary
  const doneSeqs = events.filter((e) => e.type === 'done').map((e) => e.seq);
  const lastDoneSeq = doneSeqs.length > 0 ? Math.max(...doneSeqs) : 0;
  const currentRunEvents = events.filter((e) => e.seq > lastDoneSeq);
  const currentRunText = currentRunEvents
    .filter((e) => e.type === 'text')
    .map((e) => (typeof e.data.delta === 'string' ? e.data.delta : ''))
    .join('');
  const currentRunToolEvents = currentRunEvents.filter(
    (e) => e.type === 'tool_call' || e.type === 'tool_result',
  );

  // Run-indexed tool events for completed runs
  const doneEvents = events.filter((e) => e.type === 'done');
  const runToolEvents: ParsedEvent[][] = [];
  { let prevSeq = 0;
    for (const de of doneEvents) {
      runToolEvents.push(events.filter(
        (e) => (e.type === 'tool_call' || e.type === 'tool_result') && e.seq > prevSeq && e.seq <= de.seq,
      ));
      prevSeq = de.seq;
    }
  }

  // Build timeline
  let assistantIdx = 0;
  const timeline = useMemo(() => {
    // Older threads may have been created before the API persisted the opening
    // turn. Keep them readable instead of rendering an apparently empty chat.
    const sourceMessages = messages.length > 0
      ? messages
      : [{ id: -2, role: 'user' as const, content: initialTask.goal }];
    const turns = sourceMessages.map((msg, i) => {
      let content = msg.content;
      // Strip <user_task> framing tags (added by agent loop for LLM safety)
      content = content.replace(/^<user_task>\n?/, '').replace(/\n?<\/user_task>$/, '');
      // Strip Task: prefix from first message
      if (i === 0 && content.startsWith('Task:\n')) content = content.slice(6);
      return {
        id: msg.id,
        role: msg.role as 'user' | 'assistant' | 'system',
        content,
        toolEvents: undefined as ParsedEvent[] | undefined,
      };
    });
    let aIdx = 0;
    for (const turn of turns) {
      if (turn.role === 'assistant') {
        if (aIdx < runToolEvents.length && runToolEvents[aIdx].length > 0) {
          turn.toolEvents = runToolEvents[aIdx];
        }
        aIdx++;
      }
    }
    return turns;
  }, [messages, runToolEvents, initialTask.goal]);

  // Append streaming assistant turn
  if (isRunning && (currentRunText || currentRunToolEvents.length > 0)) {
    timeline.push({
      id: -1, role: 'assistant', content: currentRunText,
      toolEvents: currentRunToolEvents.length > 0 ? currentRunToolEvents : undefined,
    });
  }

  const errorEvent = [...events].reverse().find((e) => e.type === 'error');
  const errorMessage = errorEvent ? String(errorEvent.data.message ?? 'An error occurred') : '';
  const normalizedError = errorMessage.toLowerCase();
  const modelRetryEvent = [...events].reverse().find((e) => e.type === 'model_retry');
  const rateLimitError = normalizedError.includes('429') || normalizedError.includes('rate-limit') || normalizedError.includes('rate limit');
  const modelAuthError = normalizedError.includes('401') || normalizedError.includes('403') || normalizedError.includes('api key') || normalizedError.includes('authentication');
  const modelSetupError = normalizedError.includes('no global model') || normalizedError.includes('model is not configured');

  // Derive Plan→Execute→Verify phase PURELY from existing state/events (visual only).
  const hasCurrentToolActivity = currentRunToolEvents.length > 0;
  const verificationInCurrentRun = currentRunEvents.some((e) => e.type === 'verification');
  const phase: Phase = (() => {
    if (isTerminal) return 'done';
    if (isPlanned) return 'plan';
    // Running — derive from actual activity
    if (verificationInCurrentRun) return 'verify';
    if (hasCurrentToolActivity) return 'execute';
    return 'plan';
  })();
  const showPhase = !isChat && (isRunning || isTerminal) && timeline.length > 0;

  const reasoningDeltas = events
    .filter((e) => e.type === 'reasoning')
    .map((e) => (typeof e.data.delta === 'string' ? e.data.delta : ''))
    .join('');

  // ── Render ──

  return (
    <div className="app-shell flex h-screen flex-col text-gray-100">
      {/* ── Header ── */}
      <header className="border-b border-white/[0.1] bg-[#0c1320]/92 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-300 transition-colors shrink-0">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="brand-mark h-7 w-7 rounded-lg" aria-hidden="true"><span /></span>
              <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-300/80">XEO FORGE</span>
              <span className="text-gray-700">/</span>
              <span className="text-sm font-semibold text-white truncate max-w-[55vw] sm:max-w-xs">{initialTask.goal}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-600">
              <span className={`rounded-full border px-2 py-0.5 ${isChat ? 'border-cyan-300/15 bg-cyan-300/[0.05] text-cyan-200/80' : 'border-violet-300/15 bg-violet-300/[0.05] text-violet-200/80'}`}>{isChat ? 'conversation' : 'governed task'}</span>
              {initialTask.project_path && <span className="max-w-[20rem] truncate rounded-full border border-white/[0.07] px-2 py-0.5 text-gray-500" title={initialTask.project_path}>{initialTask.project_path}</span>}
              {initialTask.skill_id && <span className="rounded-full border border-cyan-400/15 bg-cyan-400/[0.04] px-2 py-0.5 text-cyan-300/80">workflow active</span>}
              {initialTask.profile_id && <span className="rounded-full border border-violet-400/15 bg-violet-400/[0.04] px-2 py-0.5 text-violet-300/80">role active</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 ml-auto">
          {!isChat && <ContextIndicator pct={contextPct} tokens={contextTokens} window={contextWindow} />}
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
            status === 'running' ? 'bg-blue-500/15 text-blue-400' :
            status === 'completed' ? 'bg-green-500/15 text-green-400' :
            status === 'failed' ? (isChat ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-400') :
            status === 'planned' ? 'bg-amber-500/15 text-amber-400' :
            status === 'awaiting_decision' ? 'bg-violet-500/15 text-violet-300' :
            'bg-white/5 text-gray-400'
          }`}>
            {status === 'running' && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />}
            {isChat && status === 'failed' ? 'needs setup' : status === 'awaiting_decision' ? 'needs your choice' : status}
          </span>
          {isTerminal && (
            <a href={`/api/tasks/${initialTask.id}/export`}
               className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors">
              export
            </a>
          )}
        </div>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <div className="flex items-center gap-1 border-b border-white/[0.07] bg-black/10 px-4 sm:px-6" role="tablist" aria-label="Task surfaces">
        {(['timeline', 'workspace', 'preview', 'context'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
              className={`relative rounded-t-lg px-3 py-2.5 text-[11px] font-semibold transition-colors ${
                tab === t ? 'bg-white/[0.04] text-cyan-100' : 'text-gray-500 hover:bg-white/[0.03] hover:text-gray-300'
              }`}
          >
            {t === 'timeline' ? 'Activity' : t === 'workspace' ? 'Project' : t === 'preview' ? 'Preview' : 'Context'}
            {tab === t && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.7)]" />
            )}
          </button>
        ))}
      </div>

      {/* ── Scrollable content ── */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-6">
        {tab === 'timeline' && (
        <div className="mx-auto max-w-2xl space-y-4">

          {/* Plan → Execute → Verify phase (visual state derived from existing events) */}
          {showPhase && (
            <div className="flex justify-center">
              <PhaseIndicator phase={phase} />
            </div>
          )}

          {/* Direct-vs-plan decision gate */}
          {awaitingDecision && (
            <div className="rounded-2xl border border-violet-300/20 bg-violet-300/[0.06] p-4 shadow-xl shadow-violet-950/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200/75">Choose how Work should proceed</p>
                  <p className="mt-1.5 max-w-xl text-sm leading-6 text-gray-300">This request sounds like a direct action. Would you like Xeo to plan it first, or execute the requested scope directly?</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] tabular-nums ${decisionSeconds <= 5 ? 'border-amber-300/30 bg-amber-300/[0.1] text-amber-200' : 'border-white/10 bg-black/20 text-gray-400'}`}>{decisionSeconds}s</span>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => handleDecision('direct')} disabled={decisionBusy || decisionSeconds <= 0} className="rounded-xl bg-cyan-300 px-3 py-2.5 text-xs font-bold text-[#071018] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">{decisionBusy ? 'Applying…' : 'Execute directly'}</button>
                <button type="button" onClick={() => handleDecision('plan')} disabled={decisionBusy || decisionSeconds <= 0} className="rounded-xl border border-violet-200/20 bg-white/[0.04] px-3 py-2.5 text-xs font-semibold text-violet-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40">Plan first</button>
              </div>
              {decisionError && <p className="mt-3 rounded-xl border border-red-300/15 bg-red-400/[0.08] px-3 py-2 text-[11px] text-red-200">{decisionError}</p>}
            </div>
          )}
          {decisionExpired && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-center">
              <p className="text-xs font-semibold text-gray-300">Decision window closed</p>
              <p className="mt-1 text-[11px] leading-5 text-gray-500">Nothing ran. Start a new Work request if you still want to continue.</p>
              <Link href="/dashboard" className="mt-3 inline-flex rounded-xl border border-cyan-300/20 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/[0.08]">New Work request</Link>
            </div>
          )}

          {/* Compaction notice */}
          {compactionNotice && (
            <div className="flex justify-center">
              <span className="text-[10px] text-gray-500 bg-white/[0.03] rounded-full px-3 py-1">
                context compacted {compactionNotice.before}% → {compactionNotice.after}%
              </span>
            </div>
          )}

          {/* Uploaded files (untrusted data, surfaced inline) */}
          {uploads.length > 0 && (
            <div className="space-y-1.5">
              {uploads.map((u) => <UploadChip key={u.id} upload={u} />)}
            </div>
          )}

          {/* ── Live file activity ── */}
          <FileActivity events={fileActivities} isRunning={isRunning} />

          {/* ── Todo checklist ── */}
          {todoItems.length > 0 && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] uppercase tracking-widest text-gray-500">progress</span>
                <span className="text-[10px] text-gray-600">
                  {todoItems.filter((i) => i.status === 'done').length}/{todoItems.length}
                </span>
              </div>
              <div className="space-y-1">
                {todoItems.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
                    <span className={`mt-0.5 h-3 w-3 shrink-0 rounded-sm border flex items-center justify-center ${
                      item.status === 'done' ? 'bg-green-500/20 border-green-500/40' :
                      item.status === 'in_progress' ? 'bg-blue-500/20 border-blue-500/40' :
                      'border-white/10'
                    }`}>
                      {item.status === 'done' && (
                        <svg className="h-2 w-2 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {item.status === 'in_progress' && (
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                      )}
                    </span>
                    <span className={
                      item.status === 'done' ? 'text-gray-500 line-through' :
                      item.status === 'in_progress' ? 'text-gray-300' :
                      'text-gray-400'
                    }>
                      {item.description}
                    </span>
                  </div>
                ))}
              </div>
              {verification && (
                <div className={`mt-2 text-[10px] ${
                  verification.status === 'pass' ? 'text-green-400/70' :
                  'text-red-400/70'
                }`}>
                  {verification.status === 'pass' && `✓ verified: ${verification.message || 'all checks passed'}`}
                  {verification.status === 'fail' && verification.message && `✗ ${verification.message}`}
                </div>
              )}
            </div>
          )}

          {/* ── Chat timeline ── */}
          {timeline.map((turn) => (
            <div key={turn.id} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${turn.role === 'user' ? 'order-1' : ''}`}>
                {/* System messages (compaction summaries) */}
                {turn.role === 'system' ? (
                  <div className="mx-auto max-w-md text-center">
                    <span className="inline-block text-[10px] uppercase tracking-widest text-gray-600 bg-white/[0.03] rounded-full px-3 py-1">
                      context summary
                    </span>
                    <p className="mt-1 text-[11px] text-gray-600 leading-relaxed">
                      {turn.content.length > 200 ? turn.content.slice(0, 200) + '…' : turn.content}
                    </p>
                  </div>
                ) : turn.role === 'user' ? (
                  /* ── User bubble ── */
                  <div className="rounded-2xl rounded-br-md bg-indigo-500/15 px-4 py-2.5 text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                    {turn.content}
                  </div>
                ) : (
                  /* ── Assistant bubble ── */
                  <div>
                    <div className="rounded-2xl rounded-bl-md bg-white/[0.04] px-4 py-3 text-sm text-gray-300 leading-relaxed">
                      {turn.id === -1 && !turn.content && (
                        <span className="inline-flex items-center gap-1.5 text-gray-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-gray-500 animate-pulse" />
                          thinking…
                        </span>
                      )}
                      <div
                        className="markdown-content"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.content) }}
                      />
                       {turn.toolEvents && turn.toolEvents.length > 0 && (
                        <ToolCalls events={turn.toolEvents} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Running indicator */}
          {isRunning && timeline.length === 0 && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-white/[0.04] px-4 py-3 text-sm text-gray-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-500 animate-pulse" />
                  thinking…
                </span>
              </div>
            </div>
          )}

          {/* Planned indicator */}
          {isPlanned && !proposedPlan && (
            <div className="flex justify-center">
              <span className="text-[10px] uppercase tracking-widest text-amber-500/60">planning complete</span>
            </div>
          )}

          {/* Reasoning (collapsed) */}
          {reasoningDeltas && (
            <div className="flex justify-start">
              <details className="group">
                <summary className="cursor-pointer text-[11px] text-gray-600 hover:text-gray-400 transition-colors">
                  reasoning
                </summary>
                <div className="mt-1 rounded-lg bg-white/[0.02] px-3 py-2 text-[11px] text-gray-600 leading-relaxed max-h-48 overflow-y-auto">
                  {reasoningDeltas}
                </div>
              </details>
            </div>
          )}

          {modelRetryEvent && isRunning && (
            <div className="flex justify-start">
              <div className="max-w-xl rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] px-4 py-3 text-cyan-100/80">
                <div className="flex items-center gap-2 text-xs font-medium text-cyan-200">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
                  Reconnecting to the model provider
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-cyan-100/65">
                  {String(modelRetryEvent.data.message ?? 'Retrying the model request…')} This does not create a duplicate task.
                </p>
              </div>
            </div>
          )}

          {/* Error — inline in timeline, with recovery hint, never breaks flow */}
          {errorEvent && (
            <div className="flex justify-start">
                  <div className={`max-w-xl rounded-xl border px-4 py-3 ${rateLimitError ? 'border-cyan-400/20 bg-cyan-400/[0.07]' : (modelSetupError || modelAuthError) && isChat ? 'border-amber-400/20 bg-amber-400/[0.07]' : 'border-red-500/20 bg-red-500/[0.07]'}`}>
                <div className={`flex items-center gap-2 text-xs font-medium ${rateLimitError ? 'text-cyan-300' : (modelSetupError || modelAuthError) && isChat ? 'text-amber-300' : 'text-red-400'}`}>
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.33 16a2 2 0 001.74 3z" />
                  </svg>
                  {rateLimitError ? 'provider rate limit' : modelAuthError ? 'model key rejected' : modelSetupError && isChat ? 'chat setup required' : isChat ? 'chat unavailable' : 'execution error'}
                </div>
                <p className={`mt-1 text-[11px] leading-relaxed break-words ${rateLimitError ? 'text-cyan-100/80' : (modelSetupError || modelAuthError) && isChat ? 'text-amber-200/80' : 'text-red-400/80'}`}>
                  {modelSetupError && isChat
                    ? 'No AI model is configured for this local workspace. Configure a local or remote model, then send a message again.'
                    : modelAuthError
                      ? 'The provider rejected the stored API key. Open Settings → Local model, replace the key, test the connection, and save it.'
                      : rateLimitError
                        ? 'The provider is temporarily busy or the account quota is exhausted. Xeo already retried with backoff; wait briefly, check provider quota, or switch model/provider in Settings.'
                        : errorMessage}
                </p>
                {(rateLimitError || modelAuthError || (modelSetupError && isChat)) && <Link href="/settings" className="mt-3 inline-flex rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-2.5 py-1.5 text-[10px] font-semibold text-cyan-100 transition hover:bg-cyan-300/[0.12]">Open Control Center →</Link>}
                {isTerminal && (
                  <p className="mt-1.5 text-[10px] text-gray-500">
                    {modelSetupError && isChat ? 'Your conversation is preserved. Configure the model, then continue below.' : rateLimitError ? 'Your conversation is preserved. Fix provider availability, then send a follow-up to retry.' : 'Send a follow-up message below to retry or adjust the task.'}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        )}

        {tab === 'workspace' && (
        <div className="mx-auto max-w-4xl">
          <WorkspaceViewer taskId={initialTask.id} />
        </div>
        )}

        {tab === 'preview' && (
        <div className="mx-auto max-w-4xl">
          <PreviewPanel taskId={initialTask.id} isTerminal={isTerminal} />
        </div>
        )}

        {tab === 'context' && (
        <TaskContextPanel taskId={initialTask.id} />
        )}
      </div>

      {/* ── Bottom bar: approval + conversation composer ── */}
      <div className="border-t border-white/[0.1] bg-[#0c1320]/96 px-4 py-4 backdrop-blur-xl sm:px-6">
        <div className="mx-auto max-w-3xl">
          {!isChat && isPlanned && proposedPlan && (
            <div className="mb-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200/70">Review before execution</p><p className="mt-1 text-xs text-gray-400">The agent prepared this plan. Approve it to let the build run begin.</p></div>
                <div className="flex gap-2">
                  <button onClick={handleApprove} disabled={approving || rejecting} className="rounded-xl bg-emerald-300/[0.12] px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-300/[0.2] disabled:opacity-50">{approving ? 'Approving…' : 'Approve plan'}</button>
                  <button onClick={handleReject} disabled={approving || rejecting} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs font-semibold text-gray-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50">{rejecting ? 'Revising…' : 'Ask for revision'}</button>
                </div>
              </div>
              <p className="mt-3 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-black/20 p-3 text-xs leading-5 text-gray-300">{proposedPlan}</p>
            </div>
          )}

          {canFollowUp ? (
            <form onSubmit={handleFollowUp} className="rounded-2xl border border-white/[0.11] bg-white/[0.035] p-2 shadow-2xl shadow-black/20 focus-within:border-cyan-300/30">
              <textarea rows={2} value={followUp} onChange={(e) => setFollowUp(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder={isChat ? 'Continue the conversation…' : 'Send a follow-up or adjustment…'} className="workbench-input w-full resize-none rounded-xl border-0 bg-transparent px-3 py-2 text-sm leading-6 text-gray-200 outline-none placeholder:text-gray-600" />
              <div className="flex items-center justify-between gap-3 px-1 pt-1"><UploadButton taskId={initialTask.id} onUploaded={mergeUpload} label="Attach" /><div className="flex items-center gap-3"><span className="hidden text-[10px] text-gray-600 sm:inline">Enter to send · Shift+Enter for a new line</span><button type="submit" disabled={sending || !followUp.trim()} className="rounded-xl bg-cyan-300 px-4 py-2 text-xs font-bold text-[#071018] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">{sending ? 'Sending…' : 'Send'}</button></div></div>
            </form>
          ) : isRunning ? (
            <div className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-xs text-gray-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />{isChat ? 'Xeo is composing a reply…' : 'Agent is working…'}</div>
          ) : (
            <div className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3"><span className="text-xs text-gray-600">Ready for your next move.</span><UploadButton taskId={initialTask.id} onUploaded={mergeUpload} label="Attach file" /></div>
          )}
        </div>
      </div>
    </div>
  );
}
