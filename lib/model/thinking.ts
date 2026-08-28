/**
 * Thinking-effort levels — the honest contract (v1.23).
 *
 * Eight user-facing levels. Each level maps to ONE or BOTH of:
 *   1. a NATIVE provider parameter (`reasoning_effort`, OpenAI convention —
 *      live-probed 2026-08-28: accepted by every working model on our
 *      reference proxy, and observably changed reasoning volume on at least
 *      one family), and
 *   2. a SIMULATED discipline layer (a per-iteration system directive that
 *      forces plan/self-check/alternative passes — visible, bounded, and
 *      honest about being prompt engineering rather than model internals).
 *
 * HONESTY RULES (the whole point):
 * - A level whose native param is null is simulated, and the UI says so.
 * - Levels that share a native value differ ONLY by their simulation depth —
 *   the difference is real (the directive changes the request) but it is
 *   prompt engineering, and the classification below says so in one word.
 * - Whether the model actually STREAMS separate thinking is a property of
 *   the model+provider, not of the level. The UI warns when a level above
 *   minimal produced no visible thinking rather than pretending it did.
 */

export type ThinkingEffort =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'enhanced_high'
  | 'extra'
  | 'max'
  | 'ultra';

export interface ThinkingLevelSpec {
  id: ThinkingEffort;
  /** UI label — the owner's requested naming, verbatim. */
  label: string;
  /** Native `reasoning_effort` value sent to the provider, or null to send none. */
  native: 'minimal' | 'low' | 'medium' | 'high' | null;
  /** Simulation depth: how many self-discipline passes the directive demands. */
  simulatePasses: 0 | 1 | 2 | 3 | 4;
  /** One-word honest classification shown in the UI. */
  kind: 'native' | 'hybrid';
  /** Short honest description for tooltips/settings copy. */
  describe: string;
}

export const THINKING_LEVELS: readonly ThinkingLevelSpec[] = [
  {
    id: 'minimal',
    label: 'Minimal',
    native: 'minimal',
    simulatePasses: 0,
    kind: 'native',
    describe: 'Fastest. No extra passes — for lookups and quick edits.',
  },
  {
    id: 'low',
    label: 'Low',
    native: 'low',
    simulatePasses: 0,
    kind: 'native',
    describe: 'Light native reasoning only. Small tasks with obvious steps.',
  },
  {
    id: 'medium',
    label: 'Medium',
    native: 'medium',
    simulatePasses: 0,
    kind: 'native',
    describe: 'Balanced native reasoning. The everyday default.',
  },
  {
    id: 'high',
    label: 'High',
    native: 'high',
    simulatePasses: 0,
    kind: 'native',
    describe: 'Maximum native reasoning effort the provider supports.',
  },
  {
    id: 'enhanced_high',
    label: 'Enchanted High',
    native: 'high',
    simulatePasses: 1,
    kind: 'hybrid',
    describe: 'High + one forced self-check pass (prompt simulation).',
  },
  {
    id: 'extra',
    label: 'Extra',
    native: 'high',
    simulatePasses: 2,
    kind: 'hybrid',
    describe: 'High + plan-first and self-check passes (prompt simulation).',
  },
  {
    id: 'max',
    label: 'Max',
    native: 'high',
    simulatePasses: 3,
    kind: 'hybrid',
    describe: 'High + plan, check, and alternative-comparison passes.',
  },
  {
    id: 'ultra',
    label: 'Ultra',
    native: 'high',
    simulatePasses: 4,
    kind: 'hybrid',
    describe: 'Everything Max does, plus adversarial critique of its own plan. Slowest, most thorough.',
  },
] as const;

const LEVEL_BY_ID = new Map(THINKING_LEVELS.map((l) => [l.id, l]));

export const DEFAULT_THINKING_EFFORT: ThinkingEffort = 'high';

export function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return typeof value === 'string' && LEVEL_BY_ID.has(value as ThinkingEffort);
}

/** Normalize untrusted input to a valid level. Never throws. */
export function normalizeThinkingEffort(value: unknown): ThinkingEffort {
  return isThinkingEffort(value) ? value : DEFAULT_THINKING_EFFORT;
}

export function thinkingLevel(id: unknown): ThinkingLevelSpec {
  return LEVEL_BY_ID.get(normalizeThinkingEffort(id)) ?? LEVEL_BY_ID.get(DEFAULT_THINKING_EFFORT)!;
}

/**
 * The simulation directive for a level — prepended as a system message for
 * every iteration of a run at that level. `simulatePasses === 0` → no
 * directive at all (pure native).
 */
export function thinkingDirective(id: unknown): string | null {
  const spec = thinkingLevel(id);
  if (spec.simulatePasses === 0) return null;

  const passes: string[] = [];
  passes.push(
    'PLAN: Before acting, silently outline the exact steps you will take and the success criteria for each.',
  );
  if (spec.simulatePasses >= 2) {
    passes.push(
      'SELF-CHECK: After producing your answer, verify every factual claim and every code path against the actual evidence you gathered. Fix anything that fails the check before finalizing.',
    );
  }
  if (spec.simulatePasses >= 3) {
    passes.push(
      'ALTERNATIVES: Briefly consider at least one materially different approach than your first instinct; if it is not clearly worse, say why you rejected it.',
    );
  }
  if (spec.simulatePasses >= 4) {
    passes.push(
      'ADVERSARIAL CRITIQUE: Assume your own plan has a flaw. Name the most likely failure mode and pre-empt it explicitly in your execution.',
    );
  }
  return [
    `THINKING DISCIPLINE (level: ${spec.label}) — this run runs at elevated reasoning effort. The provider's native reasoning is already at its maximum; the following passes are enforced by prompt and are NOT optional:`,
    ...passes.map((p, i) => `${i + 1}. ${p}`),
    'Do not narrate these passes as ceremony — their RESULTS must be visible in the quality of the final output.',
  ].join('\n');
}

/**
 * Best-effort, display-only hint: does this model id look like a family that
 * streams separate reasoning? NEVER used to gate anything — the honest
 * warning in the UI is driven by what actually arrived in the stream, not by
 * this guess. This exists to phrase the warning accurately.
 */
export function modelLikelyStreamsReasoning(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return /thinking|reason|^-o\d|(?<=[a-z0-9])-o\d|gpt-oss|deepseek|glm|kimi|mimo|qwq|r1|opus|sonnet|o[1-9]b?/.test(id);
}
