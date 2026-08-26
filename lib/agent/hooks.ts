/**
 * Lifecycle hooks (v1.20) — deterministic control around the agent loop.
 *
 * Principle (documented by Claude Code, practiced everywhere): anything that
 * must ALWAYS happen should not depend on the model remembering it in a
 * prompt. Hooks run at fixed points in the loop, as data-defined handlers —
 * and every firing lands in the same seq-ordered event stream as everything
 * else the loop does, so hooks inherit the audit trail instead of inventing
 * one.
 *
 * v1.20 ships four built-in hooks with real effects:
 *   audit_pretool     — records every shell command with its permission
 *                       decision citation BEFORE execution (deny is recorded
 *                       too: blocked attempts are evidence).
 *   audit_posttool    — appends exit/outcome to the audit trail.
 *   guardrail_verify  — after a successful code_execute in build mode,
 *                       verifies the workspace still contains the files the
 *                       run claims to have edited; catches "claimed but gone"
 *                       states early.
 *   completion_evidence — on task_completed, emits a structured evidence
 *                       summary (tools used, files touched, verification
 *                       outcome) as a persisted event.
 *
 * Custom user hooks (shell commands etc.) are deliberately NOT in this
 * release: they execute arbitrary code at loop time and deserve their own
 * permission surface. The registry below is built so they can be added as
 * data without touching the loop.
 */

import { emitTaskEvent } from '@/lib/sse/emitter';
import { evaluatePermission, type PermissionRule } from './permissions';

/** Where in the loop a hook can fire. */
export type HookPoint =
  | 'pre_tool'
  | 'post_tool'
  | 'tool_failure'
  | 'task_completed';

export interface HookContext {
  taskId: string;
  mode: string;
  /** Workspace-relative paths this run has written so far. */
  filesModified: readonly string[];
  toolName?: string;
  args?: Record<string, unknown>;
  observation?: string;
  /** Permission decision that gated this call, when one applied. */
  permissionRuleIndex?: number;
  permissionEffect?: string;
}

export interface HookResult {
  hook: string;
  point: HookPoint;
  /** Human-readable one-liner for the activity feed. */
  summary: string;
  /** Structured payload persisted with the hook event. */
  data: Record<string, unknown>;
}

export type HookHandler = (ctx: HookContext) => Promise<HookResult | null>;

/* ------------------------------------------------------------------ */
/* Built-in hooks                                                      */
/* ------------------------------------------------------------------ */

const auditPreTool: HookHandler = async (ctx) => {
  if (ctx.toolName !== 'code_execute' && ctx.toolName !== 'terminal') return null;
  const command = String(ctx.args?.command ?? ctx.args?.code ?? '');
  if (!command) return null;
  return {
    hook: 'audit_pretool',
    point: 'pre_tool',
    summary: `Command audited before execution`,
    data: {
      command: command.slice(0, 200),
      permission_rule_index: ctx.permissionRuleIndex ?? null,
      permission_effect: ctx.permissionEffect ?? null,
    },
  };
};

const auditPostTool: HookHandler = async (ctx) => {
  if (!ctx.toolName || !ctx.observation) return null;
  const failed = ctx.observation.startsWith('Error:');
  const exitMatch = ctx.observation.match(/^exit=(\d+)/m);
  if (!failed && !exitMatch) return null;
  return {
    hook: 'audit_posttool',
    point: failed ? 'tool_failure' : 'post_tool',
    summary: failed ? `Tool failure recorded` : `Command exited ${exitMatch?.[1]}`,
    data: {
      tool: ctx.toolName,
      ok: !failed,
      exit_code: exitMatch ? parseInt(exitMatch[1], 10) : null,
    },
  };
};

/**
 * Guardrail: the workspace must still contain what the run says it changed.
 * Catches the "summary claims success but files vanished" class early —
 * the false-completion family the anti-fake gate watches, caught mid-run.
 */
const guardrailVerify: HookHandler = async (ctx) => {
  if (ctx.mode !== 'build') return null;
  if (ctx.toolName !== 'code_execute') return null;
  const exitMatch = ctx.observation?.match(/^exit=(\d+)/m);
  if (!exitMatch || parseInt(exitMatch[1], 10) !== 0) return null;
  // Only fire occasionally — after successful executions — not on every call.
  if (ctx.filesModified.length === 0) return null;
  const { workspaceFor } = await import('./files');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const workDir = workspaceFor(ctx.taskId, null);
  const missing = ctx.filesModified.filter((rel) => {
    try {
      return !fs.existsSync(path.join(workDir, rel));
    } catch {
      return true;
    }
  });
  if (missing.length === 0) return null;
  return {
    hook: 'guardrail_verify',
    point: 'post_tool',
    summary: `Guardrail: ${missing.length} claimed file(s) missing from workspace`,
    data: { missing: missing.slice(0, 10), checked: ctx.filesModified.length },
  };
};

const completionEvidence: HookHandler = async (ctx) => {
  // Only meaningful at completion; the loop calls hooks(HookPoint.task_completed).
  return {
    hook: 'completion_evidence',
    point: 'task_completed',
    summary: 'Completion evidence bundle recorded',
    data: {
      files_modified: [...ctx.filesModified].slice(0, 25),
      mode: ctx.mode,
    },
  };
};

export interface HookRegistry {
  pre_tool: HookHandler[];
  post_tool: HookHandler[];
  tool_failure: HookHandler[];
  task_completed: HookHandler[];
}

export function defaultHooks(): HookRegistry {
  return {
    pre_tool: [auditPreTool],
    post_tool: [auditPostTool, guardrailVerify],
    tool_failure: [auditPostTool],
    task_completed: [completionEvidence],
  };
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

/**
 * Fire every hook registered for a point. Hook errors NEVER break the run —
 * a broken hook is itself evidence, logged and swallowed. Returns the
 * non-null results so the caller can persist them.
 */
export async function runHooks(
  registry: HookRegistry,
  point: HookPoint,
  ctx: HookContext,
): Promise<HookResult[]> {
  const results: HookResult[] = [];
  for (const handler of registry[point]) {
    try {
      const result = await handler(ctx);
      if (result) results.push(result);
    } catch (err) {
      results.push({
        hook: 'unknown',
        point,
        summary: 'Hook error (run continued)',
        data: { error: String(err).slice(0, 200) },
      });
    }
  }
  return results;
}

/**
 * Persist hook firings into the standard event stream. One aggregated event
 * per firing batch keeps the timeline readable.
 */
export async function persistHookResults(
  taskId: string,
  point: HookPoint,
  results: HookResult[],
): Promise<void> {
  if (results.length === 0) return;
  await emitTaskEvent(taskId, 'hook', {
    point,
    fired: results.map((r) => ({
      hook: r.hook,
      summary: r.summary,
      ...r.data,
    })),
  }).catch(() => {});
}
