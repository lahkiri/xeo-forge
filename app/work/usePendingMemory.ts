'use client';

/**
 * Pending memory-candidate count for the Memory tab badge.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM: polled
 * once per terminal state change so a proposal is never silently dropped.
 */

import { useCallback, useEffect, useState } from 'react';

export function usePendingMemory(taskId: string, status: string) {
  const [pendingMemory, setPendingMemory] = useState(0);

  const loadPendingMemory = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/memory`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setPendingMemory(Array.isArray(body.candidates) ? body.candidates.length : 0);
    } catch (err) {
      console.warn('[work] could not read memory candidates:', err);
    }
  }, [taskId]);

  useEffect(() => { void loadPendingMemory(); }, [loadPendingMemory, status]);

  return { pendingMemory, loadPendingMemory };
}
