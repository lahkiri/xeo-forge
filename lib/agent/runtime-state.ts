/**
 * Chat runtime states — truthful lifecycle instead of a generic "thinking…".
 *
 * A spinner that never changes hides two very different situations: the agent
 * reading a file, and the provider having stalled for 40 seconds. The user needs
 * to know which one they are looking at, and what action is available.
 *
 * Derivation is deterministic from the event stream: the last event type, its
 * payload, and how long ago it arrived. Nothing is inferred by a model.
 */

import type { ParsedEvent } from './timeline';

export type ChatRuntimeState =
  | 'idle'
  | 'queued'
  | 'connecting'
  | 'reading_context'
  | 'using_tool'
  | 'receiving'
  | 'waiting_for_provider'
  | 'retrying'
  | 'compacting'
  | 'completed'
  | 'failed';

export interface ChatRuntimeStatus {
  state: ChatRuntimeState;
  /** Short human label, e.g. "Reading project context". */
  label: string;
  /** The specific thing happening now, e.g. a file path or tool name. */
  detail?: string;
  /** Milliseconds since the most recent event, or null when there are none. */
  sinceLastEventMs: number | null;
  /** True when the provider has been silent past the stall threshold. */
  stalled: boolean;
  /** Whether a Stop action is meaningful in this state. */
  canStop: boolean;
  /** Whether a Retry action is meaningful in this state. */
  canRetry: boolean;
}

/**
 * How long the provider may be silent before we say so. Below this, silence is
 * normal streaming latency; above it, the user deserves an explanation and an
 * escape hatch.
 */
export const PROVIDER_STALL_MS = 10_000;

const READ_TOOLS = new Set(['file_read', 'file_list']);

function toolDetail(event: ParsedEvent): string | undefined {
  const args = event.data.args as Record<string, unknown> | undefined;
  if (args) {
    if (typeof args.path === 'string') return args.path;
    if (typeof args.url === 'string') return args.url;
    if (typeof args.action === 'string') return args.action;
  }
  const name = event.data.name;
  return typeof name === 'string' ? name : undefined;
}

/**
 * Derive the chat runtime status.
 *
 * `status` is the authoritative task status from the server; events refine it
 * into what is happening right now. The server always wins on terminal state —
 * the UI never invents completion.
 */
export function deriveChatRuntime(input: {
  status: string;
  currentRunEvents: ParsedEvent[];
  now?: number;
}): ChatRuntimeStatus {
  const now = input.now ?? Date.now();
  const events = input.currentRunEvents;
  const last = events.length > 0 ? events[events.length - 1] : undefined;
  const sinceLastEventMs = last ? Math.max(0, now - last.ts) : null;

  if (input.status === 'completed') {
    return { state: 'completed', label: 'Done', sinceLastEventMs, stalled: false, canStop: false, canRetry: false };
  }
  if (input.status === 'failed') {
    return { state: 'failed', label: 'Failed', sinceLastEventMs, stalled: false, canStop: false, canRetry: true };
  }
  if (input.status !== 'running' && input.status !== 'pending') {
    return { state: 'idle', label: 'Ready', sinceLastEventMs, stalled: false, canStop: false, canRetry: false };
  }

  // Running or pending from here on.
  const stalled = sinceLastEventMs !== null && sinceLastEventMs >= PROVIDER_STALL_MS;

  if (!last) {
    // Accepted by the server but nothing has streamed yet.
    return {
      state: input.status === 'pending' ? 'queued' : 'connecting',
      label: input.status === 'pending' ? 'Queued' : 'Connecting to the model',
      sinceLastEventMs,
      stalled: false,
      canStop: true,
      canRetry: false,
    };
  }

  // A model_retry event is the most informative thing we can show.
  if (last.type === 'model_retry') {
    const attempt = typeof last.data.attempt === 'number' ? last.data.attempt : undefined;
    const reason = typeof last.data.reason === 'string' ? last.data.reason : undefined;
    return {
      state: 'retrying',
      label: attempt ? `Retrying the model request (attempt ${attempt})` : 'Retrying the model request',
      detail: reason,
      sinceLastEventMs,
      stalled: false,
      canStop: true,
      canRetry: false,
    };
  }

  if (last.type === 'compaction') {
    return {
      state: 'compacting',
      label: 'Compacting the conversation to free context',
      sinceLastEventMs,
      stalled: false,
      canStop: true,
      canRetry: false,
    };
  }

  if (last.type === 'tool_call') {
    const name = typeof last.data.name === 'string' ? last.data.name : '';
    const reading = READ_TOOLS.has(name);
    return {
      state: reading ? 'reading_context' : 'using_tool',
      label: reading ? 'Reading project context' : `Using ${name || 'a tool'}`,
      detail: toolDetail(last),
      sinceLastEventMs,
      stalled,
      canStop: true,
      canRetry: false,
    };
  }

  if (last.type === 'tool_result') {
    // A finished tool with no follow-up yet means we are back on the provider.
    return {
      state: stalled ? 'waiting_for_provider' : 'receiving',
      label: stalled ? 'Waiting for the model to respond' : 'Working',
      sinceLastEventMs,
      stalled,
      canStop: true,
      canRetry: stalled,
    };
  }

  if (last.type === 'text' || last.type === 'reasoning') {
    return {
      state: stalled ? 'waiting_for_provider' : 'receiving',
      label: stalled ? 'Waiting for the model to respond' : 'Writing the answer',
      sinceLastEventMs,
      stalled,
      canStop: true,
      canRetry: stalled,
    };
  }

  // Any other event type (context, task_status, intent, …) — the run is alive
  // but has not produced user-visible output yet.
  return {
    state: stalled ? 'waiting_for_provider' : 'connecting',
    label: stalled ? 'Waiting for the model to respond' : 'Preparing',
    sinceLastEventMs,
    stalled,
    canStop: true,
    canRetry: stalled,
  };
}

/** Format elapsed milliseconds as m:ss for a live timer. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
