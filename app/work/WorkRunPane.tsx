'use client';

/**
 * Work run pane — the center "Run" tab: the timeline of turns, the live
 * thinking block, the runtime banner, the empty state, and the honest
 * failure panel.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM: same
 * markup, same conditionals, same copy. The ThinkingBlock mount is pinned by
 * test/loop-guards (reasoning deltas must render).
 */

import type { Ref } from 'react';
import type { Task } from '@/lib/types';
import { renderMarkdown } from '@/lib/markdown';
import { formatElapsed } from '@/lib/agent/runtime-state';
import { PlanReview, pairToolEvents, ToolRow } from '@/components/WorkPrimitives';
import { RuntimeBanner } from '@/components/AgentPrimitives';
import { IconX } from '@/components/icons';
import { ThinkingBlock } from '@/components/ThinkingBlock';
import type { buildTimeline } from '@/lib/agent/timeline';

type TimelineTurn = ReturnType<typeof buildTimeline>[number];

export function WorkRunPane({
  isPlanned,
  proposedPlan,
  busy,
  onApprove,
  onReject,
  timeline,
  isRunning,
  liveThinking,
  liveToolsCount,
  runAnswer,
  runtime,
  status,
  errorMessage,
  logRef,
  onLogScroll,
  onInspectTrail,
}: {
  isPlanned: boolean;
  proposedPlan: string;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
  timeline: TimelineTurn[];
  isRunning: boolean;
  liveThinking: string;
  liveToolsCount: number;
  runAnswer: string;
  runtime: ReturnType<typeof import('@/lib/agent/runtime-state').deriveChatRuntime>;
  status: Task['status'];
  errorMessage: string;
  logRef: Ref<HTMLDivElement>;
  onLogScroll: () => void;
  onInspectTrail: () => void;
}) {
  if (isPlanned && proposedPlan) {
    return <PlanReview plan={proposedPlan} busy={busy} onApprove={onApprove} onReject={onReject} />;
  }
  return (
    <div ref={logRef} onScroll={onLogScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {timeline.length === 0 && !isRunning ? (
          <div className="run-empty mx-auto mt-16 flex max-w-md flex-col items-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-panel border border-line-subtle bg-ink-900/60" aria-hidden="true">
              <span className="ember-rule" />
            </span>
            <h3 className="mt-5 text-title font-semibold text-content-primary">Nothing has run yet</h3>
            <p className="mt-2 text-body leading-6 text-content-muted">
              Describe the change below and start a planning run. The agent inspects read-only first —
              you approve before anything is written.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {timeline.map((turn) => (
              <div key={turn.id}>
                {turn.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-modal rounded-br-md bg-signal-plan/1 px-3.5 py-2.5 text-body leading-6 text-signal-plan">
                      <p className="whitespace-pre-wrap">{turn.content}</p>
                    </div>
                  </div>
                ) : turn.role === 'system' ? (
                  <div className="rounded-control border border-line-subtle bg-ink-700/60 px-3 py-2">
                    <p className="text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
                      Context compacted
                    </p>
                    <p className="mt-1 text-ui leading-5 text-content-muted">{turn.content}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {turn.toolEvents && turn.toolEvents.length > 0 && (
                      <div className="overflow-hidden rounded-control border border-line-subtle bg-black/15">
                        {pairToolEvents(turn.toolEvents).map(({ call, result }) => (
                          <ToolRow key={call.seq} call={call} result={result} />
                        ))}
                      </div>
                    )}
                    {turn.content && (
                      <div
                        className="markdown-content text-body leading-6 text-content-secondary"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.content) }}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}

            {isRunning && liveThinking && (
              <ThinkingBlock text={liveThinking} live />
            )}
            {isRunning && liveToolsCount === 0 && !runAnswer && (
              <RuntimeBanner
                label={runtime.label}
                detail={runtime.detail}
                elapsed={
                  runtime.sinceLastEventMs !== null
                    ? formatElapsed(runtime.sinceLastEventMs)
                    : undefined
                }
                stalled={runtime.stalled}
              />
            )}
          </div>
        )}

        {status === 'failed' && errorMessage && (
          <div className="run-failure mt-6 rounded-panel border border-signal-fail/25 bg-signal-fail/[0.05] p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-signal-fail/15 text-ui text-signal-fail" aria-hidden="true"><IconX size={14} /></span>
              <p className="text-ui font-semibold text-content-primary">Run failed</p>
            </div>
            <p className="mt-2.5 max-w-2xl text-body leading-6 text-content-secondary">{errorMessage}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-signal-fail/15 pt-3.5">
              <p className="text-meta text-content-muted">Every step before the failure is preserved in the Activity tab — nothing was lost.</p>
              <span className="flex-1" />
              <button
                type="button"
                onClick={onInspectTrail}
                className="rounded-control border border-line-subtle px-3 py-1.5 text-meta font-medium text-content-secondary transition hover:border-line-strong hover:text-content-primary"
              >
                Inspect the trail
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
