/**
 * Agent loop behavioral guards — the canonical implementation.
 *
 * AGENTS.md section 5.5 describes these as code-enforced checks, not prompt
 * suggestions. They used to live as inline literals inside runAgent (twice:
 * once on the native tool-calling path, once on the `<action>` fallback path),
 * which meant the two copies could drift and the unit tests re-declared a
 * third copy that tested nothing real.
 *
 * This module is the single source of truth (AGENTS.md rule 1). `loop.ts`
 * imports it on both paths, and the tests import the same exports.
 */

/**
 * The model is asking the user a question instead of acting. In build mode the
 * agent is expected to make bounded assumptions and proceed, so this is an
 * autonomy violation rather than a completion.
 */
export const QUESTION_PATTERNS: readonly RegExp[] = [
  /what (would you|do you|should i|can i|shall i)/i,
  /how (would you|do you|should i|can i)/i,
  /would you like/i,
  /do you want/i,
  /shall i/i,
  /can you (confirm|tell|provide|clarify)/i,
  /please (tell|provide|clarify|confirm|specify)/i,
  /let me know/i,
  /waiting for (your|the) (input|response|confirmation|decision)/i,
];

/**
 * The model is narrating future action instead of performing it. Checked
 * against the tail of the response, because a summary that *ends* with
 * "the next step is..." has not finished.
 */
export const DESCRIPTION_PATTERNS: readonly RegExp[] = [
  /i will (now|then|proceed|start|begin|create|build|write|implement)/i,
  /i('m| am) (now|going to|about to|ready to) /i,
  /let me (now|then|proceed|start|begin|create|build|write)/i,
  /now i will /i,
  /the next step is/i,
];

/** How much of the tail is inspected for description-not-doing patterns. */
export const DESCRIPTION_TAIL_CHARS = 500;

/** Consecutive read-only tool calls in build mode before nudging. */
export const MAX_CONSECUTIVE_READS = 6;

/** Tools that only inspect. These increment the read-only counter. */
export const READ_TOOLS: readonly string[] = ['file_read', 'file_list'];

/** Tools that change the workspace. These reset the read-only counter. */
export const WRITE_TOOLS: readonly string[] = ['file_write', 'file_edit', 'code_execute'];

export function isQuestionToUser(text: string): boolean {
  return QUESTION_PATTERNS.some((p) => p.test(text));
}

export function isDescribingNotDoing(text: string): boolean {
  return DESCRIPTION_PATTERNS.some((p) => p.test(text.slice(-DESCRIPTION_TAIL_CHARS)));
}

export function isReadTool(name: string): boolean {
  return READ_TOOLS.includes(name);
}

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.includes(name);
}

/**
 * Apply one tool call to the read-only counter. Returns the next value.
 * Reads increment, writes reset, anything else (http_request, browser,
 * task_complete) leaves the counter untouched.
 */
export function nextConsecutiveReads(current: number, toolName: string): number {
  if (isReadTool(toolName)) return current + 1;
  if (isWriteTool(toolName)) return 0;
  return current;
}

export function readOnlyLoopDetected(consecutiveReads: number): boolean {
  return consecutiveReads >= MAX_CONSECUTIVE_READS;
}

/**
 * Deterministic system signals gathered during a run. This is the ONLY source
 * completion verification trusts — model self-reporting (todo status, prose
 * claims) is checked against this, never the reverse.
 */
export interface ExecutionEvidence {
  toolCalls: { name: string; ok: boolean; ts: number }[];
  filesModified: Set<string>;
  codeExecutions: { exitCode: number; ts: number }[];
  errors: string[];
}

export function createExecutionEvidence(): ExecutionEvidence {
  return {
    toolCalls: [],
    filesModified: new Set<string>(),
    codeExecutions: [],
    errors: [],
  };
}

/**
 * Whether the run produced substantive, observable output. Requires at least
 * one tool call AND a real effect: a modified file, an executed command, or a
 * successful outbound request. Reads alone never qualify.
 */
export function hasDoneRealWork(evidence: {
  toolCalls: { name: string; ok: boolean }[];
  filesModified: Set<string>;
  codeExecutions: unknown[];
}): boolean {
  return (
    evidence.toolCalls.length > 0 &&
    (evidence.filesModified.size > 0 ||
      evidence.codeExecutions.length > 0 ||
      evidence.toolCalls.some((t) => t.name === 'http_request' && t.ok))
  );
}

/* ------------------------------------------------------------------ */
/* Nudge copy — kept beside the detectors they belong to.              */
/* ------------------------------------------------------------------ */

export const AUTONOMY_VIOLATION_NUDGE =
  `AUTONOMY VIOLATION — You asked the user a question instead of executing. ` +
  `Your job is to act independently, make assumptions, and deliver results. ` +
  `Do NOT ask for confirmation. Do NOT wait for input. Do NOT describe what you would do. ` +
  `Call task_complete with your results, or continue executing with tools right now.`;

export const AUTONOMY_VIOLATION_NUDGE_FALLBACK =
  `AUTONOMY VIOLATION — You asked the user a question instead of executing. ` +
  `Act independently and call task_complete or use a tool.`;

export const ACTION_REQUIRED_NUDGE =
  `ACTION REQUIRED — You described what you would do but did not call task_complete. ` +
  `If your work is done, call task_complete with a summary of what you built. ` +
  `If work remains, use your tools to continue executing. ` +
  `Do NOT describe future actions — execute them or finish.`;

export const NO_WORK_PERFORMED_NUDGE =
  `NO WORK PERFORMED — You have not called any tools yet. ` +
  `You must execute the task using your tools (file_write, code_execute, etc.). ` +
  `If the task is truly impossible, call task_complete and explain what blocked you. ` +
  `Text-only responses are not valid task completion.`;

export const CALL_TASK_COMPLETE_NUDGE =
  `Almost done! You've done real work. Now call task_complete with a summary that includes: ` +
  `what was built, your assumptions, decisions, issues found, and workarounds. ` +
  `Do not just write text — use the task_complete tool.`;

export const TEXT_WITHOUT_TOOL_NUDGE =
  `You emitted text without a tool call. In build mode, you must either use a tool or ` +
  `call task_complete. Emit an <action> for task_complete with your summary, or continue ` +
  `working with tools.`;

export function readOnlyLoopNudge(consecutiveReads: number): string {
  return (
    `READ-ONLY LOOP DETECTED — You've read files ${consecutiveReads} times without taking any action. ` +
    `In build mode, you must EXECUTE: write files, edit code, run commands. ` +
    `Stop reading and start building. If you have enough context, use file_write, file_edit, or code_execute now. ` +
    `If the task is unclear, call task_complete and explain what blocked you.`
  );
}

export function incompleteTodosNudge(
  pending: { id: string; description: string; status: string }[],
): string {
  return (
    `INCOMPLETE WORK — ${pending.length} todo item(s) remain incomplete: ` +
    pending.map((i) => `[${i.id}] ${i.description} (${i.status})`).join('; ') +
    `. Complete the remaining work, then call task_complete.`
  );
}
