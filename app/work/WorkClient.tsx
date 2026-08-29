'use client';

/**
 * WORK SURFACE — orchestrator (v1.24 structural rework).
 *
 * Work is governed agency: what the agent intends, what it is allowed to do,
 * what it did, what it costs. Three panes — run list, center tabs, rail.
 * The body moved to focused modules beside this file; every behavior
 * contract test reads the module that owns the behavior. The task row is
 * the truth; the stream is one input.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Message, Task, TaskEvent, Upload } from '@/lib/types';
import { useHotkeys } from '@/components/CommandPalette';
import { Panel, useModKey } from '@/components/ui';
import { DecisionGate } from '@/components/WorkPrimitives';
import type { FlowStage } from '@/components/AgentPrimitives';
import { useWorkRunState } from './useWorkRunState';
import { useWorkspaceDiff } from './useWorkspaceDiff';
import { useGitStatus } from './useGitStatus';
import { useWorkDerived } from './useWorkDerived';
import { useWorkActions } from './useWorkActions';
import { useDecisionCountdown } from './useDecisionCountdown';
import { usePendingMemory } from './usePendingMemory';
import { WorkRunList } from './WorkRunList';
import { WorkRunPane } from './WorkRunPane';
import { WorkCenterHeader } from './WorkCenterHeader';
import { WorkSecondaryTabs } from './WorkSecondaryTabs';
import { WorkComposer } from './WorkComposer';
import { WorkGovernanceRail } from './WorkGovernanceRail';

type CenterTab = 'run' | 'activity' | 'project' | 'preview' | 'context' | 'memory' | 'terminal' | 'diff';

export default function WorkClient({
  runs, task, initialEvents, initialMessages, initialUploads,
  demoMode = false, demoSource = [],
}: {
  runs: { id: string; goal: string; status: string; mode: string }[];
  task: Task;
  initialEvents: TaskEvent[];
  initialMessages: Message[];
  initialUploads: Upload[];
  /** Recorded-demo pacing: reveal events over time instead of all at once. */
  demoMode?: boolean;
  demoSource?: TaskEvent[];
}) {
  const router = useRouter();
  const mod = useModKey();

  const [tab, setTab] = useState<CenterTab>('run');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');

  const diff = useWorkspaceDiff(task.id, initialEvents);
  const { gitStatus, gitStatusLoaded, loadGitStatus } = useGitStatus(task.id);
  // DiffSink holds only stable members (setState fns + a ref), so the
  // memoized identity keeps addEvent — and therefore the SSE subscription —
  // from being torn down and rebuilt on every render. The v1.23 surface
  // subscribed once per task; this must not regress.
  const diffSink = useMemo(
    () => ({ setDiffText: diff.setDiffText, setDiffBlocked: diff.setDiffBlocked, pendingGitDiffRef: diff.pendingGitDiffRef }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const run = useWorkRunState({
    task, initialEvents, initialMessages, initialUploads, demoMode, demoSource,
    router, loadGitStatus, diff: diffSink,
  });
  const status = run.status;
  // The countdown tracks the LIVE status (the stream's), so it mounts after
  // useWorkRunState — unconditional hook, stable order across renders.
  const decisionSeconds = useDecisionCountdown(task, status);
  const derived = useWorkDerived({
    events: run.events, currentRunEvents: run.currentRunEvents,
    currentRunText: run.currentRunText, messages: run.messages, status,
    task, proposedPlan: run.proposedPlan, tick: run.tick,
  });
  const actions = useWorkActions({
    taskId: task.id, setBusy, setStatus: run.setStatus, setProposedPlan: run.setProposedPlan,
  });
  const { pendingMemory, loadPendingMemory } = usePendingMemory(task.id, status);

  const isTerminal = run.isTerminal;
  const isRunning = run.isRunning;
  const isPlanned = status === 'planned';
  // v1.25: the gate renders while a decision is pending REGARDLESS of the
  // countdown — an expired window never executes anything, but the operator's
  // explicit choice stays valid (late decisions are allowed and audited).
  // Hiding the gate at 0s used to strand the operator with no decision UI,
  // a composer that 409ed, and no escape.
  const awaitingDecision =
    status === 'awaiting_decision' && task.decision_state === 'pending';
  const decisionWindowClosed = awaitingDecision && decisionSeconds <= 0;

  /* ── Autoscroll + run-log pinning ── */
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  useEffect(() => {
    if (pinnedRef.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [derived.timeline, run.currentRunText, derived.liveTools.length]);

  const sendFollowUp = () =>
    void actions.sendFollowUp(draft, setDraft, (content) =>
      run.setMessages((prev) => [
        ...prev,
        {
          id: Date.now(), task_id: task.id, role: 'user' as const,
          content, active: 1, created_at: new Date().toISOString(),
        },
      ]),
      () => { pinnedRef.current = true; },
    );

  const openFlowStage = useCallback((stage: FlowStage) => {
    if (stage === 'context') setTab('context');
    else if (stage === 'execute') setTab('activity');
    else setTab('run');
  }, []);

  /* ── Keyboard ── */
  useHotkeys([
    { combo: 'mod+1', run: () => setTab('run') },
    { combo: 'mod+2', run: () => setTab('activity') },
    { combo: 'mod+3', run: () => setTab('project') },
    { combo: 'mod+4', run: () => setTab('preview') },
    { combo: 'mod+5', run: () => setTab('context') },
    { combo: 'mod+6', run: () => setTab('memory') },
    { combo: 'mod+7', run: () => setTab('terminal') },
    { combo: 'mod+8', run: () => setTab('diff') },
    { combo: 'mod+Enter', run: sendFollowUp, allowInInput: true },
  ]);

  const tabs = [
    { id: 'run', label: 'Run', hint: `${mod}+1` },
    { id: 'activity', label: 'Activity', hint: `${mod}+2`, count: derived.activityCount },
    { id: 'project', label: 'Project', hint: `${mod}+3` },
    { id: 'preview', label: 'Preview', hint: `${mod}+4` },
    { id: 'context', label: 'Context', hint: `${mod}+5` },
    { id: 'memory', label: 'Memory', hint: `${mod}+6`, count: pendingMemory },
    { id: 'terminal', label: 'Terminal', hint: `${mod}+7` },
    { id: 'diff', label: 'Diff', hint: `${mod}+8` },
  ];

  return (
    <div className="flex h-full min-h-0">
      <WorkRunList runs={runs} activeTaskId={task.id} />

      {/* ── Center ── */}
      <Panel className="flex-1 border-r">
        <WorkCenterHeader
          tabs={tabs} tab={tab} onTab={setTab}
          flowStages={derived.flowStages} onOpenStage={openFlowStage}
          isRunning={isRunning} busy={busy} onCancel={() => void actions.cancelRun()}
        />

        {awaitingDecision && (
          <DecisionGate
            seconds={decisionSeconds}
            windowClosed={decisionWindowClosed}
            busy={busy}
            onChoose={actions.decide}
          />
        )}

        {tab === 'run' && (
          <>
            <WorkRunPane
              isPlanned={isPlanned && Boolean(run.proposedPlan)}
              proposedPlan={run.proposedPlan} busy={busy}
              onApprove={() => void actions.approve(() => setTab('run'))}
              onReject={(reason) => void actions.reject(reason)}
              timeline={derived.timeline} isRunning={isRunning}
              liveThinking={derived.liveThinking} liveToolsCount={derived.liveTools.length}
              runAnswer={derived.runAnswer} runtime={derived.runtime}
              status={status} errorMessage={derived.errorMessage}
              logRef={logRef} onLogScroll={onLogScroll}
              onInspectTrail={() => setTab('activity')}
            />

            {/* Follow-up composer — only when the agent is idle. */}
            {!isRunning && !isPlanned && !awaitingDecision && (
              <WorkComposer
                taskId={task.id} draft={draft} setDraft={setDraft}
                onSend={sendFollowUp} busy={busy}
                onUploaded={(upload) => run.setUploads((prev) => [...prev, upload as Upload])}
                mod={mod}
              />
            )}
          </>
        )}

        <WorkSecondaryTabs
          tab={tab} task={task} events={run.events}
          isActivityRunning={status === 'running'} isTerminal={isTerminal}
          demoMode={demoMode} demoDone={run.demoDone} demoRevealAllRef={run.demoRevealAllRef}
          diffText={diff.diffText} diffBlocked={diff.diffBlocked} diffLoading={diff.diffLoading}
          onLoadDiff={(path) => void diff.loadWorkspaceDiff(path)} onClearDiff={diff.clearDiff}
          gitStatus={gitStatus} fileChanges={run.fileChanges}
          onMemoryChanged={loadPendingMemory}
        />
      </Panel>

      <WorkGovernanceRail
        task={task} status={status} demoMode={demoMode}
        gitStatus={gitStatus} gitStatusLoaded={gitStatusLoaded}
        creditsSpent={run.creditsSpent} actionCount={derived.toolPairs.length}
        contextPct={run.contextPct} contextTokens={run.contextTokens} contextWindow={run.contextWindow}
        todos={run.todos} filesTouched={derived.filesTouched} uploads={run.uploads}
        isTerminal={isTerminal} isRunning={isRunning} replan={actions.replan}
      />
    </div>
  );
}
