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
  'thinking_level',
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
  'decision',
  'model_switch',
  'git_status',
  'git_commit',
  'terminal',
  'hook',
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
/** Product language for intent kinds (single mapping, same pattern as
 *  WorkClient's INTENT_LABEL - kept here too so describeEvent never leaks
 *  machine tokens into the timeline). */
const INTENT_PRODUCT_LABEL: Record<string, string> = {
  conversation: 'ordinary conversation',
  explicit_plan: 'planning requested',
  direct_execution: 'direct execution',
  clarification_needed: 'needs your choice',
};

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
  thinking_level: { purpose: 'The thinking-effort level this run executes at, with its honest native/simulated classification.', surfaces: ['chat', 'work'] },
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
  decision: { purpose: 'A recorded operator decision on a run (approve/reject).', surfaces: ['work'] },
  model_switch: { purpose: 'The operator switched the provider/model for this task; the audit trail records old → new.', surfaces: ['work'] },
  // Git and terminal are Work-only. Both are supervision of a real repository and
  // a real host process; Chat cannot reach either, so subscribing there would
  // advertise an authority that surface does not have.
  git_status: { purpose: 'Repository state after a git operation: branch, dirty count, last commit.', surfaces: ['work'] },
  git_commit: { purpose: 'A commit was created in the task workspace.', surfaces: ['work'] },
  terminal: { purpose: 'A terminal session opened, closed, or was terminated with the task.', surfaces: ['work'] },
  hook: { purpose: 'A lifecycle hook fired: audit trail entry, guardrail check, or completion evidence.', surfaces: ['work', 'chat'] },
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

/**
 * Git status payload. `branch` is null on a detached HEAD, which is a real state
 * the agent can reach via `git_op checkout <sha>` — the reader must not invent a
 * branch name for it, so the governance rail can say "detached" truthfully.
 */
export interface GitStatusPayload {
  branch?: string;
  detached: boolean;
  dirtyCount: number;
  staged?: number;
  unstaged?: number;
  untracked?: number;
  lastCommitHash?: string;
  lastCommitSubject?: string;
}

export function readGitStatus(data: Record<string, unknown>): GitStatusPayload {
  return {
    branch: str(data.branch),
    detached: data.detached === true,
    dirtyCount: num(data.dirty_count) ?? 0,
    staged: num(data.staged),
    unstaged: num(data.unstaged),
    untracked: num(data.untracked),
    lastCommitHash: str(data.last_commit_hash),
    lastCommitSubject: str(data.last_commit_subject),
  };
}

export interface GitCommitPayload {
  hash?: string;
  subject?: string;
  filesChanged?: number;
}

export function readGitCommit(data: Record<string, unknown>): GitCommitPayload {
  return {
    hash: str(data.hash),
    subject: str(data.subject),
    filesChanged: num(data.files_changed),
  };
}

/**
 * Terminal session lifecycle. This is a REAL host PTY in the task workspace, not
 * an isolated environment — the label deliberately says "session", never
 * "sandbox", matching the restricted-host language used everywhere else.
 */
export interface TerminalPayload {
  sessionId?: string;
  status?: string;
  reason?: string;
  exitCode?: number;
}

export function readTerminal(data: Record<string, unknown>): TerminalPayload {
  return {
    sessionId: str(data.session_id),
    status: str(data.status),
    reason: str(data.reason),
    exitCode: num(data.exit_code),
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
      const human = kind !== undefined ? INTENT_PRODUCT_LABEL[kind] : undefined;
      return { title: 'Intent classified', detail: human ?? kind, tone: 'neutral' };
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
    case 'git_status': {
      const status = readGitStatus(data);
      const where = status.detached ? 'detached HEAD' : status.branch ?? 'unknown branch';
      const clean = status.dirtyCount === 0;
      return {
        title: 'Repository inspected',
        detail: clean
          ? `${where} · clean`
          : `${where} · ${status.dirtyCount} change${status.dirtyCount === 1 ? '' : 's'}`,
        tone: 'neutral',
      };
    }
    case 'git_commit': {
      const commit = readGitCommit(data);
      const short = commit.hash?.slice(0, 7);
      return {
        title: 'Commit created',
        detail: [short, commit.subject].filter(Boolean).join(' · ') || undefined,
        tone: 'good',
      };
    }
    case 'terminal': {
      const session = readTerminal(data);
      switch (session.status) {
        case 'opened':
          return { title: 'Terminal session opened', detail: session.sessionId, tone: 'active' };
        case 'closed':
          return {
            title: 'Terminal session closed',
            detail: session.exitCode === undefined ? session.reason : `exit ${session.exitCode}`,
            tone: session.exitCode ? 'warn' : 'neutral',
          };
        case 'rejected':
          return { title: 'Terminal session refused', detail: session.reason, tone: 'warn' };
        default:
          return { title: 'Terminal session updated', detail: session.status, tone: 'neutral' };
      }
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
    case 'file_mutation': {
      // v1.25 Commit A (write-concurrency design §4.4): every file mutation is
      // a first-class audit event. The timeline shows the human label; the raw
      // event (exported with the audit trail) keeps agent, generations, sizes,
      // sha16 anchors, outcome, and conflict attribution.
      const op = str(data.op) === 'edit' ? 'File edited' : 'File written';
      const path = str(data.path) ?? 'unknown path';
      const genBefore = num(data.generationBefore);
      const genAfter = num(data.generationAfter);
      const agent = str(data.agent) ?? 'unknown agent';
      const outcome = str(data.outcome) ?? 'applied';
      if (outcome === 'applied') {
        const gens = genBefore !== undefined && genAfter !== undefined ? ` · gen ${genBefore} → ${genAfter}` : '';
        return { title: `${op}${gens}`, detail: `${path} · by ${agent}`, tone: 'good' };
      }
      const holder = str(data.conflictWith) ?? 'another writer';
      const reason = outcome === 'refused-lease'
        ? `path held by ${holder}`
        : `your read is stale (gen ${num(data.readStampAt) ?? '?'} → ${genBefore ?? '?'}, last writer ${holder})`;
      return { title: `${op} — refused`, detail: `${path} · ${reason}`, tone: 'warn' };
    }
    case 'error':
      // The cause. 'done' reports the terminal transition separately, so these
      // two must never share a label or the timeline reads as a duplicate.
      return { title: 'Error', detail: str(data.message), tone: 'bad' };
    case 'decision': {
      // Recorded-demo operator decisions (and future real decision trails).
      const note = typeof data.note === 'string' ? data.note : '';
      return {
        title: 'Operator decision recorded',
        detail: note,
        tone: 'warn',
      };
    }
    case 'model_switch': {
      // v1.25: in-session model switch. The row is the truth; the event is
      // the honest trail of what changed and when.
      const to = (data.to ?? {}) as Record<string, unknown>;
      const from = (data.from ?? {}) as Record<string, unknown>;
      const label = (side: Record<string, unknown>) =>
        [str(side.model_name) ?? str(side.model_id), str(side.provider_name)]
          .filter(Boolean)
          .join(' · ') || 'unknown';
      return {
        title: 'Model switched',
        detail: `${label(from)} → ${label(to)}`,
        tone: 'neutral',
      };
    }
    case 'hook': {
      // v1.20 lifecycle hooks — deterministic actions the loop takes
      // itself, independent of model behavior.
      const point = typeof data.point === 'string' ? data.point : 'pre_tool';
      const fired = Array.isArray(data.fired) ? data.fired.length : 0;
      const first = Array.isArray(data.fired) && data.fired[0] && typeof (data.fired as { summary?: unknown }[])[0].summary === 'string'
        ? ((data.fired as { summary?: string }[])[0].summary as string)
        : undefined;
      return {
        title: `Hook · ${point.replace('_', ' ')}`,
        detail: first ?? `${fired} hook${fired === 1 ? '' : 's'} fired`,
        tone: 'neutral' as const,
      };
    }
    case 'done': {
      const status = str(data.status) ?? 'finished';
      if (status === 'completed') return { title: 'Run completed', tone: 'good' };
      return { title: `Run ended: ${status}`, tone: 'bad' };
    }
    // text/reasoning/task_status carry no standalone timeline entry — they are
    // rendered as the message stream and the status badge instead.
    default:
      return null;
  }
}
