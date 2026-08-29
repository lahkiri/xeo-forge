/**
 * Run-protocol primitives — the wire format between the model and the loop.
 *
 * Extracted from loop.ts (v1.24 structural rework) VERBATIM: the bodies are
 * byte-identical to the versions that shipped in v1.23; only the module
 * boundary moved. Behavior is pinned end-to-end by
 * test/run-agent-behavior.test.ts and by source contract in
 * test/loop-guards.test.ts (definition pinned HERE, call sites pinned in
 * loop.ts — exactly one definition site must exist).
 */

export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export function parseArgs(raw: string): Record<string, any> {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Parse a fallback <action>{...}</action> block from assistant text. */
export function parseFallbackAction(text: string): { tool: string; args: Record<string, any> } | null {
  const m = text.match(/<action>\s*([\s\S]*?)\s*<\/action>/i);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]);
    if (obj && typeof obj.tool === 'string') {
      return { tool: obj.tool, args: obj.args || {} };
    }
  } catch (err) {
    console.error('[agent] failed to parse fallback action:', err);
  }
  return null;
}

/**
 * Compute a fingerprint for a set of tool calls. Two iterations with the
 * same tools, same arguments, AND same observations produce the same
 * fingerprint. Arguments are truncated to 100 chars to keep the fingerprint
 * stable across minor diffs.
 *
 * WHY OBSERVATIONS ARE INCLUDED: a frontier model fixing a failing test runs
 * the SAME test command repeatedly — identical name and arguments — but every
 * run returns a DIFFERENT observation as the fix converges. A fingerprint
 * over arguments alone counts that legitimate loop as stagnation and
 * eventually kills a productive run. Including a prefix of each observation
 * distinguishes "same call, different world" (progress) from "same call,
 * same world" (stuck). Tool output begins with the exit code for
 * code_execute, so even `exit=1` → `exit=0` flips the fingerprint.
 */
export function computeToolSignature(
  calls: { name: string; arguments: string }[],
  observations: string[] = [],
): string {
  const parts = calls.map((c, i) => {
    const obs = observations[i] !== undefined ? `=>${observations[i].slice(0, 120)}` : '';
    return `${c.name}:${c.arguments.slice(0, 100)}${obs}`;
  });
  return parts.sort().join('|');
}
