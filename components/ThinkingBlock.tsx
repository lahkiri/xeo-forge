'use client';

import { useState } from 'react';
import { cx } from './ui';

/* ------------------------------------------------------------------ */
/*  ThinkingBlock — the reasoning-model surface.                       */
/*                                                                     */
/*  Frontier reasoning models (Opus 5, o-series, GLM thinking) stream  */
/*  thinking tokens BEFORE the visible answer. The loop has always     */
/*  emitted them as `reasoning` events; nothing rendered them. This    */
/*  block shows what the model was actually considering — collapsed   */
/*  by default (thinking is context, not content), expandable on      */
/*  demand, styled as cooled metal per the forge identity.            */
/* ------------------------------------------------------------------ */

export function ThinkingBlock({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;

  const words = text.trim().split(/\s+/).length;
  const preview = text.trim().slice(0, 140).replace(/\s+\S*$/, '');

  return (
    <div className="thinking-block mb-2 rounded-control border border-line-subtle bg-ink-900/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-ink-700/40"
      >
        <span
          aria-hidden="true"
          className={cx('text-micro', live ? 'animate-live-pulse text-signal-run' : 'text-content-faint')}
        >
          {live ? '◆' : '◇'}
        </span>
        <span className={cx('text-micro font-medium uppercase tracking-[0.14em]', live ? 'text-signal-run' : 'text-content-muted')}>
          {live ? 'Thinking' : 'Thought process'}
        </span>
        <span className="text-micro tabular-nums text-content-faint">{words} words</span>
        <span className="flex-1" />
        <span aria-hidden="true" className="text-micro text-content-faint">{open ? '▲' : '▼'}</span>
      </button>
      {open ? (
        <div className="border-t border-line-subtle px-3 py-2.5">
          <p className="whitespace-pre-wrap font-mono text-meta leading-5 text-content-muted">{text}</p>
        </div>
      ) : (
        <p className="truncate px-3 pb-2 text-micro text-content-faint" title={preview}>{preview}…</p>
      )}
    </div>
  );
}

/** Join reasoning deltas from a run's events into one block of text. */
export function reasoningTextOf(events: { type: string; data: Record<string, unknown> }[]): string {
  return events
    .filter((e) => e.type === 'reasoning')
    .map((e) => (typeof e.data.delta === 'string' ? e.data.delta : ''))
    .join('');
}
