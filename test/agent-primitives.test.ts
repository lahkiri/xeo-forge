import { describe, it, expect } from 'vitest';
import { buildActivityRows } from '../components/ExecutionTimeline';
import { authorityForMode, deriveFlow } from '../components/AgentPrimitives';
import { parseEvents } from '../lib/agent/timeline';
import type { TaskEvent } from '../lib/types';

/* ------------------------------------------------------------------ */
/*  Semantic primitives — the UI must never claim a state the backend  */
/*  does not support. These tests import the shipped derivations.       */
/* ------------------------------------------------------------------ */

function ev(seq: number, type: string, data: Record<string, unknown> = {}): TaskEvent {
  return {
    id: seq,
    task_id: 't',
    seq,
    type,
    content: JSON.stringify(data),
    created_at: '2026-01-01T00:00:00Z',
  };
}

describe('Activity rows come only from real events', () => {
  it('omits stream events that carry no standalone activity', () => {
    const rows = buildActivityRows(parseEvents([
      ev(1, 'text', { delta: 'hello' }),
      ev(2, 'reasoning', { delta: 'x' }),
      ev(3, 'task_status', { status: 'running' }),
    ]));
    expect(rows).toEqual([]);
  });

  it('renders one row per meaningful event, preserving order', () => {
    const rows = buildActivityRows(parseEvents([
      ev(1, 'context_layers', { instructions: [], memories: [{ id: 'm', kind: 'fact', scope: 'task', content: 'a' }] }),
      ev(2, 'tool_call', { name: 'file_read', args: { path: 'a.ts' } }),
      ev(3, 'tool_result', { name: 'file_read', ok: true, result: 'ok' }),
      ev(4, 'done', { status: 'completed' }),
    ]));
    expect(rows.map((r) => r.title)).toEqual([
      'Context compiled',
      'Reading project context',
      'file_read completed',
      'Completed',
    ]);
  });

  it('does not fabricate rows for an empty stream', () => {
    expect(buildActivityRows([])).toEqual([]);
  });

  it('carries the raw payload so Deep mode shows real data', () => {
    const rows = buildActivityRows(parseEvents([ev(1, 'tool_call', { name: 'file_write', args: { path: 'x.ts' } })]));
    expect(rows[0].raw.name).toBe('file_write');
    expect(rows[0].seq).toBe(1);
  });

  it('marks a failed tool result as bad, not merely finished', () => {
    const rows = buildActivityRows(parseEvents([ev(1, 'tool_result', { name: 'code_execute', ok: false, error: 'exit 1' })]));
    expect(rows[0].tone).toBe('bad');
  });
});

describe('Authority reflects what dispatch actually enforces', () => {
  it('locks write and execute outside build mode', () => {
    for (const mode of ['planning', 'chat']) {
      const rows = authorityForMode(mode);
      expect(rows.find((r) => r.label === 'Write files')?.state).toBe('locked');
      expect(rows.find((r) => r.label === 'Run commands')?.state).toBe('locked');
    }
  });

  it('allows write and execute in build mode', () => {
    const rows = authorityForMode('build');
    expect(rows.find((r) => r.label === 'Write files')?.state).toBe('allowed');
    expect(rows.find((r) => r.label === 'Run commands')?.state).toBe('allowed');
  });

  it('always allows reading, in every mode', () => {
    for (const mode of ['chat', 'planning', 'build']) {
      expect(authorityForMode(mode).find((r) => r.label === 'Read files')?.state).toBe('allowed');
    }
  });

  it('never reports browser interaction as plainly allowed, because it is policy-gated', () => {
    for (const mode of ['chat', 'planning', 'build']) {
      expect(authorityForMode(mode).find((r) => r.label === 'Browser actions')?.state).toBe('gated');
    }
  });

  it('gives every row a reason, so "Why?" is always answerable', () => {
    for (const row of authorityForMode('build')) {
      expect(row.reason.length).toBeGreaterThan(10);
    }
  });

  it('does not describe restricted host execution as a sandbox', () => {
    const reason = authorityForMode('build').find((r) => r.label === 'Run commands')!.reason;
    expect(reason.toLowerCase()).not.toContain('sandbox');
    expect(reason).toMatch(/restricted host execution/i);
  });
});

describe('Xeo Flow is derived from observable state', () => {
  const base = {
    status: 'pending',
    mode: 'planning',
    hasContextEvent: false,
    hasPlan: false,
    hasApprovedPlan: false,
    hasToolActivity: false,
  };

  it('marks nothing done at the start of a run', () => {
    const stages = deriveFlow(base);
    expect(stages.filter((s) => s.state === 'done')).toHaveLength(0);
    expect(stages[0].state).toBe('current');
  });

  it('marks context done only after a context event exists', () => {
    expect(deriveFlow({ ...base, hasContextEvent: true })[0].state).toBe('done');
  });

  it('marks approval done only when a plan was actually frozen', () => {
    const withPlan = deriveFlow({ ...base, hasContextEvent: true, hasPlan: true, status: 'planned' });
    expect(withPlan.find((s) => s.id === 'approval')?.state).toBe('current');

    const approved = deriveFlow({ ...base, hasContextEvent: true, hasPlan: true, hasApprovedPlan: true });
    expect(approved.find((s) => s.id === 'approval')?.state).toBe('done');
  });

  it('marks result done on a terminal status and not before', () => {
    expect(deriveFlow({ ...base, status: 'running' }).find((s) => s.id === 'result')?.state).toBe('pending');
    expect(deriveFlow({ ...base, status: 'completed' }).find((s) => s.id === 'result')?.state).toBe('done');
    expect(deriveFlow({ ...base, status: 'failed' }).find((s) => s.id === 'result')?.state).toBe('done');
  });

  it('does not claim execute finished when no tool ever ran', () => {
    const stages = deriveFlow({ ...base, status: 'completed', hasToolActivity: false });
    expect(stages.find((s) => s.id === 'execute')?.state).toBe('pending');
  });

  it('gives every stage a navigation target, so the trail is not decorative', () => {
    for (const stage of deriveFlow(base)) {
      expect(stage.target).toBeTruthy();
    }
  });
});
