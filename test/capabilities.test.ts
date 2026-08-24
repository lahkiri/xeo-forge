import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { toolBlockedInMode, MODE_CAPABILITIES, CAPABILITY_RISK, TOOL_CAPABILITY, CAPABILITY_DESCRIPTION } from '../lib/agent/capabilities';

/* ------------------------------------------------------------------ */
/*  Capability manifest (Phase 2 foundation)                           */
/* ------------------------------------------------------------------ */

describe('capability manifest', () => {
  it('write capabilities are blocked in chat and planning, allowed in build', () => {
    for (const tool of ['file_write', 'file_edit', 'code_execute', 'preview']) {
      expect(toolBlockedInMode(tool, 'chat'), tool).toBe(true);
      expect(toolBlockedInMode(tool, 'planning'), tool).toBe(true);
      expect(toolBlockedInMode(tool, 'build'), tool).toBe(false);
    }
  });

  it('read capabilities are available in every mode', () => {
    for (const tool of ['file_read', 'file_list', 'git_op', 'http_request']) {
      expect(toolBlockedInMode(tool, 'chat'), tool).toBe(false);
      expect(toolBlockedInMode(tool, 'planning'), tool).toBe(false);
    }
  });

  it('every mapped tool has a risk class and every capability has a description', () => {
    for (const cap of Object.values(TOOL_CAPABILITY)) {
      expect(CAPABILITY_RISK[cap], cap).toBeDefined();
    }
    // Descriptions cover the full vocabulary.
    const all = Object.keys(CAPABILITY_RISK) as (keyof typeof CAPABILITY_RISK)[];
    expect(Object.keys(CAPABILITY_DESCRIPTION).length).toBe(all.length);
  });

  it('mirrors executeTool enforcement: the manifest never widens what tools.ts locks', () => {
    // WRITE_TOOLS in tools.ts must all map to mutate-risk capabilities.
    const toolsSrc = fs.readFileSync(path.resolve(__dirname, '../lib/agent/tools.ts'), 'utf8');
    const writeToolsMatch = toolsSrc.match(/WRITE_TOOLS = new Set\(\[([^\]]+)\]/)?.[1] ?? '';
    const writeTools = writeToolsMatch.split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    expect(writeTools.length).toBeGreaterThan(0);
    for (const tool of writeTools) {
      const cap = TOOL_CAPABILITY[tool];
      expect(cap, `${tool} must be in the manifest`).toBeDefined();
      expect(CAPABILITY_RISK[cap], `${tool} must be mutate-risk`).toBe('mutate');
    }
  });
});
