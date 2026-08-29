'use client';

/**
 * Decision countdown (presentation only) — ticks while a decision window is
 * open. Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM.
 */

import { useEffect, useState } from 'react';
import type { Task } from '@/lib/types';

export function useDecisionCountdown(task: Task, status: Task['status']) {
  const [decisionSeconds, setDecisionSeconds] = useState(() =>
    task.decision_expires_at
      ? Math.max(0, Math.ceil((Date.parse(task.decision_expires_at) - Date.now()) / 1000))
      : 0,
  );

  useEffect(() => {
    if (status !== 'awaiting_decision' || !task.decision_expires_at) return;
    const tickFn = () =>
      setDecisionSeconds(
        Math.max(0, Math.ceil((Date.parse(task.decision_expires_at as string) - Date.now()) / 1000)),
      );
    tickFn();
    const id = setInterval(tickFn, 1000);
    return () => clearInterval(id);
  }, [status, task.decision_expires_at]);

  return decisionSeconds;
}
