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
