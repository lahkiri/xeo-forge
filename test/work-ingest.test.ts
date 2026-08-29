/**
 * Unit pins for app/work/work-ingest.ts — pure ingestion helpers extracted
 * from WorkClient during the v1.24 structural rework. The seed loop is
 * byte-identical to the v1.23 inline implementation; these tests lock what
 * it must keep doing.
 */

import { describe, expect, it } from 'vitest';
import { extractLastGitDiff, type GitStatusSnapshot } from '../app/work/work-ingest';
import type { ParsedEvent } from '../lib/agent/timeline';

function ev(seq: number, type: string, data: Record<string, unknown>): ParsedEvent {
  return { seq, type, data, ts: 0 };
}

describe('extractLastGitDiff', () => {
  it('returns the result of the most recent successful git_op diff', () => {
    const events = [
      ev(1, 'tool_call', { name: 'git_op', args: { op: 'diff' } }),
      ev(2, 'tool_result', { name: 'git_op', ok: true, result: 'diff --git a/x b/x' }),
    ];
    expect(extractLastGitDiff(events)).toBe('diff --git a/x b/x');
  });

  it('prefers the LATEST successful diff when several were run', () => {
    const events = [
      ev(1, 'tool_call', { name: 'git_op', args: { op: 'diff' } }),
      ev(2, 'tool_result', { name: 'git_op', ok: true, result: 'first' }),
      ev(3, 'tool_call', { name: 'git_op', args: { op: 'diff' } }),
      ev(4, 'tool_result', { name: 'git_op', ok: true, result: 'second' }),
    ];
    expect(extractLastGitDiff(events)).toBe('second');
  });

  it('skips failed diffs and keeps the last SUCCESSFUL one', () => {
    const events = [
      ev(1, 'tool_call', { name: 'git_op', args: { op: 'diff' } }),
      ev(2, 'tool_result', { name: 'git_op', ok: true, result: 'good' }),
      ev(3, 'tool_call', { name: 'git_op', args: { op: 'diff' } }),
      ev(4, 'tool_result', { name: 'git_op', ok: false, error: 'not a repo' }),
    ];
    expect(extractLastGitDiff(events)).toBe('good');
  });

  it('ignores git_op calls that are not diffs', () => {
    const events = [
      ev(1, 'tool_call', { name: 'git_op', args: { op: 'status' } }),
      ev(2, 'tool_result', { name: 'git_op', ok: true, result: 'On master' }),
    ];
    expect(extractLastGitDiff(events)).toBeNull();
  });

  it('returns null when no diff ever ran (no invented state)', () => {
    expect(extractLastGitDiff([])).toBeNull();
    expect(extractLastGitDiff([ev(1, 'text', { delta: 'hello' })])).toBeNull();
  });

  it('an unclosed diff call (no result yet) yields null, not a partial', () => {
    const events = [ev(1, 'tool_call', { name: 'git_op', args: { op: 'diff' } })];
    expect(extractLastGitDiff(events)).toBeNull();
  });
});

describe('GitStatusSnapshot shape', () => {
  it('carries the fields the governance rail renders', () => {
    const snapshot: GitStatusSnapshot = {
      branch: 'master',
      detached: false,
      dirtyCount: 2,
      staged: 1,
      unstaged: 1,
      untracked: 0,
      lastCommit: { hash: 'abc1234', subject: 'fix: something' },
    };
    expect(snapshot.dirtyCount).toBe(2);
    expect(snapshot.lastCommit?.hash).toBe('abc1234');
  });
});
