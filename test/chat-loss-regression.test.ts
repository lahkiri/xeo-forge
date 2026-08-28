/**
 * v1.19.1 regression: chat mode lost the real answer.
 *
 * Live evidence (task 6350ea92, 2026-08-25): user sent "اهلا", the model
 * streamed 169 text deltas (2405 chars) — then called task_complete with a
 * 247-char procedural summary. The summary was persisted as the only
 * assistant message; the 2158-char real answer existed solely in task_events.
 *
 * Three layers fixed & pinned here (source-contract style, like
 * test/cancellation.test.ts):
 *   L1 loop.ts     — chatTextBuffer accumulates chat deltas and is passed to
 *                    finalizeComplete as chatProse on EVERY termination path.
 *   L2 prompts.ts  — chat has its own CHAT_SYSTEM_PROMPT (no task_complete theater).
 *   L3 ChatClient  — done handler skips appending a summary that is contained
 *                    in the text the user just watched stream.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('L1 loop: chat prose is accumulated and delivered', () => {
  const src = readSrc('lib/agent/loop.ts');

  it('accumulates chat deltas into chatTextBuffer', () => {
    expect(src).toMatch(/if \(mode === 'chat' && textBuf\.trim\(\)\) \{\s*chatTextBuffer \+= textBuf;/);
  });

  it('passes chatTextBuffer to finalizeComplete on all five termination paths', () => {
    const calls = src.match(/finalizeComplete\(/g) || [];
    // definition + 5 call sites
    expect(calls.length).toBe(7);
    const withProse = (src.match(/chatTextBuffer\);/g) || []).length;
    expect(withProse).toBeGreaterThanOrEqual(5);
  });

  it('finalizeComplete persists the verbatim prose in chat when richer than summary', () => {
    expect(src).toMatch(/mode === 'chat' && chatProse && chatProse\.trim\(\)\.length > summary\.trim\(\)\.length/);
    expect(src).toMatch(/appendMessage\(taskId, 'assistant', persistedText\)/);
  });
});

describe('L2 prompts: chat speaks its own contract', () => {
  it('exports a dedicated CHAT_SYSTEM_PROMPT', () => {
    const prompts = readSrc('lib/agent/prompts.ts');
    expect(prompts).toContain('export const CHAT_SYSTEM_PROMPT');
    expect(prompts).toMatch(/CONVERSATION mode/);
    expect(prompts).toMatch(/There is no task_complete here/);
  });

  it('loop selects it for chat mode before planning/build branches', () => {
    const src = readSrc('lib/agent/loop.ts');
    const iChat = src.indexOf("mode === 'chat'") ;
    const iPlanning = src.indexOf("systemPrompt = PLANNING_SYSTEM_PROMPT");
    expect(iChat).toBeGreaterThan(-1);
    expect(iChat).toBeLessThan(iPlanning);
    expect(src).toMatch(/systemPrompt = CHAT_SYSTEM_PROMPT;/);
  });
});

describe('L3 client: no duplicate terse bubble after streamed prose', () => {
  it('done handler skips a summary contained in the just-streamed text', () => {
    const client = readSrc('app/chat/ChatClient.tsx');
    expect(client).toMatch(/streamedNow\.includes\(summary\)/);
  });

  it('still appends summaries for normal cases (guard is containment-only)', () => {
    const client = readSrc('app/chat/ChatClient.tsx');
    // The original append path must remain after the guard.
    const iGuard = client.indexOf("streamedNow.includes(summary)");
    const iAppend = client.indexOf("setMessages((prev) => {", iGuard);
    expect(iGuard).toBeGreaterThan(-1);
    expect(iAppend).toBeGreaterThan(iGuard);
  });
});
