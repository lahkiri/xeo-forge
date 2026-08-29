/**
 * Pure ingestion helpers for the Work surface.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM: the
 * diff-seeding loop is byte-identical to the inline version that shipped in
 * v1.23. No React here — these run identically in Node and the browser, and
 * test/work-ingest.test.ts pins their contracts.
 */

import type { ParsedEvent } from '@/lib/agent/timeline';

/** Shape of GET /api/tasks/:id/git — the governance rail's repository card. */
export interface GitStatusSnapshot {
  branch: string | null;
  detached: boolean;
  dirtyCount: number;
  staged: number;
  unstaged: number;
  untracked: number;
  lastCommit: { hash: string; subject: string } | null;
}

/**
 * Seed the Diff tab from PERSISTED history: the most recent successful
 * git diff the agent ran. Without this, a reload would forget a diff the
 * live stream would still be showing.
 */
export function extractLastGitDiff(events: ParsedEvent[]): string | null {
  let pending = false;
  let last: string | null = null;
  for (const event of events) {
    if (event.type === 'tool_call' && event.data.name === 'git_op') {
      const args = event.data.args as unknown as Record<string, unknown> | undefined;
      pending = args?.op === 'diff';
    } else if (event.type === 'tool_result' && event.data.name === 'git_op') {
      if (pending) {
        pending = false;
        if (event.data.ok === true && typeof event.data.result === 'string') {
          last = event.data.result;
        }
      }
    }
  }
  return last;
}
