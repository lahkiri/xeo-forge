'use client';

/**
 * Governance actions — the POST verbs of the Work surface.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM: same
 * routes, same toasts, same optimistic status transitions. The follow-up
 * composer action stays in WorkClient because it owns draft/message state.
 */

import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import type { Task } from '@/lib/types';
import { useToast } from '@/components/ui';

export function useWorkActions({
  taskId,
  setBusy,
  setStatus,
  setProposedPlan,
}: {
  taskId: string;
  setBusy: (value: boolean) => void;
  setStatus: (value: Task['status']) => void;
  setProposedPlan: (value: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  // Mirrors busy for guards that run between renders (hotkey path).
  const busyRef = useRef(false);

  async function post(path: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/tasks/${taskId}${path}`, {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || `Request failed (${res.status}).` };
  }

  const approve = async (onApproved?: () => void) => {
    setBusy(true);
    const result = await post('/approve');
    setBusy(false);
    if (!result.ok) { toast.push('error', result.error!); return; }
    toast.push('success', 'Plan approved and frozen. Build started.');
    setStatus('pending');
    // UI-side success navigation (jump back to the run log) — caller-owned.
    onApproved?.();
  };

  const reject = async (reason: string) => {
    setBusy(true);
    const result = await post('/reject', { reason });
    setBusy(false);
    if (!result.ok) { toast.push('error', result.error!); return; }
    toast.push('info', 'Sent back for revision. A new planning run started.');
    setStatus('pending');
    setProposedPlan('');
  };

  const decide = async (choice: 'direct' | 'plan') => {
    setBusy(true);
    const result = await post('/decision', { choice });
    setBusy(false);
    if (!result.ok) { toast.push('error', result.error!); return; }
    toast.push('success', choice === 'direct' ? 'Execution brief frozen. Building.' : 'Planning run started.');
    setStatus('pending');
  };

  const cancelRun = async () => {
    setBusy(true);
    const result = await post('/cancel');
    setBusy(false);
    if (!result.ok) { toast.push('error', result.error!); return; }
    toast.push('info', 'Run cancelled. The event trail shows where it stopped.');
    setStatus('cancelled');
  };

  /** Re-plan keeps the router refresh local to the rail's button. */
  const replan = async () => {
    const result = await post('/mode', { mode: 'planning' });
    if (!result.ok) { toast.push('error', result.error!); return; }
    toast.push('info', 'Switched to planning. Approved plan cleared.');
    router.refresh();
  };

  /**
   * Follow-up message: POST /messages then optimistically append the user
   * turn. Extracted from WorkClient.tsx verbatim (including the busy guard
   * the mod+Enter hotkey path relies on) — the caller owns draft state and
   * the run-log pin (so the composer scrolls to the new turn).
   */
  const sendFollowUp = async (
    draft: string,
    setDraft: (value: string) => void,
    appendUserMessage: (content: string) => void,
    onSent?: () => void,
  ) => {
    const text = draft.trim();
    if (!text || busyRef.current) return;
    setBusy(true);
    busyRef.current = true;
    const result = await post('/messages', { content: text });
    setBusy(false);
    busyRef.current = false;
    if (!result.ok) { toast.push('error', result.error!); return; }
    appendUserMessage(text);
    setDraft('');
    setStatus('pending');
    onSent?.();
  };

  return { post, toast, approve, reject, decide, cancelRun, replan, sendFollowUp, router };
}
