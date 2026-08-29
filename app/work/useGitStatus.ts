'use client';

/**
 * Repository status for the Work governance rail.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework): identical fetch,
 * identical fall-open behavior — a failed probe logs a warning and leaves
 * the rail silent rather than inventing a repository state (AGENTS.md §16).
 */

import { useCallback, useEffect, useState } from 'react';
import type { GitStatusSnapshot } from './work-ingest';

export function useGitStatus(taskId: string) {
  const [gitStatus, setGitStatus] = useState<GitStatusSnapshot | null>(null);
  const [gitStatusLoaded, setGitStatusLoaded] = useState(false);

  const loadGitStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/git`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setGitStatus(body.status ?? null);
      setGitStatusLoaded(true);
    } catch (err) {
      console.warn('[work] could not read git status:', err);
    }
  }, [taskId]);

  useEffect(() => { void loadGitStatus(); }, [loadGitStatus]);

  return { gitStatus, gitStatusLoaded, loadGitStatus };
}
