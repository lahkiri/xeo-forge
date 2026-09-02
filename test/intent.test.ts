import { describe, expect, it } from 'vitest';
import { classifyWorkIntent, directExecutionBrief, modeForIntent } from '../lib/agent/intent';

describe('Work intent router', () => {
  it('keeps ordinary questions in conversation mode', () => {
    const result = classifyWorkIntent('What does this project do?');
    expect(result.kind).toBe('conversation');
    expect(result.reason).toBe('ordinary_message');
  });

  it('does not plan an ordinary Arabic conversation', () => {
    const result = classifyWorkIntent('ما رأيك في شكل هذه الواجهة؟');
    expect(result.kind).toBe('conversation');
  });

  it('starts planning only for an explicit planning request', () => {
    const result = classifyWorkIntent('خطط أولًا لبناء صفحة إعدادات للمشروع');
    expect(result.kind).toBe('explicit_plan');
    expect(modeForIntent(result.kind)).toBe('planning');
  });

  it('offers a decision for a direct English project request', () => {
    const result = classifyWorkIntent('Fix the project build and update the code');
    expect(result.kind).toBe('direct_execution');
    expect(result.options).toEqual(['direct', 'plan']);
  });

  it('offers a decision for a direct Arabic project request', () => {
    const result = classifyWorkIntent('نفّذ إصلاح الكود في المشروع');
    expect(result.kind).toBe('direct_execution');
    expect(result.options).toEqual(['direct', 'plan']);
  });

  it('asks for clarification when action language has no clear target', () => {
    const result = classifyWorkIntent('نفذ هذا من فضلك');
    expect(result.kind).toBe('clarification_needed');
    expect(result.options).toEqual(['direct', 'plan']);
  });

  it('creates an immutable direct execution brief', () => {
    const brief = JSON.parse(directExecutionBrief('Fix the landing page')) as {
      kind: string;
      request: string;
      contract: string;
      created_at: string;
    };
    expect(brief.kind).toBe('direct_execution');
    expect(brief.request).toBe('Fix the landing page');
    expect(brief.contract).toContain('Do not expand');
    expect(Number.isNaN(Date.parse(brief.created_at))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Language parity.                                                   */
/*                                                                     */
/*  detectLanguage() in loop.ts advertises en/ar/zh/ru/fr. The router   */
/*  must classify action and planning language in all five, or Work     */
/*  silently declines to act on a direct request in three of them.      */
/*                                                                     */
/*  The zh cases are the regression lock for a specific dead pattern:   */
/*  `完成` used to sit inside a `\b`-anchored English alternation, where */
/*  it could only ever match beside ASCII. Verified before the fix —    */
/*  /\b完成\b/.test('完成项目的构建') was false.                          */
/* ------------------------------------------------------------------ */

describe('the router covers every language detectLanguage advertises', () => {
  const directCases: Array<[string, string]> = [
    ['en', 'Fix the project build and update the code'],
    ['ar', 'نفّذ إصلاح الكود في المشروع'],
    ['zh', '实现这个功能修改代码'],
    ['zh (完成, the formerly dead pattern)', '完成项目的构建'],
    ['ru', 'исправь код в проекте'],
    ['fr', 'corrige le code du projet'],
  ];

  it.each(directCases)('treats a direct %s request as an execution decision', (_lang, input) => {
    const result = classifyWorkIntent(input);
    expect(result.kind).toBe('direct_execution');
    expect(result.reason).toBe('explicit_execution_language');
    // Never silent execution: the user always gets the choice.
    expect(result.options).toEqual(['direct', 'plan']);
  });

  const planCases: Array<[string, string]> = [
    ['en', 'Draft a plan for the settings page first'],
    ['ar', 'خطط أولًا لبناء صفحة إعدادات للمشروع'],
    ['zh', '先规划一下这个项目'],
    ['ru', 'сначала спланируй проект'],
    ['fr', "planifie d'abord le projet"],
  ];

  it.each(planCases)('routes an explicit %s planning request to planning', (_lang, input) => {
    const result = classifyWorkIntent(input);
    expect(result.kind).toBe('explicit_plan');
    expect(modeForIntent(result.kind)).toBe('planning');
  });

  const conversationCases: Array<[string, string]> = [
    ['en', 'What does this project do?'],
    ['ar', 'ما رأيك في شكل هذه الواجهة؟'],
    ['zh', '这个项目是做什么的吗'],
    ['ru', 'что делает этот проект'],
    ['fr', 'que fait ce projet'],
  ];

  it.each(conversationCases)('keeps an ordinary %s question conversational', (_lang, input) => {
    const result = classifyWorkIntent(input);
    expect(result.kind).toBe('conversation');
    expect(result.reason).toBe('ordinary_message');
  });

  it('does not rely on word boundaries for scripts that have none', () => {
    // A CJK-only string with no ASCII anywhere is the case a \b-anchored
    // alternation cannot see. If this regresses, the pattern was re-anchored.
    const result = classifyWorkIntent('修改这个文件');
    expect(result.kind).toBe('direct_execution');
  });

  // Regression: common software-work nouns used to sit outside TARGET_PATTERNS,
  // so an unambiguous request like "build a small script" was classified
  // clarification_needed and Work stalled on a visible choice for no reason.
  const targetNounCases: Array<[string, string]> = [
    ['en', 'Build a small script that says hello and verify it'],
    ['en', 'Add a helper function to the utils module and test it'],
    ['en', 'Fix the bug in the auth endpoint'],
    ['en', 'Update the failing test for the parser package'],
    ['en', 'Add a rate-limit feature to the login service'],
    ['ar', 'نفّذ سكربت صغير يطبع رسالة ثم اختبره'],
    ['fr', 'Écris un script qui affiche bonjour puis teste-le'],
  ];

  it.each(targetNounCases)('treats a direct request naming a %s software noun as direct execution', (_lang, input) => {
    const result = classifyWorkIntent(input);
    expect(result.kind).toBe('direct_execution');
    expect(result.options).toEqual(['direct', 'plan']);
  });

  it('still asks for clarification when action language names no target at all', () => {
    const result = classifyWorkIntent('just do it from the beginning');
    expect(result.kind).toBe('clarification_needed');
  });
});
