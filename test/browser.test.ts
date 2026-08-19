import { describe, expect, it } from 'vitest';
import { browserActionIsReadOnly } from '@/lib/agent/browser';
import { CHAT_TOOLS, PLANNING_TOOLS, schemasForMode } from '@/lib/agent/tools';

describe('local browser capability policy', () => {
  it('keeps inspection actions read-only', () => {
    expect(browserActionIsReadOnly('state')).toBe(true);
    expect(browserActionIsReadOnly('read_page')).toBe(true);
    expect(browserActionIsReadOnly('screenshot')).toBe(true);
    expect(browserActionIsReadOnly('navigate')).toBe(false);
    expect(browserActionIsReadOnly('click')).toBe(false);
    expect(browserActionIsReadOnly('type')).toBe(false);
  });

  it('advertises browser inspection to Chat and Planning but never write tools', () => {
    expect(CHAT_TOOLS.has('browser')).toBe(true);
    expect(PLANNING_TOOLS.has('browser')).toBe(true);
    expect(schemasForMode('chat').some((tool) => tool.function.name === 'browser')).toBe(true);
    expect(schemasForMode('planning').some((tool) => tool.function.name === 'file_write')).toBe(false);
  });
});
