import type { TaskMode } from '../types';

export type IntentKind =
  | 'conversation'
  | 'explicit_plan'
  | 'direct_execution'
  | 'clarification_needed';

export type IntentDecisionReason =
  | 'ordinary_message'
  | 'explicit_planning_language'
  | 'explicit_execution_language'
  | 'ambiguous_execution_request';

export interface IntentDecision {
  kind: IntentKind;
  reason: IntentDecisionReason;
  confidence: number;
  summary: string;
  options?: Array<'direct' | 'plan'>;
}

const PLAN_PATTERNS: RegExp[] = [
  /\b(plan|planning|propose a plan|draft a plan|map out|design first|analyze first)\b/i,
  /\b(create|write|prepare)\s+(?:a\s+)?(?:detailed\s+)?plan\b/i,
  /(خ(?:ط|طّ)ط|تخطيط|خطة|حلل|حلّل|اقترح خطة|صمم خطة|خطط أولا|خطط أولًا)/u,
];

const DIRECT_PATTERNS: RegExp[] = [
  /\b(do it|just do it|execute|implement|build|fix|change|edit|modify|create|run|ship|完成)\b/i,
  /\b(go ahead|make the change|apply the change|start working|take care of)\b/i,
  /(نفذ|نفّذ|اعمل|طب(?:ّ|ي)ق|إصلح|اصلح|عدّل|عدل|أنشئ|انشئ|شغّل|شغل|ابدأ التنفيذ|طبق التغيير)/u,
];

const QUESTION_PATTERNS: RegExp[] = [
  /\b(can you|could you|would you|what|how|why|which|should i)\b/i,
  /(هل|كيف|لماذا|ما هو|ماذا|أي|هل يمكنك)/u,
];

const TARGET_PATTERNS: RegExp[] = [
  /\b(file|folder|project|code|app|website|browser|page|repository|repo|component|api|database)\b/i,
  /(ملف|مجلد|مشروع|كود|تطبيق|موقع|متصفح|صفحة|مستودع|قاعدة بيانات)/u,
];

function normalize(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function hasAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Classifies the user's first Work turn without invoking the model or starting
 * a runner. This is intentionally conservative: ambiguity becomes a visible
 * choice, never silent execution.
 */
export function classifyWorkIntent(input: string): IntentDecision {
  const text = normalize(input);
  const explicitPlan = hasAny(PLAN_PATTERNS, text);
  const explicitDirect = hasAny(DIRECT_PATTERNS, text);
  const questionLike = hasAny(QUESTION_PATTERNS, text);
  const hasTarget = hasAny(TARGET_PATTERNS, text);

  if (explicitPlan && !explicitDirect) {
    return {
      kind: 'explicit_plan',
      reason: 'explicit_planning_language',
      confidence: 0.98,
      summary: 'The user explicitly asked for a plan before execution.',
    };
  }

  if (explicitDirect && hasTarget && !questionLike) {
    return {
      kind: 'direct_execution',
      reason: 'explicit_execution_language',
      confidence: 0.94,
      summary: 'The user appears to request a concrete change or action.',
      options: ['direct', 'plan'],
    };
  }

  if (explicitDirect && (questionLike || !hasTarget)) {
    return {
      kind: 'clarification_needed',
      reason: 'ambiguous_execution_request',
      confidence: 0.72,
      summary: 'The request contains action language but its target or intent is not sufficiently clear.',
      options: ['direct', 'plan'],
    };
  }

  return {
    kind: 'conversation',
    reason: 'ordinary_message',
    confidence: 0.9,
    summary: 'The message is conversational and should not start planning or execution.',
  };
}

/** Maps an explicit planning decision to the existing execution mode. */
export function modeForIntent(kind: IntentKind): Extract<TaskMode, 'chat' | 'planning'> {
  return kind === 'explicit_plan' ? 'planning' : 'chat';
}

export function directExecutionBrief(goal: string): string {
  return JSON.stringify({
    kind: 'direct_execution',
    request: normalize(goal),
    contract: 'Execute only the requested scope. Do not expand the goal or rewrite this brief.',
    created_at: new Date().toISOString(),
  });
}
