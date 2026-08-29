'use client';

/**
 * Derived view-model for the Work surface — every value the UI reads that is
 * a pure function of run state.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM: same
 * memos, same dependency arrays, same two-channel thinking merge as the chat
 * surface. Nothing here calls the network or mutates state.
 */

import { useMemo } from 'react';
import type { Message, Task } from '@/lib/types';
import {
  buildTimeline,
  latestEventOfType,
  separateThinkTags,
  type ParsedEvent,
} from '@/lib/agent/timeline';
import { deriveChatRuntime } from '@/lib/agent/runtime-state';
import { reasoningTextOf } from '@/components/ThinkingBlock';
import { deriveFlow } from '@/components/AgentPrimitives';
import { pairToolEvents } from '@/components/WorkPrimitives';
import { buildActivityRows } from '@/components/ExecutionTimeline';

export function useWorkDerived({
  events,
  currentRunEvents,
  currentRunText,
  messages,
  status,
  task,
  proposedPlan,
  tick,
}: {
  events: ParsedEvent[];
  currentRunEvents: ParsedEvent[];
  currentRunText: string;
  messages: Message[];
  status: Task['status'];
  task: Task;
  proposedPlan: string;
  tick: number;
}) {
  // Same two-channel thinking merge as the chat surface: native reasoning
  // events + inline <think> tags from proxy gateways, one collapsible block.
  const { reasoning: taggedThinking, answer: runAnswer } = useMemo(
    () => separateThinkTags(currentRunText),
    [currentRunText],
  );
  const liveThinking = useMemo(
    () => [reasoningTextOf(currentRunEvents), taggedThinking].filter(Boolean).join('\n'),
    [currentRunEvents, taggedThinking],
  );
  const timeline = useMemo(
    () => buildTimeline({ events, messages, status, goal: task.goal }),
    [events, messages, status, task.goal],
  );

  // Xeo Flow: derived only from observable state, never a step counter.
  const flowStages = useMemo(
    () =>
      deriveFlow({
        status,
        mode: task.mode,
        hasContextEvent: events.some((e) => e.type === 'context' || e.type === 'context_layers'),
        hasPlan: Boolean(proposedPlan),
        hasApprovedPlan: Boolean(task.approved_plan),
        hasToolActivity: events.some((e) => e.type === 'tool_call'),
      }),
    [status, task.mode, task.approved_plan, events, proposedPlan],
  );

  const toolPairs = useMemo(() => pairToolEvents(events), [events]);
  // Rows the Activity timeline will actually render, so the tab badge matches.
  const activityCount = useMemo(() => buildActivityRows(events).length, [events]);
  const liveTools = useMemo(() => pairToolEvents(currentRunEvents), [currentRunEvents]);

  const runtime = useMemo(
    () => deriveChatRuntime({ status, currentRunEvents, now: tick }),
    [status, currentRunEvents, tick],
  );

  const errorEvent = latestEventOfType(events, 'error');
  const errorMessage = errorEvent ? String(errorEvent.data.message ?? 'The run failed.') : '';
  const filesTouched = useMemo(() => {
    const set = new Set<string>();
    for (const { call } of toolPairs) {
      const name = String(call.data.name);
      if (name !== 'file_write' && name !== 'file_edit') continue;
      const args = call.data.args as unknown as Record<string, unknown> | undefined;
      if (args && typeof args.path === 'string') set.add(args.path);
    }
    return Array.from(set);
  }, [toolPairs]);

  return {
    taggedThinking,
    runAnswer,
    liveThinking,
    timeline,
    flowStages,
    toolPairs,
    activityCount,
    liveTools,
    runtime,
    errorMessage,
    filesTouched,
  };
}
