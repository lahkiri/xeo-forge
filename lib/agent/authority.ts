/**
 * Central tool-call authority (v1.21 wiring).
 *
 * Autonomy levels were rule DATA since v1.20, but nothing consulted them at
 * tool-dispatch time: the API did not accept a level, startAgentRun never
 * forwarded one, and — found while wiring — loop.ts built its tool context
 * BEFORE computing the rule set, so even an explicit level could not have
 * reached CodeTool. This module makes the level's rule set the authority for
 * every world-touching call, evaluated at the SAME chokepoint as the
 * planning/chat hard-lock.
 *
 * SEMANTICS OF 'ask' (read this before changing): a run cannot stop mid-flight
 * to hold an interactive approval conversation — no per-action approval queue
 * exists yet. An unresolved 'ask' therefore FAILS CLOSED: the call is refused
 * with a citation of the deciding rule and how the user can grant it (raise
 * the level, or add an explicit override). Silently proceeding would make
 * 'ask' read 'allow' in practice, which is exactly the authority escalation
 * this layer exists to prevent.
 *
 * This module is deliberately PURE: no db import, no event emitter, no child
 * process. The dispatch gate (tools.executeTool) applies its verdict; tests
 * import it directly to pin the contract without any environment.
 */

import { evaluatePermission, type PermissionAction, type PermissionRule } from './permissions';
import { isMcpToolName } from '../mcp/client';

/** Git ops that rewrite repository state; the union's rest is inspection. Matches the read/write split runGitOp itself enforces by mode. */
const GIT_MUTATION_OPS = new Set(['checkout', 'add', 'commit', 'revert']);

export type AuthorityVerdict =
  | { decision: 'pass'; action: PermissionAction | null }
  | { decision: 'deny'; message: string };

/**
 * Translate one tool call into the (action, resource) pair the rule set
 * speaks. Returns null for tools OUTSIDE the authority surface entirely:
 * task_complete and todo_update mutate task-internal state only, and browser
 * actions are governed by their own explicit user policy + confirmSensitive
 * handshake rather than by autonomy rules. Absence here means "this layer
 * does not claim authority", never "allowed by it".
 */
function classifyToolCall(name: string, args: Record<string, any>): { action: PermissionAction; resource: string } | null {
  switch (name) {
    case 'file_read':
    case 'skill_view':
      // skill_view READS imported skill text (it executes nothing), so both
      // share read scope; skill paths are prefixed to keep overrides targetable.
      return { action: 'read', resource: name === 'skill_view' ? `skill:${String(args?.path ?? '')}` : String(args?.path ?? '') };
    case 'file_list':
      return { action: 'glob', resource: args?.path ? String(args.path) : '.' };
    case 'file_write':
    case 'file_edit':
      return { action: 'edit', resource: String(args?.path ?? '') };
    case 'code_execute': {
      // Whole source text (any language): universal deny globs must be able to
      // find destructive fragments anywhere inside it. CodeTool still runs its
      // own per-command evaluation underneath — same rule list, finer grain.
      return { action: 'shell', resource: String(args?.code ?? '') };
    }
    case 'preview':
      // Starts host processes → shell authority, keyed on the action so an
      // override can grant "preview status" without granting "preview start".
      return { action: 'shell', resource: `preview ${String(args?.action ?? '')}` };
    case 'http_request':
      return { action: 'network', resource: String(args?.url ?? '') };
    case 'web_search':
      // Keyed under the network action with a dedicated resource prefix so a
      // per-level allow rule (`web_search:*`) can grant exactly this — a
      // GET-shaped read of public pages — without opening the network
      // wildcard (http_request stays gated).
      return { action: 'network', resource: `web_search:${String(args?.query ?? '')}` };
    case 'git_op': {
      const op = String((args ?? {})?.op ?? '');
      if (!GIT_MUTATION_OPS.has(op)) return { action: 'read', resource: `git:${op}` };
      return { action: 'git_mutation', resource: op };
    }
    default:
      return null;
  }
}

function denialMessage(
  effect: 'deny' | 'ask',
  ruleIndex: number,
  note: string | undefined,
  matchedResource: string | undefined,
  action: PermissionAction,
  resource: string,
): string {
  const citation = `permission rule #${ruleIndex}${note ? ` (${note})` : matchedResource ? ` (${matchedResource})` : ''}`;
  if (effect === 'deny') {
    return (
      `Blocked by autonomy policy: ${citation} denies ${action} on "${resource.slice(0, 80)}". ` +
      `This act is refused, not queued. Complete the remaining possible work and report this block in your summary.`
    );
  }
  return (
    `Requires your approval: ${citation} classifies ${action} on "${resource.slice(0, 80)}" as ask-at-runtime, ` +
    `and a running agent cannot obtain a confirmation yet. Raise the autonomy level or add an explicit override ` +
    `for exactly this resource, then retry — or finish and list what was blocked.`
  );
}

/**
 * Central authority check applied before ANY dispatch branch (including MCP).
 *
 * Rules absent → pass-through so legacy internal callers keep working on their
 * own floors; a live run ALWAYS carries a rule set because loop.ts builds one
 * before creating the tool context.
 */
export function authorizeToolCall(
  name: string,
  args: Record<string, any>,
  rules: readonly PermissionRule[] | undefined,
): AuthorityVerdict {
  if (!rules || rules.length === 0) return { decision: 'pass', action: null };

  // MCP tools ARE third-party code execution, so they answer to the subagent
  // rules every autonomy level defines (denied at read_only, asked at assist,
  // allowed from execute up).
  if (isMcpToolName(name)) {
    const d = evaluatePermission(rules, 'subagent', name);
    if (d.effect === 'allow') return { decision: 'pass', action: 'subagent' };
    return {
      decision: 'deny',
      message: denialMessage(d.effect === 'deny' ? 'deny' : 'ask', d.ruleIndex, d.matched?.note, d.matched?.resource, 'subagent', name),
    };
  }

  const classified = classifyToolCall(name, args);
  if (!classified) return { decision: 'pass', action: null };

  const { action, resource } = classified;
  const d = evaluatePermission(rules, action, resource);
  if (d.effect === 'allow') return { decision: 'pass', action };
  return {
    decision: 'deny',
    message: denialMessage(d.effect === 'deny' ? 'deny' : 'ask', d.ruleIndex, d.matched?.note, d.matched?.resource, action, resource),
  };
}
