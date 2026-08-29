'use client';

/**
 * Center header — tabs, the Xeo Flow stage trail, and the Cancel control.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM: clickable
 * stages open the surface that explains them; Cancel renders only while a
 * run is live (pinned by test/cancellation).
 */

import { Button, Tabs } from '@/components/ui';
import { XeoFlow, type FlowStage } from '@/components/AgentPrimitives';

type CenterTab =
  | 'run' | 'activity' | 'project' | 'preview'
  | 'context' | 'memory' | 'terminal' | 'diff';

export function WorkCenterHeader({
  tabs,
  tab,
  onTab,
  flowStages,
  onOpenStage,
  isRunning,
  busy,
  onCancel,
}: {
  tabs: { id: string; label: string; hint: string; count?: number }[];
  tab: CenterTab;
  onTab: (id: CenterTab) => void;
  flowStages: Parameters<typeof XeoFlow>[0]['stages'];
  onOpenStage: (stage: FlowStage) => void;
  isRunning: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line-subtle px-3">
      <Tabs items={tabs} active={tab} onChange={(id) => onTab(id as CenterTab)} />
      <div className="hidden min-w-0 items-center gap-3 lg:flex">
        {/* Clickable stage trail: each stage opens the surface that explains
            it, so progress is navigation rather than decoration. Overflow-safe:
            the trail can shrink (scroll-x) instead of clipping under the tabs. */}
        <div className="min-w-0 overflow-x-auto">
          <XeoFlow stages={flowStages} onOpen={onOpenStage} />
        </div>
        {isRunning && (
          <Button size="sm" variant="secondary" onClick={onCancel} loading={busy} className="ml-1">
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
