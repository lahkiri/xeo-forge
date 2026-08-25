/**
 * Regression tests for the chat answer-loss bug (fixed in v1.19.1).
 *
 * Live evidence (task 6350ea92, installed app): a user sent "اهلا", the
 * model streamed 169 text deltas totaling 2,405 chars of real Arabic answer,
 * then called task_complete with a 247-char procedural summary. Only the
 * summary was persisted to messages; the client swapped the streamed prose
 * for the summary on 'done'. The user's actual answer vanished.
 *
 * These source-contract tests pin the fix so no refactor can reintroduce it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('chat answer preservation (loop.ts)', () => {
  const loop = readSrc('lib/agent/loop.ts');

  it('accumulates streamed prose across iterations in chat mode', () => {
    expect(loop).toMatch(/if \(mode === 'chat' && textBuf\.trim\(\)\) \{\s*chatTextBuffer \+= textBuf;/);
  });

  it('passes the accumulated prose into finalizeComplete at every call site', () => {
    const sites = loop.match(/finalizeComplete\(taskId[^;]*\);/g) || [];
    expect(sites.length).toBeGreaterThanOrEqual(5);
    for (const site of sites) {
      expect(site, `call site missing chatTextBuffer: ${site}`).toContain('chatTextBuffer');
    }
  });

  it('persists the richer of (streamed prose, summary) as the assistant message', () => {
    expect(loop).toMatch(
      /mode === 'chat' && chatProse && chatProse\.trim\(\)\.length > summary\.trim\(\)\.length\s*\?\s*chatProse\.trim\(\)\s*:\s*summary;/,
    );
  });

  it('keeps appendMessage fed by the persisted choice, not always the summary', () => {
    expect(loop).toMatch(/appendMessage\(taskId, 'assistant', persistedText\)/);
    // The old unconditional summary persistence must be gone.
    expect(loop).not.toMatch(/appendMessage\(taskId, 'assistant', summary\)/);
  });

  it('does not touch planning/build persistence semantics', () => {
    // planOverride logic must remain for planning.
    expect(loop).toMatch(/planOverride && planOverride\.trim\(\)\.length > summary\.trim\(\)\.length/);
  });
});

describe('client-side swap guard (ChatClient)', () => {
  const client = readSrc('app/chat/ChatClient.tsx');

  it("only appends the done-summary when it is NOT already covered by streamed text", () => {
    // Existing guard keeps exact duplicates out; the deeper protection is that
    // the loop now persists prose, making reload and live views consistent.
    expect(client).toMatch(/last\.content === summary\) return prev;/);
  });
});
