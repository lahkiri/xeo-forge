'use client';

import { useMemo, useState } from 'react';
import type { ParsedEvent } from '@/lib/agent/timeline';
import { describeEvent, readContextLayers, type ActivityTone } from '@/lib/agent/events';
import { cx } from './ui';

/* ------------------------------------------------------------------ */
/*  EXECUTION TIMELINE                                                 */
/*                                                                     */
/*  Renders the persisted event stream as an activity log. Every row    */
/*  comes from a real event via describeEvent() — nothing is            */
/*  fabricated to make the surface look busy. Events with no standalone  */
/*  meaning (text/reasoning deltas, status transitions) return null      */
/*  from describeEvent and are omitted rather than padded.               */
/* ------------------------------------------------------------------ */

const TONE_DOT: Record<ActivityTone, string> = {
  neutral: 'bg-gray-600',
  active: 'bg-signal-run animate-live-pulse',
  good: 'bg-signal-pass/80',
  warn: 'bg-signal-gate/90',
  bad: 'bg-signal-fail/80',
};

const TONE_TEXT: Record<ActivityTone, string> = {
  neutral: 'text-content-secondary',
  active: 'text-signal-run',
  good: 'text-content-primary',
  warn: 'text-signal-gate',
  bad: 'text-signal-fail',
};

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export interface TimelineRow {
  seq: number;
  ts: number;
  type: string;
  title: string;
  detail?: string;
  tone: ActivityTone;
  raw: Record<string, unknown>;
}

/** Project events into renderable rows. Exported for testing. */
export function buildActivityRows(events: ParsedEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const event of events) {
    const label = describeEvent(event.type, event.data);
    if (!label) continue;
    rows.push({
      seq: event.seq,
      ts: event.ts,
      type: event.type,
      title: label.title,
      detail: label.detail,
      tone: label.tone,
      raw: event.data,
    });
  }
  return rows;
}

/**
 * Deep mode shows the raw event envelope. This serves developers without
 * pushing event internals into the default view (progressive disclosure).
 */
function DeepRow({ row }: { row: TimelineRow }) {
  return (
    <pre className="mt-1.5 overflow-x-auto rounded-md border border-line-subtle bg-black/30 px-2.5 py-2 font-mono text-micro leading-4 text-content-muted">
{`seq: ${row.seq}
type: ${row.type}
time: ${new Date(row.ts).toISOString()}
payload: ${JSON.stringify(row.raw, null, 2).slice(0, 900)}`}
    </pre>
  );
}

export function ExecutionTimeline({
  events,
  /** Cap rendered rows so a long run cannot stall the surface. */
  limit = 200,
}: {
  events: ParsedEvent[];
  limit?: number;
}) {
  const [deep, setDeep] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const allRows = useMemo(() => buildActivityRows(events), [events]);
  const rows = allRows.length > limit ? allRows.slice(-limit) : allRows;
  const hidden = allRows.length - rows.length;

  if (allRows.length === 0) {
    return (
      <p className="px-3 py-6 text-ui leading-5 text-content-muted">
        No activity recorded yet. Tool calls, context compilation, file changes, and verification
        results appear here as they happen.
      </p>
    );
  }

  const toggle = (seq: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-3 py-2">
        <span className="text-micro font-semibold uppercase tracking-[0.16em] text-content-muted">
          Activity
          <span className="ml-1.5 tabular-nums text-content-faint">{allRows.length}</span>
        </span>
        <button
          type="button"
          onClick={() => setDeep((v) => !v)}
          aria-pressed={deep}
          className={cx(
            'rounded px-1.5 py-0.5 text-micro uppercase tracking-[0.12em] transition',
            deep ? 'bg-ink-600 text-content-primary' : 'text-content-muted hover:text-content-secondary',
          )}
          title="Show raw event envelopes"
        >
          Deep
        </button>
      </div>

      {hidden > 0 && (
        <p className="border-b border-line-subtle px-3 py-1.5 text-micro text-content-muted">
          {hidden.toLocaleString()} earlier {hidden === 1 ? 'entry' : 'entries'} not shown.
        </p>
      )}

      <ol className="divide-y divide-white/[0.04]">
        {rows.map((row) => {
          const isOpen = deep || expanded.has(row.seq);
          const layers = row.type === 'context_layers' ? readContextLayers(row.raw) : null;
          return (
            <li key={row.seq} className="px-3 py-2">
              <div className="flex items-start gap-2.5">
                <span className="shrink-0 pt-1 font-mono text-micro tabular-nums text-content-faint">
                  {clock(row.ts)}
                </span>
                <span className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[row.tone])} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cx('text-ui leading-5', TONE_TEXT[row.tone])}>{row.title}</span>
                    {row.detail && (
                      <span className="min-w-0 truncate font-mono text-meta text-content-muted" title={row.detail}>
                        {row.detail}
                      </span>
                    )}
                  </div>

                  {/* Context compilation is the one event worth expanding inline:
                      it names exactly which memories reached the prompt. */}
                  {layers && (layers.memories.length > 0 || layers.instructions.length > 0) && (
                    <button
                      type="button"
                      onClick={() => toggle(row.seq)}
                      aria-expanded={expanded.has(row.seq)}
                      className="mt-1 text-micro text-signal-run/70 transition hover:text-signal-run"
                    >
                      {expanded.has(row.seq) ? 'Hide what was injected' : 'Show what was injected'}
                    </button>
                  )}

                  {layers && expanded.has(row.seq) && (
                    <ul className="mt-1.5 space-y-1 border-l border-line-subtle pl-2.5">
                      {layers.instructions.map((instruction) => (
                        <li key={instruction.id} className="text-meta leading-4 text-content-muted">
                          <span className="text-content-secondary">{instruction.name}</span>
                          <span className="ml-1.5 text-content-faint">{instruction.scope} instruction</span>
                        </li>
                      ))}
                      {layers.memories.map((memory) => (
                        <li key={memory.id} className="text-meta leading-4 text-content-muted">
                          <span className="text-content-secondary">{memory.content || memory.kind}</span>
                          <span className="ml-1.5 text-content-faint">
                            {memory.scope} {memory.kind}
                            {memory.confidence !== undefined && ` · ${Math.round(memory.confidence * 100)}%`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {isOpen && deep && <DeepRow row={row} />}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
