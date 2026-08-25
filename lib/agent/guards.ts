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
  // Arabic autonomy-violation patterns. The runtime context instructs the
  // model to answer in the user's detected language; an Arabic-language run
  // that asks instead of acting used to slip past these detectors entirely.
  /هل (تريد|تود|يجب|يمكنني|أبدأ|أتوقف)/,
  /أخبرني إذا|اطلب مني/,
  /بانتظار (ردك|تأكيدك|موافقتك|قرارك)/,
  /دعني أعرف/i,
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

/**
 * Guard profiles: the same behavioral guards, tuned by model tier.
 *
 * WHY TIER AT ALL: the thresholds below were calibrated against weak models
 * that genuinely loop (same call, same failure, no adaptation). A frontier
 * model runs legitimate loops that LOOK identical to a dumb loop unless you
 * read the results: run test → fix → run the SAME test → fix again. Every
 * iteration has the same tool name and arguments but a DIFFERENT observation,
 * and each one is real progress. Tuning one set of thresholds for both tiers
 * either kills productive strong models or lets weak ones spin for minutes.
 *
 * Detection is a heuristic on the model id (no schema change, admin-visible
 * string): frontier families map to `strong`, everything else stays on the
 * historical `standard` numbers. A model that is misclassified degrades to
 * the old behavior — never to something unchecked.
 */
export const GUARD_PROFILES = {
  /** Historical thresholds — calibrated for models that genuinely loop. */
  standard: {
    /** Consecutive identical tool-call fingerprints before escalation. */
    stagnationThreshold: 3,
    /** Consecutive read-only calls in build mode before the nudge. */
    maxConsecutiveReads: 6,
  },
  /**
   * Frontier models: more room before escalation, because their repeated
   * shapes are usually legitimate (deep code study; iterated test-fix loops
   * whose observations differ every round — the fingerprint covers that, but
   * the extra headroom keeps the nudge out of a focused agent's way).
   */
  strong: {
    stagnationThreshold: 6,
    maxConsecutiveReads: 15,
  },
} as const;

export type GuardProfileName = keyof typeof GUARD_PROFILES;

/**
 * Model-id heuristics for GUARD_PROFILES.strong. Matched case-insensitively
 * against the configured model id (e.g. `claude-opus-4-5`, `gpt-5.1`,
 * `o3-mini`, `gemini-2.5-pro`, `deepseek-r1`, `grok-4`). The list is
 * deliberately coarse: a false `standard` merely restores the old, stricter
 * behavior for a strong model — annoying, never unsafe.
 */
const STRONG_MODEL_PATTERNS: RegExp[] = [
  // NOTE: matched against ADMIN-CONFIGURED model ids, which age fast — the
  // frontier reorders roughly monthly (verified 2026-08: GPT-5.6 Sol and
  // Claude Fable 5 lead SWE-bench; GLM-5.3/Kimi K3/DeepSeek V4 lead the open
  // weights). Patterns therefore key on GENERATION RANGES, not exact ids, so
  // next quarter's model still matches without a code change.
  /opus/i,                      // Claude Opus, any generation
  /fable/i,                     // Claude Fable line
  /claude-(sonnet|opus|haiku|fable)-?[4-9]/i, // Claude 4+ flagships
  /claude-[4-9][.-]/i,          // Bare "claude-4-…" ids
  /gpt-?[5-9]/i,                // GPT-5 and later (incl. 5.6 Sol)
  /\bo[1-9]\b|\bo[1-9]-/i,      // OpenAI o-series reasoning models
  /gemini-?[2-9](\.[0-9]+)?.*pro/i, // Gemini 2+ Pro (incl. 3.1 Pro)
  /deepseek-?(r[v]?\d|v[3-9])/i,   // DeepSeek R/V3+ reasoning line (V4 included)
  /grok-?[3-9]/i,
  /glm-?[4-9]/i,                // Z.ai GLM-4 and later (5.3 is frontier-class coding)
  /kimi-?k?[2-9]/i,             // Moonshot Kimi K2 and later (K3 top of Arena)
  /qwen-?3\.?[5-9]/i,           // Qwen 3.5+ flagship tiers (3.8-Max era)
];

export function guardProfileForModel(modelId: string | null | undefined): GuardProfileName {
  if (!modelId) return 'standard';
  return STRONG_MODEL_PATTERNS.some((re) => re.test(modelId)) ? 'strong' : 'standard';
}

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

/**
 * Read-only loop check. `maxReads` defaults to the standard profile's number;
 * the agent loop passes its resolved profile's threshold so a strong model
 * studying a large codebase is not interrupted mid-investigation.
 */
export function readOnlyLoopDetected(consecutiveReads: number, maxReads: number = MAX_CONSECUTIVE_READS): boolean {
  return consecutiveReads >= maxReads;
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
  `Almost done! You've done real work. Now call task_complete with a SHORT summary that includes: ` +
  `what was built, your assumptions, decisions, issues found, and workarounds. ` +
  `Do NOT repeat your previous answer — the user already read it. The summary is engineering ` +
  `memory, not a second delivery. Do not just write text — use the task_complete tool.`;

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

/* ------------------------------------------------------------------ */
/*  task_complete summary section gate                                 */
/*                                                                     */
/*  Lives here (not inside the loop closure) for the same reason every  */
/*  other guard does: one implementation, imported by the loop AND by  */
/*  the unit tests (AGENTS.md §5.5). A closure-local copy would let     */
/*  tests re-declare the logic and stay green while the real gate       */
/*  drifted.                                                           */
/* ------------------------------------------------------------------ */

/**
 * Section markers accepted by the summary gate. The prompt contract
 * (prompts.ts) tells the model to LABEL the four engineering-memory lists
 * with their English titles so the check stays deterministic; the content
 * under each title is written in the user's language. These translation
 * keys are a safety net for models that translate the titles too — the
 * LANGUAGE AFFINITY instruction explicitly asks for user-language output,
 * and a summary must never fail the gate for obeying it.
 */
export const SUMMARY_SECTION_MARKERS: Record<string, string[]> = {
  Assumptions: ['assumption', 'افتراض', 'hypothèse', 'supuesto', '假设', 'допущен'],
  Decisions: ['decision', 'قرار', 'décision', 'decisión', '决定', 'решен'],
  'Issues/Limitations': ['issue', 'limitation', 'مشكلة', 'مشاكل', 'قيد', 'تحفظ', 'problème', 'limite', 'problema', 'limitación', '问题', 'проблем'],
  'Workarounds/Placeholders': ['workaround', 'placeholder', 'حل بديل', 'بديل', 'مؤقت', 'contournement', 'alternativa', '临时', 'обходн'],
};

/**
 * Validate that a task_complete summary includes the four mandatory
 * engineering-memory sections. Text-presence check over the summary AND its
 * accepted translations — a model obeying LANGUAGE AFFINITY and writing the
 * summary in the user's language still passes.
 */
export function validateSummarySections(summary: string): { ok: boolean; missing: string[] } {
  const lower = summary.toLowerCase();
  const missing: string[] = [];
  for (const [section, markers] of Object.entries(SUMMARY_SECTION_MARKERS)) {
    const present = markers.some((marker) => lower.includes(marker.toLowerCase()));
    if (!present) missing.push(section);
  }
  return { ok: missing.length === 0, missing };
}
