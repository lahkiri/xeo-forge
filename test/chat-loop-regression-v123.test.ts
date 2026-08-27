import { describe, it, expect } from 'vitest';
import { separateThinkTags, splitRuns, parseEvents, buildTimeline } from '../lib/agent/timeline';
import type { TaskEvent } from '../lib/types';

/**
 * v1.23 regression contract — the two Phase-0 fixes:
 *
 * 1. CHAT FINALIZE: a chat run whose model answers with text (no tool calls)
 *    must complete on that answer. The build-mode detectors below the
 *    planning branch (textAsksUserQuestion / NO_WORK_PERFORMED_NUDGE) are
 *    unreachable for chat because the loop returns before them. This test
 *    pins the client-side half of that contract: the run text is rendered
 *    verbatim, never re-prompted, never duplicated.
 *
 * 2. INLINE THINK: <think>…</think> delivered inside text deltas (proxy
 *    gateways) is reasoning, not answer — separated on both the live path
 *    (separateThinkTags) and the persisted path (loop.ts strips textBuf).
 */

function ev(seq: number, type: string, data: Record<string, unknown>): TaskEvent {
  return {
    seq,
    type,
    content: JSON.stringify(data),
    task_id: 't1',
    created_at: new Date(2026, 0, 1, 12, 0, seq).toISOString(),
  } as TaskEvent;
}

describe('separateThinkTags (inline think-tag contract)', () => {
  it('passes plain answers through untouched', () => {
    const r = separateThinkTags('Hello world');
    expect(r.answer).toBe('Hello world');
    expect(r.reasoning).toBe('');
  });

  it('extracts a closed think block and cleans the answer', () => {
    const r = separateThinkTags('<think>let me consider X</think>\n\nThe answer is 4.');
    expect(r.reasoning).toBe('let me consider X');
    expect(r.answer).toBe('The answer is 4.');
  });

  it('extracts multiple closed blocks in order', () => {
    const r = separateThinkTags('<think>one</think>mid<think>two</think>end');
    expect(r.reasoning).toBe('one\ntwo');
    expect(r.answer).toBe('midend');
  });

  it('treats an unterminated trailing think as reasoning (stream cut mid-thought)', () => {
    const r = separateThinkTags('Final: 42\n<think>cut off mid');
    expect(r.answer).toBe('Final: 42');
    expect(r.reasoning).toBe('cut off mid');
  });

  it('answer whitespace adjacent to the tag is separator, not content', () => {
    const r = separateThinkTags('Answer line.\n\n<think>hm</think>');
    expect(r.answer).toBe('Answer line.');
  });

  it('never leaks a partial tag into the answer', () => {
    const r = separateThinkTags('<think>only thinking so far');
    expect(r.answer).toBe('');
    expect(r.reasoning).toBe('only thinking so far');
  });

  it('is fast on large inputs (no pathological backtracking)', () => {
    const big = '<think>x</think>'.repeat(2000) + 'answer';
    const t0 = Date.now();
    const r = separateThinkTags(big);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.answer).toBe('answer');
  });
});

describe('chat run text integrity (v1.22 contract, think-aware)', () => {
  it('live (pre-done) run text is verbatim; separation is identity on clean prose', () => {
    const live = parseEvents([
      ev(1, 'text', { delta: 'مرحبا! ' }),
      ev(2, 'text', { delta: 'كيف أساعدك؟' }),
    ]);
    const { currentRunText } = splitRuns(live);
    expect(currentRunText).toBe('مرحبا! كيف أساعدك؟');
    expect(separateThinkTags(currentRunText).answer).toBe('مرحبا! كيف أساعدك؟');
  });

  it('after done, currentRunText empties by design — persisted messages win', () => {
    const events = parseEvents([
      ev(1, 'text', { delta: 'مرحبا! كيف أساعدك؟' }),
      ev(2, 'done', { status: 'completed', summary: 'مرحبا! كيف أساعدك؟' }),
    ]);
    expect(splitRuns(events).currentRunText).toBe('');
  });

  it('think-tagged live stream: answer excludes the block, reasoning holds it', () => {
    const events = parseEvents([
      ev(1, 'text', { delta: '<think>check the premise</think>' }),
      ev(2, 'text', { delta: '42 is the answer.' }),
    ]);
    const { currentRunText } = splitRuns(events);
    const separated = separateThinkTags(currentRunText);
    expect(separated.answer).toBe('42 is the answer.');
    expect(separated.reasoning).toBe('check the premise');
  });

  it('repeated identical turns do not multiply: seq dedupe keeps one copy', () => {
    const events = parseEvents([
      ev(1, 'text', { delta: 'same answer' }),
      ev(2, 'done', { status: 'completed', summary: 'same answer' }),
      // SSE replay of the same events must be deduped by the client via seq
      parseEvents([ev(1, 'text', { delta: 'same answer' })])[0],
    ]);
    const texts = events.filter((e) => e.type === 'text');
    expect(texts).toHaveLength(1);
  });
});

describe('work timeline (think-tag stripping in the live run turn)', () => {
  it('live run turn renders the cleaned answer', () => {
    const events = parseEvents([
      ev(1, 'text', { delta: '<think>plan quietly</think>' }),
      ev(2, 'text', { delta: 'Working on it.' }),
    ]);
    const timeline = buildTimeline({
      events,
      messages: [],
      status: 'running',
      goal: 'do the thing',
    });
    const run = timeline.find((t) => t.id === -1);
    expect(run).toBeDefined();
    expect(run!.content).toBe('Working on it.');
  });

  it('finished run text comes from persisted messages verbatim', () => {
    const events = parseEvents([ev(1, 'done', { status: 'completed', summary: 'done' })]);
    const timeline = buildTimeline({
      events,
      messages: [
        { id: 1, role: 'user', content: 'hi', active: 1, task_id: 't1', created_at: '' },
        { id: 2, role: 'assistant', content: 'persisted answer', active: 1, task_id: 't1', created_at: '' },
      ],
      status: 'completed',
      goal: 'g',
    });
    expect(timeline.map((t) => t.content)).toEqual(['hi', 'persisted answer']);
  });
});
