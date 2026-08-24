import { describe, it, expect } from 'vitest';
import { deriveChatRuntime, formatElapsed, PROVIDER_STALL_MS } from '../lib/agent/runtime-state';
import { parseEvents } from '../lib/agent/timeline';
import type { TaskEvent } from '../lib/types';

/* ------------------------------------------------------------------ */
/*  Chat runtime states — replaces a generic "thinking…" spinner with  */
/*  a truthful lifecycle. Tests import the shipped derivation.         */
/* ------------------------------------------------------------------ */

const T0 = Date.parse('2026-01-01T00:00:00Z');

function ev(seq: number, type: string, data: Record<string, unknown> = {}): TaskEvent {
  return {
    id: seq,
    task_id: 'task-1',
    seq,
    type,
    content: JSON.stringify(data),
    created_at: new Date(T0).toISOString(),
  };
}

function derive(status: string, events: TaskEvent[], now = T0) {
  return deriveChatRuntime({ status, currentRunEvents: parseEvents(events), now });
}

describe('Terminal and idle states come from the server', () => {
  it('reports completed without inventing activity', () => {
    const r = derive('completed', [ev(1, 'text', { delta: 'hi' })]);
    expect(r.state).toBe('completed');
    expect(r.canStop).toBe(false);
    expect(r.canRetry).toBe(false);
  });

  it('reports failed and offers retry', () => {
    const r = derive('failed', [ev(1, 'error', { message: 'boom' })]);
    expect(r.state).toBe('failed');
    expect(r.canRetry).toBe(true);
    expect(r.canStop).toBe(false);
  });

  it('treats planned and awaiting_decision as idle, not working', () => {
    for (const status of ['planned', 'awaiting_decision']) {
      const r = derive(status, []);
      expect(r.state).toBe('idle');
      expect(r.canStop).toBe(false);
    }
  });
});

describe('Startup states', () => {
  it('reports queued for a pending run with no events', () => {
    const r = derive('pending', []);
    expect(r.state).toBe('queued');
    expect(r.label).toBe('Queued');
    expect(r.canStop).toBe(true);
    expect(r.sinceLastEventMs).toBeNull();
  });

  it('reports connecting for a running run with no events', () => {
    const r = derive('running', []);
    expect(r.state).toBe('connecting');
    expect(r.stalled).toBe(false);
  });
});

describe('Activity states name the actual operation', () => {
  it('distinguishes reading context from other tool use', () => {
    const read = derive('running', [ev(1, 'tool_call', { name: 'file_read', args: { path: 'auth/session.ts' } })]);
    expect(read.state).toBe('reading_context');
    expect(read.label).toBe('Reading project context');
    expect(read.detail).toBe('auth/session.ts');

    const write = derive('running', [ev(1, 'tool_call', { name: 'file_write', args: { path: 'index.html' } })]);
    expect(write.state).toBe('using_tool');
    expect(write.label).toContain('file_write');
  });

  it('surfaces a URL for network tools', () => {
    const r = derive('running', [ev(1, 'tool_call', { name: 'http_request', args: { url: 'https://example.com' } })]);
    expect(r.detail).toBe('https://example.com');
  });

  it('reports writing the answer while text streams', () => {
    const r = derive('running', [ev(1, 'text', { delta: 'partial' })]);
    expect(r.state).toBe('receiving');
    expect(r.label).toBe('Writing the answer');
  });

  it('reports compaction explicitly rather than as generic work', () => {
    const r = derive('running', [ev(1, 'compaction', { archived: 12 })]);
    expect(r.state).toBe('compacting');
    expect(r.label).toMatch(/compact/i);
  });

  it('reports a retry with its attempt number', () => {
    const r = derive('running', [ev(1, 'model_retry', { attempt: 2, reason: 'rate limit' })]);
    expect(r.state).toBe('retrying');
    expect(r.label).toContain('2');
    expect(r.detail).toBe('rate limit');
  });
});

describe('Provider stall detection', () => {
  it('does not claim a stall below the threshold', () => {
    const r = derive('running', [ev(1, 'text', { delta: 'x' })], T0 + PROVIDER_STALL_MS - 1);
    expect(r.stalled).toBe(false);
    expect(r.state).toBe('receiving');
    expect(r.canRetry).toBe(false);
  });

  it('reports waiting for the provider at the threshold and offers retry', () => {
    const r = derive('running', [ev(1, 'text', { delta: 'x' })], T0 + PROVIDER_STALL_MS);
    expect(r.stalled).toBe(true);
    expect(r.state).toBe('waiting_for_provider');
    expect(r.label).toMatch(/waiting for the model/i);
    expect(r.canRetry).toBe(true);
  });

  it('reports the stall after a completed tool call with no follow-up', () => {
    const r = derive('running', [ev(1, 'tool_result', { name: 'file_read', ok: true })], T0 + 30_000);
    expect(r.state).toBe('waiting_for_provider');
    expect(r.canRetry).toBe(true);
  });

  it('tracks time since the last event, not since the run started', () => {
    const r = derive('running', [ev(1, 'text', {}), ev(2, 'text', {})], T0 + 5_000);
    expect(r.sinceLastEventMs).toBe(5_000);
  });

  it('never marks a retry as stalled, because the retry is the explanation', () => {
    const r = derive('running', [ev(1, 'model_retry', { attempt: 1 })], T0 + 60_000);
    expect(r.stalled).toBe(false);
  });
});

describe('formatElapsed', () => {
  it('formats as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_000)).toBe('0:09');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(600_000)).toBe('10:00');
  });

  it('clamps negatives instead of rendering nonsense', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});
