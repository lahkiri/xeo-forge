'use client';

/**
 * Workspace diff state for the Work Diff tab.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework): the on-demand
 * loader and the persisted-history seed behave exactly as before — a blocked
 * outcome (not a repo, git missing) is displayed as an explanation, never as
 * a fake empty diff.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskEvent } from '@/lib/types';
import { parseEvents } from '@/lib/agent/timeline';
import { extractLastGitDiff } from './work-ingest';

export function useWorkspaceDiff(taskId: string, initialEvents: TaskEvent[]) {
  const [diffText, setDiffText] = useState<string | null>(null);
  const [diffBlocked, setDiffBlocked] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  /**
   * True between a git_op(diff) tool_call and its tool_result, so the Diff tab
   * can capture the unified diff the agent asked for. Tool calls in one run are
   * sequential, so a boolean (not a queue) is exact.
   */
  const pendingGitDiffRef = useRef(false);

  // Seed the Diff tab from PERSISTED history: the most recent successful
  // git diff the agent ran. Without this, a reload would forget a diff the
  // live stream would still be showing.
  useEffect(() => {
    const last = extractLastGitDiff(parseEvents(initialEvents));
    if (last !== null) setDiffText(last);
  }, [initialEvents]);

  /**
   * Fetch the workspace diff on demand. `path` scopes the diff to one file so
   * a click on a Files-changed row shows that file's changes. A blocked
   * outcome (not a repo, git missing) is displayed as an explanation, never
   * as a fake empty diff.
   */
  const loadWorkspaceDiff = useCallback(async (path?: string) => {
    setDiffLoading(true);
    try {
      const qs = path ? `?path=${encodeURIComponent(path)}` : '';
      const res = await fetch(`/api/tasks/${taskId}/git/diff${qs}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDiffBlocked(body.error || `Could not load diff (${res.status}).`);
        return;
      }
      const body = await res.json();
      if (typeof body.diff === 'string') {
        setDiffText(body.diff);
        setDiffBlocked(null);
      } else {
        setDiffText(null);
        setDiffBlocked(typeof body.blocked === 'string' ? body.blocked : 'No diff available.');
      }
    } catch (err) {
      setDiffBlocked(err instanceof Error ? err.message : 'Could not load diff.');
    } finally {
      setDiffLoading(false);
    }
  }, [taskId]);

  const clearDiff = useCallback(() => {
    setDiffText(null);
    setDiffBlocked(null);
  }, []);

  return {
    diffText,
    setDiffText,
    diffBlocked,
    setDiffBlocked,
    diffLoading,
    pendingGitDiffRef,
    loadWorkspaceDiff,
    clearDiff,
  };
}
