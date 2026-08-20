'use client';

import { useState } from 'react';
import { Badge, Button, cx } from './ui';
import type { ParsedEvent } from '@/lib/agent/timeline';

/* ------------------------------------------------------------------ */
/*  Tool ledger — the audit trail, rendered as an audit trail.         */
/*  Every action the agent took, in order, with args and result.       */
/* ------------------------------------------------------------------ */

const TOOL_META: Record<string, { label: string; tone: 'gray' | 'cyan' | 'amber' | 'violet' }> = {
  file_read: { label: 'read', tone: 'gray' },
  file_list: { label: 'list', tone: 'gray' },
  file_write: { label: 'write', tone: 'amber' },
  file_edit: { label: 'edit', tone: 'amber' },
  code_execute: { label: 'execute', tone: 'violet' },
  http_request: { label: 'request', tone: 'cyan' },
  browser: { label: 'browser', tone: 'cyan' },
  task_complete: { label: 'complete', tone: 'gray' },
};

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function summarizeArgs(name: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  if (typeof a.path === 'string') return a.path;
  if (typeof a.command === 'string') return a.command.slice(0, 90);
  if (typeof a.code === 'string') return a.code.split('\n')[0].slice(0, 90);
  if (typeof a.url === 'string') return a.url;
  if (typeof a.action === 'string') return a.action;
  if (typeof a.summary === 'string') return a.summary.slice(0, 90);
  return '';
}

export function ToolRow({ call, result }: { call: ParsedEvent; result?: ParsedEvent }) {
  const [open, setOpen] = useState(false);
  const name = String(call.data.name);
  const meta = TOOL_META[name] ?? { label: name, tone: 'gray' as const };
  const args = summarizeArgs(name, call.data.args);
  const ok = result ? result.data.ok !== false : undefined;
  const body = result
    ? result.data.ok === false
      ? String(result.data.error ?? 'failed')
      : String(result.data.result ?? '')
    : '';
  const expandable = body.length > 0;

  return (
    <div className="border-b border-white/[0.04] last:border-0">
      <button
        type="button"
        onClick={() => expandable && setOpen(!open)}
        aria-expanded={expandable ? open : undefined}
        className={cx(
          'flex w-full items-center gap-2 px-3 py-1.5 text-left transition',
          expandable ? 'hover:bg-ink-700/60' : 'cursor-default',
        )}
      >
        <span
          className={cx(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            ok === undefined ? 'animate-live-pulse bg-signal-run' : ok ? 'bg-signal-pass/80' : 'bg-signal-fail/80',
          )}
          aria-label={ok === undefined ? 'running' : ok ? 'succeeded' : 'failed'}
        />
        <Badge tone={meta.tone} className="shrink-0 font-mono">{meta.label}</Badge>
        {args && <span className="truncate font-mono text-meta text-content-muted">{args}</span>}
        <span className="ml-auto shrink-0 text-micro tabular-nums text-content-faint">{formatClock(call.ts)}</span>
        {expandable && (
          <span aria-hidden="true" className={cx('shrink-0 text-micro text-content-muted transition', open && 'rotate-90')}>
            ▶
          </span>
        )}
      </button>
      {open && (
        <pre className="max-h-56 overflow-auto border-t border-white/[0.04] bg-black/25 px-3 py-2 font-mono text-meta leading-5 text-content-secondary">
          {body.slice(0, 4000)}
          {body.length > 4000 && '\n…truncated'}
        </pre>
      )}
    </div>
  );
}

/** Pair tool_call events with their tool_result by order of appearance. */
export function pairToolEvents(events: ParsedEvent[]): { call: ParsedEvent; result?: ParsedEvent }[] {
  const calls = events.filter((e) => e.type === 'tool_call');
  const results = events.filter((e) => e.type === 'tool_result');
  return calls.map((call, index) => ({ call, result: results[index] }));
}

/* ── Plan review ──────────────────────────────────────────────────── */

/**
 * The approval gate is the product. It gets the whole pane, a readable plan,
 * and two unambiguous actions — not a pair of small buttons in a scroll.
 */
export function PlanReview({
  plan,
  busy,
  onApprove,
  onReject,
}: {
  plan: string;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-signal-gate/15 bg-signal-gate/06 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-meta font-semibold uppercase tracking-[0.16em] text-signal-gate/90">
              Plan awaiting your approval
            </p>
            <p className="mt-0.5 text-ui leading-5 text-content-secondary">
              Nothing has been written yet. Approving freezes this plan as an immutable contract.
            </p>
          </div>
          {!rejecting && (
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setRejecting(true)} disabled={busy}>
                Request changes
              </Button>
              <Button variant="success" size="sm" onClick={onApprove} loading={busy}>
                Approve and build
              </Button>
            </div>
          )}
        </div>

        {rejecting && (
          <div className="mt-3 rounded-control border border-line bg-black/25 p-3">
            <label htmlFor="reject-reason" className="mb-1.5 block text-meta font-medium text-content-secondary">
              What should change?
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Skip the migration step and keep the existing table name…"
              className="w-full resize-none rounded-control border border-line bg-ink-900/60 px-3 py-2 text-ui leading-5 text-content-primary outline-none focus:border-signal-run/40"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setRejecting(false); setReason(''); }}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => onReject(reason.trim())}
                disabled={!reason.trim()}
                loading={busy}
              >
                Send back for revision
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <pre className="whitespace-pre-wrap font-sans text-body leading-6 text-content-secondary">{plan}</pre>
      </div>
    </div>
  );
}

/* ── Decision gate ────────────────────────────────────────────────── */

/**
 * Direct execution vs. plan first. The server enforces the same deadline and
 * performs the conditional transition, so expiry here can never execute.
 */
export function DecisionGate({
  seconds,
  busy,
  onChoose,
}: {
  seconds: number;
  busy: boolean;
  onChoose: (choice: 'direct' | 'plan') => void;
}) {
  const urgent = seconds <= 10;
  return (
    <div className="border-b border-signal-plan/20 bg-signal-plan/07 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-meta font-semibold uppercase tracking-[0.16em] text-signal-plan/90">
              This request wants to change your project
            </p>
            <span
              className={cx(
                'rounded px-1.5 py-0.5 text-meta font-bold tabular-nums',
                urgent ? 'bg-signal-fail/20 text-signal-fail' : 'bg-ink-600 text-content-secondary',
              )}
            >
              {seconds}s
            </span>
          </div>
          <p className="mt-1 max-w-xl text-ui leading-5 text-content-secondary">
            Choose how much autonomy to grant. If the timer expires, nothing runs — the choice closes and
            never defaults to execution.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => onChoose('plan')} disabled={busy}>
            Plan first
          </Button>
          <Button size="sm" onClick={() => onChoose('direct')} loading={busy}>
            Execute directly
          </Button>
        </div>
      </div>
    </div>
  );
}
