/**
 * Task timeline derivation — the canonical implementation.
 *
 * The task page renders a conversation timeline from two sources: persisted
 * `messages` (authoritative for finished runs) and `task_events` (the live
 * stream for the run in progress). Deciding which wins, where one run ends and
 * the next begins, and which tool events belong to which assistant turn is
 * pure logic with real edge cases — so it lives here rather than inline in a
 * React component.
 *
 * Previously this logic was inline in TaskClient.tsx and the unit tests carried
 * their own divergent copy (it used `messages.slice(1)`, while the component
 * renders every message). The tests passed against a version of the timeline
 * that no longer existed. This module is now the single source of truth
 * (AGENTS.md rule 1) and both the component and the tests import it.
 */

import type { Message, TaskEvent, TaskStatus } from '../types';

/** A task_event with its JSON payload parsed and its timestamp resolved. */
export interface ParsedEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
  /** epoch ms — from DB created_at on replay, receipt time for live events. */
  ts: number;
}

export interface TimelineTurn {
  /** Message id, or a negative sentinel for synthetic turns. */
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolEvents?: ParsedEvent[];
}

/** Synthetic turn id for the in-progress streaming assistant response. */
export const CURRENT_RUN_TURN_ID = -1;

/** Synthetic turn id for a reconstructed goal turn on legacy threads. */
export const SYNTHETIC_GOAL_TURN_ID = -2;

/** Event types that render inside an assistant turn's tool strip. */
const TOOL_EVENT_TYPES = new Set(['tool_call', 'tool_result']);

/**
 * Parse persisted or streamed events. Malformed JSON is preserved under `raw`
 * rather than dropped — a corrupted payload must stay visible in the audit
 * trail (AGENTS.md rule 3).
 */
export function parseEvents(events: TaskEvent[]): ParsedEvent[] {
  return events.map((e) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(e.content) as Record<string, unknown>;
    } catch {
      data = { raw: e.content };
    }
    const ts = e.created_at ? Date.parse(e.created_at) : Date.now();
    return { seq: e.seq, type: e.type, data, ts: Number.isFinite(ts) ? ts : Date.now() };
  });
}

export function isToolEvent(event: ParsedEvent): boolean {
  return TOOL_EVENT_TYPES.has(event.type);
}

/** A task is terminal when no further agent work is pending. */
export function isTerminalStatus(status: TaskStatus | string): boolean {
  return status === 'completed' || status === 'failed';
}

/** SSE stays open for any non-terminal status, including 'planned'. */
export function shouldStreamStatus(status: TaskStatus | string): boolean {
  return !isTerminalStatus(status);
}

export function isRunningStatus(status: TaskStatus | string): boolean {
  return status === 'running' || status === 'pending';
}

/**
 * Follow-up messages are accepted on any task that is not mid-run. Completed,
 * failed, and planned tasks all accept them; running and pending do not.
 */
export function canFollowUp(status: TaskStatus | string): boolean {
  return !isRunningStatus(status);
}

/**
 * The seq of the last `done` event, or 0 when the task has never finished a
 * run. Everything after it belongs to the run currently in progress.
 */
export function lastDoneSeq(events: ParsedEvent[]): number {
  let max = 0;
  for (const e of events) {
    if (e.type === 'done' && e.seq > max) max = e.seq;
  }
  return max;
}

export interface RunSplit {
  /** Events belonging to the run in progress (seq > lastDoneSeq). */
  currentRunEvents: ParsedEvent[];
  /** Concatenated text deltas of the run in progress. */
  currentRunText: string;
  /** Tool events of the run in progress. */
  currentRunToolEvents: ParsedEvent[];
  /** Tool events of each finished run, indexed by run order. */
  completedRunToolEvents: ParsedEvent[][];
}

/**
 * Split an event stream at run boundaries. Finished runs are delimited by
 * `done` events; anything after the last one is the live run.
 */
export function splitRuns(events: ParsedEvent[]): RunSplit {
  const boundary = lastDoneSeq(events);
  const currentRunEvents = events.filter((e) => e.seq > boundary);

  const currentRunText = currentRunEvents
    .filter((e) => e.type === 'text')
    .map((e) => (typeof e.data.delta === 'string' ? e.data.delta : ''))
    .join('');

  const currentRunToolEvents = currentRunEvents.filter(isToolEvent);

  const completedRunToolEvents: ParsedEvent[][] = [];
  let prevSeq = 0;
  for (const doneEvent of events.filter((e) => e.type === 'done')) {
    completedRunToolEvents.push(
      events.filter((e) => isToolEvent(e) && e.seq > prevSeq && e.seq <= doneEvent.seq),
    );
    prevSeq = doneEvent.seq;
  }

  return { currentRunEvents, currentRunText, currentRunToolEvents, completedRunToolEvents };
}

/**
 * Remove the framing the agent loop adds before sending a turn to the model.
 * `<user_task>` tags are prompt-injection containment, and the leading `Task:`
 * label belongs to the goal turn only — neither should reach the UI.
 */
export function stripTurnFraming(content: string, isFirstTurn: boolean): string {
  let out = content.replace(/^<user_task>\n?/, '').replace(/\n?<\/user_task>$/, '');
  if (isFirstTurn && out.startsWith('Task:\n')) out = out.slice(6);
  return out;
}

export interface BuildTimelineArgs {
  events: ParsedEvent[];
  messages: Message[];
  status: TaskStatus | string;
  /** Task goal, used to reconstruct the opening turn on legacy threads. */
  goal: string;
}

/**
 * Build the rendered timeline.
 *
 * Persisted messages are authoritative for finished runs; tool events from each
 * finished run are attached to that run's assistant turn in order. When the task
 * is mid-run, the streaming text and tool events are appended as one synthetic
 * assistant turn so the user sees progress before it is persisted.
 */
export function buildTimeline({ events, messages, status, goal }: BuildTimelineArgs): TimelineTurn[] {
  const { currentRunText, currentRunToolEvents, completedRunToolEvents } = splitRuns(events);

  // Older threads may have been created before the API persisted the opening
  // turn. Keep them readable instead of rendering an apparently empty chat.
  const sourceMessages: Pick<Message, 'id' | 'role' | 'content'>[] =
    messages.length > 0
      ? messages
      : [{ id: SYNTHETIC_GOAL_TURN_ID, role: 'user', content: goal }];

  const turns: TimelineTurn[] = sourceMessages.map((msg, i) => ({
    id: msg.id,
    role: msg.role as TimelineTurn['role'],
    content: stripTurnFraming(msg.content, i === 0),
    toolEvents: undefined,
  }));

  // Attach each finished run's tool events to that run's assistant turn.
  let assistantIdx = 0;
  for (const turn of turns) {
    if (turn.role !== 'assistant') continue;
    const runEvents = completedRunToolEvents[assistantIdx];
    if (runEvents && runEvents.length > 0) turn.toolEvents = runEvents;
    assistantIdx++;
  }

  if (isRunningStatus(status) && (currentRunText || currentRunToolEvents.length > 0)) {
    turns.push({
      id: CURRENT_RUN_TURN_ID,
      role: 'assistant',
      content: currentRunText,
      toolEvents: currentRunToolEvents.length > 0 ? currentRunToolEvents : undefined,
    });
  }

  return turns;
}

/* ── Plan → Execute → Verify phase ─────────────────────────────────── */

export type Phase = 'plan' | 'execute' | 'verify' | 'done';

export interface DerivePhaseArgs {
  status: TaskStatus | string;
  isChat: boolean;
  currentRunEvents: ParsedEvent[];
}

/**
 * Derive the visual phase purely from existing state and events. This is
 * presentation only — it never influences the agent loop.
 */
export function derivePhase({ status, isChat, currentRunEvents }: DerivePhaseArgs): Phase {
  if (isTerminalStatus(status)) return 'done';
  if (!isChat && status === 'planned') return 'plan';
  if (currentRunEvents.some((e) => e.type === 'verification')) return 'verify';
  if (currentRunEvents.some(isToolEvent)) return 'execute';
  return 'plan';
}

/** The most recent event of a given type, or undefined. */
export function latestEventOfType(events: ParsedEvent[], type: string): ParsedEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) return events[i];
  }
  return undefined;
}
