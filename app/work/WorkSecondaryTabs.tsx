'use client';

/**
 * Secondary center tabs — activity, project, preview, context, memory,
 * terminal, diff. The run tab stays in WorkClient (it owns the composer and
 * the governance flow); everything else is one of these fixed surfaces.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM, including
 * the demo Skip affordance which lives beside the Activity timeline.
 */

import { ExecutionTimeline } from '@/components/ExecutionTimeline';
import { FileActivity } from '@/components/FileActivity';
import { ContextInspector } from '@/components/ContextInspector';
import { MemoryReview } from '@/components/MemoryReview';
import { WorkspaceViewer } from '@/components/WorkspaceViewer';
import { PreviewPanel } from '@/components/PreviewPanel';
import TaskContextPanel from '@/app/tasks/[id]/TaskContextPanel';
import Terminal from '@/components/Terminal';
import type { ParsedEvent } from '@/lib/agent/timeline';
import type { Task } from '@/lib/types';
import { WorkDiffTab } from './WorkDiffTab';
import type { GitStatusSnapshot } from './work-ingest';

type CenterTab =
  | 'run' | 'activity' | 'project' | 'preview'
  | 'context' | 'memory' | 'terminal' | 'diff';

export function WorkSecondaryTabs({
  tab,
  task,
  events,
  isActivityRunning,
  isTerminal,
  demoMode,
  demoDone,
  demoRevealAllRef,
  diffText,
  diffBlocked,
  diffLoading,
  onLoadDiff,
  onClearDiff,
  gitStatus,
  fileChanges,
  onMemoryChanged,
}: {
  tab: CenterTab;
  task: Task;
  events: ParsedEvent[];
  /** LIVE run status (the stream's), not the initial row — Activity uses it. */
  isActivityRunning: boolean;
  isTerminal: boolean;
  demoMode: boolean;
  demoDone: boolean;
  demoRevealAllRef: { current: boolean };
  diffText: string | null;
  diffBlocked: string | null;
  diffLoading: boolean;
  onLoadDiff: (path?: string) => void;
  onClearDiff: () => void;
  gitStatus: GitStatusSnapshot | null;
  fileChanges: { action: string; path: string }[];
  onMemoryChanged: () => void;
}) {
  if (tab === 'activity') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {demoMode && !demoDone && (
          <button
            type="button"
            onClick={() => { demoRevealAllRef.current = true; }}
            className="mb-2 rounded-control border border-line-subtle px-3 py-1.5 text-meta text-content-muted transition hover:text-content-primary hover:border-accent-gold/40"
          >
            Skip to the end of the recording
          </button>
        )}
        <FileActivity events={events} isRunning={isActivityRunning} />
        <ExecutionTimeline events={events} />
      </div>
    );
  }
  if (tab === 'project') {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspaceViewer taskId={task.id} />
      </div>
    );
  }
  if (tab === 'preview') {
    // v1.25 (Phase 6.1): a failed run says so in the Preview tab, with the
    // classified reason from its own error event — never a bare panel.
    const failureReason = (() => {
      const errorEvent = [...events].reverse().find((event) => event.type === 'error');
      if (!errorEvent) return null;
      const message = (errorEvent.data as Record<string, unknown>).message;
      return typeof message === 'string' && message.trim() ? message : null;
    })();
    const failed = task.status === 'failed';
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <PreviewPanel taskId={task.id} isTerminal={isTerminal} failed={failed} failureReason={failureReason} />
      </div>
    );
  }
  if (tab === 'context') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-8">
          <ContextInspector taskId={task.id} />
          <TaskContextPanel taskId={task.id} />
        </div>
      </div>
    );
  }
  if (tab === 'memory') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <MemoryReview taskId={task.id} onChanged={onMemoryChanged} />
      </div>
    );
  }
  if (tab === 'terminal') {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <Terminal taskId={task.id} />
      </div>
    );
  }
  if (tab === 'diff') {
    return (
      <WorkDiffTab
        diffText={diffText}
        diffBlocked={diffBlocked}
        diffLoading={diffLoading}
        onLoadDiff={onLoadDiff}
        onClearDiff={onClearDiff}
        gitStatus={gitStatus}
        fileChanges={fileChanges}
      />
    );
  }
  return null;
}
