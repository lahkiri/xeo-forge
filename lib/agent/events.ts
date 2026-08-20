/**
 * Agent event registry — the single frontend/backend contract for task events.
 *
 * WHY THIS EXISTS: `WorkClient` and `ChatClient` each carried their own
 * hardcoded array of event type strings passed to `EventSource.addEventListener`.
 * When v1.10.0 added `context_layers`, `memory`, and `memory_decision`, neither
 * array was updated, so the events were persisted, streamed, and then silently
 * dropped by the browser. A signature trust feature was invisible because of a
 * stale string literal in a component.
 *
 * Every event the backend emits is declared here exactly once, with its payload
 * shape and whether a surface subscribes to it. Adding a `emitTaskEvent` call
 * without adding it here will fail the registry test.
 */

/** Every event type the agent loop, runner, or routes can emit. */
export const AGENT_EVENT_TYPES = [
  'task_status',
  'mode',
  'intent',
  'plan',
  'text',
  'reasoning',
  'tool_call',
  'tool_result',
  'credits',
  'context',
  'context_layers',
  'compaction',
  'model_retry',
  'error',
  'done',
  'upload',
  'todo_update',
  'verification',
  'file_activity',
  'memory',
  'memory_decision',
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

const EVENT_TYPE_SET = new Set<string>(AGENT_EVENT_TYPES);

export function isAgentEventType(value: string): value is AgentEventType {
  return EVENT_TYPE_SET.has(value);
}

/**
 * Which surfaces subscribe to each event.
 *
 * `chat` is read-only conversation: it needs lifecycle, text, read-tool activity
 * (so runtime state can say "Reading project context" rather than a spinner),
 * and context proof. It deliberately does NOT subscribe to plan/approval events
 * because Chat cannot plan.
 *
 * `work` subscribes to everything — it is the supervision surface.
 */
export interface EventDescriptor {
  /** What this event means, in product terms. */
  purpose: string;
  surfaces: ('chat' | 'work')[];
}

export const AGENT_EVENTS: Record<AgentEventType, EventDescriptor> = {
  task_status: { purpose: 'Server-authoritative task status transition.', surfaces: ['chat', 'work'] },
  mode: { purpose: 'Task mode changed (chat/planning/build).', surfaces: ['work'] },
  intent: { purpose: 'Deterministic intent classification result.', surfaces: ['work'] },
  plan: { purpose: 'Proposed plan text for review.', surfaces: ['work'] },
  text: { purpose: 'Streamed assistant output delta.', surfaces: ['chat', 'work'] },
  reasoning: { purpose: 'Streamed reasoning delta, where the provider emits it.', surfaces: ['chat', 'work'] },
  tool_call: { purpose: 'A tool was dispatched, with its arguments.', surfaces: ['chat', 'work'] },
  tool_result: { purpose: 'A tool returned, with success state and output.', surfaces: ['chat', 'work'] },
  credits: { purpose: 'Running credit total for the task.', surfaces: ['work'] },
  context: { purpose: 'Context window usage for the current iteration.', surfaces: ['chat', 'work'] },
  context_layers: { purpose: 'Which approved memories and instructions actually reached the prompt.', surfaces: ['chat', 'work'] },
  compaction: { purpose: 'Older messages were archived into a summary.', surfaces: ['chat', 'work'] },
  model_retry: { purpose: 'A provider request is being retried, with attempt and reason.', surfaces: ['chat', 'work'] },
  error: { purpose: 'Run failed, with a classified message.', surfaces: ['chat', 'work'] },
  done: { purpose: 'Run reached a terminal state, with the result summary.', surfaces: ['chat', 'work'] },
  upload: { purpose: 'Upload status changed during quarantine or extraction.', surfaces: ['work'] },
  todo_update: { purpose: 'The agent revised its checklist.', surfaces: ['work'] },
  verification: { purpose: 'A deterministic check passed or failed.', surfaces: ['work'] },
  file_activity: { purpose: 'A workspace file was created, edited, or deleted.', surfaces: ['work'] },
  memory: { purpose: 'A memory candidate was proposed. NOT yet in context.', surfaces: ['work'] },
  memory_decision: { purpose: 'The user kept, rejected, or deleted a memory.', surfaces: ['work'] },
};

/** Event types a surface should subscribe to. Use this, never a literal array. */
export function eventTypesFor(surface: 'chat' | 'work'): AgentEventType[] {
  return AGENT_EVENT_TYPES.filter((type) => AGENT_EVENTS[type].surfaces.includes(surface));
}

/* ------------------------------------------------------------------ */
/*  Payload accessors                                                  */
/*                                                                     */
/*  Event payloads are persisted as JSON, so they arrive as unknown.    */
/*  These readers are the one place that knows each shape — components  */
/*  must not index into `data` directly and guess at key names.         */
/* ------------------------------------------------------------------ */

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface ContextLayersPayload {
  instructions: { id: string; name: string; scope: string; priority?: number }[];
  memories: { id: string; kind: string; scope: string; confidence?: number; content: string }[];
}

export function readContextLayers(data: Record<string, unknown>): ContextLayersPayload {
  const instructions = Array.isArray(data.instructions) ? data.instructions : [];
  const memories = Array.isArray(data.memories) ? data.memories : [];
  return {
    instructions: instructions.flatMap((raw) => {
      const row = raw as Record<string, unknown>;
      const id = str(row.id);
      const name = str(row.name);
      if (!id || !name) return [];
      return [{ id, name, scope: str(row.scope) ?? 'global', priority: num(row.priority) }];
    }),
    memories: memories.flatMap((raw) => {
      const row = raw as Record<string, unknown>;
      const id = str(row.id);
      if (!id) return [];
      return [{
        id,
        kind: str(row.kind) ?? 'memory',
        scope: str(row.scope) ?? 'global',
        confidence: num(row.confidence),
        content: str(row.content) ?? '',
      }];
    }),
  };
}

export interface ToolCallPayload {
  name: string;
  /** The most identifying argument: a path, URL, command, or action. */
  target?: string;
}

export function readToolCall(data: Record<string, unknown>): ToolCallPayload {
  const args = (data.args ?? {}) as Record<string, unknown>;
  return {
    name: str(data.name) ?? 'tool',
    target:
      str(args.path) ??
      str(args.url) ??
      str(args.command)?.slice(0, 120) ??
      str(args.action) ??
      str(args.code)?.split('\n')[0]?.slice(0, 120),
  };
}

export interface ToolResultPayload {
  name?: string;
  ok: boolean;
  output: string;
}

export function readToolResult(data: Record<string, unknown>): ToolResultPayload {
  const ok = data.ok !== false;
  return {
    name: str(data.name),
    ok,
    output: ok ? String(data.result ?? '') : String(data.error ?? 'failed'),
  };
}

export interface ContextUsagePayload {
  usedTokens?: number;
  contextWindow?: number;
  percentage?: number;
  threshold?: number;
}

export function readContextUsage(data: Record<string, unknown>): ContextUsagePayload {
  return {
    usedTokens: num(data.used_tokens),
    contextWindow: num(data.context_window),
    percentage: num(data.percentage),
    threshold: num(data.threshold),
  };
}

export interface RetryPayload {
  attempt?: number;
  reason?: string;
}

export function readRetry(data: Record<string, unknown>): RetryPayload {
  return { attempt: num(data.attempt), reason: str(data.reason) };
}

export interface VerificationPayload {
  status: string;
  message?: string;
  attempt?: number;
}

export function readVerification(data: Record<string, unknown>): VerificationPayload {
  return {
    status: str(data.status) ?? 'unknown',
    message: str(data.message),
    attempt: num(data.attempt),
  };
}

export interface FileActivityPayload {
  action: string;
  path?: string;
}

export function readFileActivity(data: Record<string, unknown>): FileActivityPayload {
  return { action: str(data.action) ?? 'changed', path: str(data.path) };
}

export interface CompactionPayload {
  archived?: number;
  beforePercentage?: number;
  afterPercentage?: number;
}

export function readCompaction(data: Record<string, unknown>): CompactionPayload {
  return {
    archived: num(data.archived),
    beforePercentage: num(data.before_percentage),
    afterPercentage: num(data.after_percentage),
  };
}

export interface MemoryProposalPayload {
  memoryId?: string;
  status?: string;
  kind?: string;
  scope?: string;
  content?: string;
}

export function readMemoryProposal(data: Record<string, unknown>): MemoryProposalPayload {
  return {
    memoryId: str(data.memory_id),
    status: str(data.status),
    kind: str(data.kind),
    scope: str(data.scope),
    content: str(data.content),
  };
}

export interface MemoryDecisionPayload {
  memoryId?: string;
  decision?: string;
  status?: string;
}

export function readMemoryDecision(data: Record<string, unknown>): MemoryDecisionPayload {
  return {
    memoryId: str(data.memory_id),
    decision: str(data.decision),
    status: str(data.status),
  };
}

/* ------------------------------------------------------------------ */
/*  Human-readable activity labels                                     */
/*                                                                     */
/*  One mapping from event to product language, so the timeline, the    */
/*  runtime banner, and the activity list cannot describe the same      */
/*  event differently.                                                 */
/* ------------------------------------------------------------------ */

export type ActivityTone = 'neutral' | 'active' | 'good' | 'warn' | 'bad';

export interface ActivityLabel {
  title: string;
  detail?: string;
  tone: ActivityTone;
}

const READ_TOOLS = new Set(['file_read', 'file_list']);

export function describeEvent(type: string, data: Record<string, unknown>): ActivityLabel | null {
  switch (type) {
    case 'context_layers': {
      const { instructions, memories } = readContextLayers(data);
      const parts: string[] = [];
      if (instructions.length) parts.push(`${instructions.length} instruction${instructions.length === 1 ? '' : 's'}`);
      if (memories.length) parts.push(`${memories.length} memor${memories.length === 1 ? 'y' : 'ies'}`);
      return { title: 'Context compiled', detail: parts.join(' · ') || undefined, tone: 'good' };
    }
    case 'context': {
      const usage = readContextUsage(data);
      if (usage.usedTokens === undefined) return null;
      return {
        title: 'Context measured',
        detail: usage.contextWindow
          ? `${usage.usedTokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens`
          : `${usage.usedTokens.toLocaleString()} tokens`,
        tone: 'neutral',
      };
    }
    case 'tool_call': {
      const call = readToolCall(data);
      const reading = READ_TOOLS.has(call.name);
      return {
        title: reading ? 'Reading project context' : `Running ${call.name}`,
        detail: call.target,
        tone: 'active',
      };
    }
    case 'tool_result': {
      const result = readToolResult(data);
      return {
        title: result.ok ? `${result.name ?? 'Tool'} completed` : `${result.name ?? 'Tool'} failed`,
        detail: result.ok ? undefined : result.output.slice(0, 120),
        tone: result.ok ? 'good' : 'bad',
      };
    }
    case 'file_activity': {
      const activity = readFileActivity(data);
      return { title: `File ${activity.action}`, detail: activity.path, tone: 'good' };
    }
    case 'verification': {
      const check = readVerification(data);
      const passed = check.status === 'pass';
      return {
        title: passed ? 'Verification passed' : 'Verification failed',
        detail: check.message,
        tone: passed ? 'good' : 'warn',
      };
    }
    case 'compaction': {
      const compaction = readCompaction(data);
      return {
        title: 'Conversation compacted',
        detail: compaction.archived ? `${compaction.archived} messages archived` : undefined,
        tone: 'neutral',
      };
    }
    case 'model_retry': {
      const retry = readRetry(data);
      return {
        title: retry.attempt ? `Retrying the provider (attempt ${retry.attempt})` : 'Retrying the provider',
        detail: retry.reason,
        tone: 'warn',
      };
    }
    case 'plan':
      return { title: 'Plan proposed', detail: 'Awaiting your approval', tone: 'warn' };
    case 'intent': {
      const kind = str(data.kind) ?? str(data.intent_kind);
      return { title: 'Intent classified', detail: kind, tone: 'neutral' };
    }
    case 'mode': {
      const mode = str(data.mode);
      return { title: 'Mode changed', detail: mode, tone: 'neutral' };
    }
    case 'memory':
      return { title: 'Memory proposed', detail: 'Not in context until you keep it', tone: 'warn' };
    case 'memory_decision': {
      const decision = readMemoryDecision(data);
      return { title: `Memory ${decision.decision ?? 'decided'}`, tone: 'neutral' };
    }
    case 'todo_update': {
      const items = Array.isArray(data.items) ? data.items.length : 0;
      return { title: 'Checklist updated', detail: `${items} item${items === 1 ? '' : 's'}`, tone: 'neutral' };
    }
    case 'upload': {
      const status = str(data.status);
      return { title: 'Upload updated', detail: status, tone: 'neutral' };
    }
    case 'credits': {
      const spent = num(data.spent);
      return spent === undefined ? null : { title: 'Credits spent', detail: String(spent), tone: 'neutral' };
    }
    case 'error':
      return { title: 'Run failed', detail: str(data.message), tone: 'bad' };
    case 'done': {
      const status = str(data.status) ?? 'finished';
      return { title: status === 'completed' ? 'Completed' : `Run ${status}`, tone: status === 'completed' ? 'good' : 'bad' };
    }
    // text/reasoning/task_status carry no standalone timeline entry — they are
    // rendered as the message stream and the status badge instead.
    default:
      return null;
  }
}
