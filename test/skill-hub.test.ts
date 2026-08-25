import { describe, expect, it } from 'vitest';
import { CHAT_TOOLS, PLANNING_TOOLS, WRITE_TOOLS, schemasForMode } from '../lib/agent/tools';

describe('skill hub progressive disclosure tool', () => {
  it('advertises skill_view in read-only modes', () => {
    expect(CHAT_TOOLS.has('skill_view')).toBe(true);
    expect(PLANNING_TOOLS.has('skill_view')).toBe(true);
    expect(schemasForMode('chat').some((tool) => tool.function.name === 'skill_view')).toBe(true);
    expect(schemasForMode('planning').some((tool) => tool.function.name === 'skill_view')).toBe(true);
  });

  it('does not classify skill_view as a mutating capability', () => {
    expect(WRITE_TOOLS.has('skill_view')).toBe(false);
  });
});
