/**
 * Shared types — canonical shapes for every entity and event.
 * One definition per concept; do not redefine these elsewhere.
 */

/* ----- DB row shapes ----- */

export interface User {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  is_admin: number;
  is_root_admin: number;
  is_suspended: number;
  created_at: string;
}

export interface Credits {
  user_id: string;
  balance: number;
  daily_grant: number;
  last_reset_at: string | null;
  updated_at: string;
}

export interface CreditLedgerRow {
  id: number;
  user_id: string;
  delta: number;
  reason: string;
  ref_id: string | null;
  balance_after: number;
  created_at: string;
}

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'planned' // planning run finished; proposed plan awaits user approval
  | 'completed'
  | 'failed';

/**
 * Native dual-mode execution state (lives on the task — the single source of
 * truth, AGENTS.md rule 1). There is no separate "session" object in this
 * system; the task row + its task_events ARE the authoritative session state.
 *
 * - 'planning': read-only. Write tools are hard-locked at the dispatch layer
 *   (lib/agent/tools.ts). The agent inspects and produces a plan only.
 * - 'build': execution. Writes are allowed, but only against the immutable
 *   approved_plan snapshot taken at approval time.
 */
export type TaskMode = 'planning' | 'build';

export interface Task {
  id: string;
  user_id: string;
  goal: string;
  status: TaskStatus;
  mode: TaskMode;
  plan: string | null; // latest proposed plan (planning output)
  approved_plan: string | null; // immutable snapshot frozen at approval
  plan_version: number; // increments each time a plan is approved
  profile_id: string | null; // reusable agent profile selected at task creation
  skill_id: string | null; // reusable workflow selected at task creation
  result_summary: string | null;
  credits_spent: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskEvent {
  id: number;
  task_id: string;
  seq: number;
  type: string;
  content: string; // JSON-encoded payload
  created_at: string;
}

export interface ModelSettings {
  id: number;
  name: string;
  base_url: string;
  api_key: string;
  model_id: string;
  temperature: number;
  max_tokens: number;
  /** Total context window of the model in tokens — denominator for usage %. */
  context_window: number;
  /** Auto-compact trigger as a percent of context_window (1–100). */
  auto_compact_threshold: number;
  updated_at: string;
}

/** Model settings with the api_key masked — safe to return to clients. */
export type ModelSettingsSafe = Omit<ModelSettings, 'api_key'> & { api_key_set: boolean };

export interface AdminAction {
  id: number;
  admin_id: string;
  target_user_id: string | null;
  action: string;
  detail: string | null;
  created_at: string;
}

/** Chat message persisted per task — the conversation history. */
export interface Message {
  id: number;
  task_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /**
   * 1 = part of the live context window the agent loads each run.
   * 0 = archived: superseded by a compaction summary. Kept for audit/UI,
   * excluded from the agent's LLM context. Compaction NEVER deletes rows.
   */
  active: number;
  created_at: string;
}

/** User-configured instructions compiled into a run without source edits. */
export type AgentInstructionScope = 'global' | 'task';

export interface AgentInstruction {
  id: string;
  user_id: string;
  task_id: string | null;
  scope: AgentInstructionScope;
  name: string;
  content: string;
  priority: number;
  enabled: number;
  version: number;
  created_at: string;
  updated_at: string;
}

/** Persistent agent memory. Memory is context data, never a permission grant. */
export type AgentMemoryScope = 'global' | 'task';
export type AgentMemoryKind = 'preference' | 'fact' | 'decision' | 'constraint' | 'lesson';
export type AgentMemoryStatus = 'proposed' | 'active' | 'archived';

export interface AgentMemory {
  id: string;
  user_id: string;
  task_id: string | null;
  scope: AgentMemoryScope;
  kind: AgentMemoryKind;
  content: string;
  status: AgentMemoryStatus;
  confidence: number;
  source_task_id: string | null;
  source_message_id: string | null;
  pinned: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Reusable user-owned operating profile for a class of tasks. */
export type AgentProfileKind = 'builder' | 'researcher' | 'analyst' | 'operator' | 'custom';

export type AgentSkillKind = 'build' | 'research' | 'analysis' | 'operations' | 'content' | 'custom';

export interface AgentProfile {
  id: string;
  user_id: string;
  name: string;
  kind: AgentProfileKind;
  description: string;
  instructions: string;
  enabled: number;
  version: number;
  created_at: string;
  updated_at: string;
}

/** Reusable workflow template that compiles into a task's context. */
export interface AgentSkill {
  id: string;
  user_id: string;
  name: string;
  kind: AgentSkillKind;
  description: string;
  instructions: string;
  profile_id: string | null;
  enabled: number;
  version: number;
  created_at: string;
  updated_at: string;
}

/**
 * Uploaded file/archive ingested for a task. Stored under the task workspace
 * (workspaceFor(taskId)/_uploads/<id>/) — the SAME sandbox the agent file tools
 * are confined to. Uploaded content is UNTRUSTED DATA, never instructions.
 *
 * Lifecycle (single pipeline): quarantined → validated → extracted (archives
 * only) → ready  | rejected (any validation/extraction failure, with reason).
 * The agent may reference an upload only once status='ready'.
 */
export type UploadStatus =
  | 'quarantined' // received, written to quarantine, not yet validated
  | 'validating' // running whitelist + safety checks
  | 'extracting' // archive: inspecting + extracting entries safely
  | 'ready' // approved for agent use as untrusted data
  | 'rejected'; // failed validation/extraction — never exposed to the agent

/** A file kind from the allow-list. 'archive' is extracted; the rest are inert files. */
export type UploadKind = 'text' | 'code' | 'markdown' | 'json' | 'csv' | 'archive';

export interface Upload {
  id: string;
  task_id: string;
  user_id: string;
  filename: string; // original client filename (sanitized for display only)
  kind: UploadKind;
  status: UploadStatus;
  byte_size: number; // size of the uploaded file as received
  /** Workspace-relative directory holding the ready file(s): _uploads/<id>. */
  rel_path: string;
  /** Count of files available to the agent (1 for plain files; N for archives). */
  file_count: number;
  /** Total extracted bytes (archives) or byte_size (plain files). */
  extracted_bytes: number;
  /** Rejection/validation reason when status='rejected'; null otherwise. */
  error: string | null;
  created_at: string;
  updated_at: string;
}

/* ----- Auth ----- */

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  isRootAdmin: boolean;
  isSuspended: boolean;
}

/* ----- Agent events (payloads persisted as task_events.content JSON) ----- */

export type AgentEventType =
  | 'task_status'
  | 'mode' // native mode state: { mode: TaskMode }
  | 'plan' // proposed/approved plan: { plan, plan_version }
  | 'text'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'credits'
  | 'context' // live context usage: { used_tokens, context_window, percentage, threshold }
  | 'compaction' // compaction ran: { archived, summary_tokens, before_percentage, after_percentage }
  | 'upload' // upload lifecycle: { upload_id, filename, kind, status, file_count, extracted_bytes, error? }
  | 'file_activity' // live filesystem action: { action: 'created'|'edited'|'deleted'|'listed', path, size?, ts }
  | 'todo_update' // agent todo list snapshot: { items: [{id, description, status}] }
  | 'memory' // persistent learning proposal/status: { memory_id, status, scope, kind }
  | 'verification' // pre-completion verification: { status: 'pass'|'fail', message?, attempt? }
  | 'error'
  | 'done';

export interface AgentEvent {
  type: AgentEventType;
  data: Record<string, unknown>;
}
