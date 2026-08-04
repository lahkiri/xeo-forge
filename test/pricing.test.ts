import { describe, it, expect } from 'vitest';
import { TASK_CREATE_COST, CREDITS_PER_TOOL_CALL } from '@/lib/credits/pricing';

describe('pricing constants', () => {
  it('uses default task-create cost when env unset', () => {
    expect(TASK_CREATE_COST).toBe(2);
  });

  it('uses default per-tool-call cost when env unset', () => {
    expect(CREDITS_PER_TOOL_CALL).toBe(1);
  });

  it('costs are positive finite numbers', () => {
    expect(Number.isFinite(TASK_CREATE_COST)).toBe(true);
    expect(Number.isFinite(CREDITS_PER_TOOL_CALL)).toBe(true);
    expect(TASK_CREATE_COST).toBeGreaterThan(0);
    expect(CREDITS_PER_TOOL_CALL).toBeGreaterThan(0);
  });
});
