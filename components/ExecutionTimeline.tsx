'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ParsedEvent } from '@/lib/agent/timeline';
import { describeEvent, readContextLayers, type ActivityTone } from '@/lib/agent/events';
import { useVirtualList } from './useVirtualList';
import { cx } from './ui';

/* ------------------------------------------------------------------ */
/*  EXECUTION TIMELINE                                                 */
/*                                                                     */
/*  Renders the persisted event stream as an activity log. Every row    */
/*  comes from a real event via describeEvent() — nothing is            */
/*  fabricated to make the surface look busy. Events with no standalone  */
/*  meaning (text/reasoning deltas, status transitions) return null      */
/*  from describeEvent and are omitted rather than padded.               */
/*                                                                     */
/*  VIRTUALIZED (Gate 3 C2): ALL rows are addressable — none are        */
/*  hidden behind a cap — but only the visible window (plus overscan)   */
/*  is materialized in the DOM. Variable heights (deep-mode rows are    */
/*  ~7x taller) are measured per row; see components/useVirtualList.ts. */
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

/** A compact row estimates at 40px; a deep row carries a ~950px payload. */
function estimateRowHeight(index: number, rows: TimelineRow[], deep: boolean): number {
  void index;
  return deep ? 1000 : 40;
}

export function ExecutionTimeline({ events }: { events: ParsedEvent[] }) {
  const [deep, setDeep] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const allRows = useMemo(() => buildActivityRows(events), [events]);

  const estimate = useCallback(
    (index: number) => estimateRowHeight(index, allRows, deep || expanded.size > 0),
    [allRows, deep, expanded],
  );

  const list = useVirtualList({
    count: allRows.length,
    estimateRowHeight: estimate,
    // The timeline reads chronologically oldest→newest, and the interesting
    // end is the newest, so the list opens at the bottom and follows while
    // the user stays there — the same contract the run log has.
    startAtBottom: true,
    followBottom: true,
  });

  if (allRows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-panel border border-line-subtle bg-ink-900/60" aria-hidden="true">
          <span className="ember-rule" />
        </span>
        <h3 className="mt-5 text-title font-semibold text-content-primary">The trail starts with the first action</h3>
        <p className="mt-2 max-w-sm text-body leading-6 text-content-muted">
          Tool calls, context compilation, file changes, and verification results appear here
          as they happen — every step persisted and replayable.
        </p>
      </div>
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-subtle px-3 py-2">
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

      {/* The scroll container. Every row in the run's history is reachable;
          only the visible window is in the DOM (see useVirtualList). */}
      <div ref={list.scrollRef} className="min-h-0 flex-1 overflow-y-auto" role="log" aria-label="Run activity">
        <div style={{ height: list.totalHeight, position: 'relative' }}>
          {allRows.slice(list.start, list.end).map((row, i) => {
            const index = list.start + i;
            const isOpen = deep || expanded.has(row.seq);
            const layers = row.type === 'context_layers' ? readContextLayers(row.raw) : null;
            return (
              <div
                key={row.seq}
                ref={list.rowRef(index)}
                style={{ position: 'absolute', top: list.topOf(index), left: 0, right: 0 }}
                className="border-b border-white/[0.04] px-3 py-2"
              >
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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
