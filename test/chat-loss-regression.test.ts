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
 *   L3 ChatClient  — the streamed answer survives the terminal transition:
 *                    summary appended only when nothing streamed; a promotion
 *                    effect pins streamed prose into messages; server truth
 *                    sync adopts longer initialMessages after refresh.
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

describe('L3 client: the streamed answer survives the terminal transition', () => {
  // v1.23.1 regression (live-probe r1/p1, 2026-08-28): the old L3 pinned a
  // dedupe that SKIPPED appending whenever the done-summary was contained in
  // the streamed text, relying on a reload that nothing ever scheduled. With
  // v1.23's chat finalize (summary == full prose) this deleted the answer from
  // the UI the instant the status went terminal: the user saw the reply flash
  // for ~0.5s and vanish. The contract below pins the corrected behavior.
  const client = readSrc('app/chat/ChatClient.tsx');

  it('done handler appends the summary ONLY when the run streamed no text', () => {
    // Nothing streamed → the summary IS what finalizeComplete persisted.
    expect(client).toMatch(/if \(summary && !streamedNow\) \{/);
  });

  it('the old containment-skip that vanished the answer is gone', () => {
    expect(client).not.toMatch(/streamedNow\.includes\(summary\)/);
  });

  it('a promotion effect pins the streamed answer into messages on the streaming→terminal edge', () => {
    expect(client).toMatch(/Terminal transition: the answer must survive it/);
    // Reconstructs the just-ended run's segment (done-closed or poll-adopted),
    // because splitRuns moves the streamed text out of currentRunText the
    // moment the done event lands in the events state.
    expect(client).toMatch(
      /if \(last\.type === 'done'\) \{[\s\S]*?rawText = evts[\s\S]*?\.join\(''\);/,
    );
    expect(client).toMatch(/promotedThroughSeqRef\.current = endSeq;/);
    // Idempotent: content-checked against the tail, never double-appended.
    expect(client).toMatch(/tail\.content\.trim\(\) === streamed\) return prev;/);
  });

  it('server truth sync adopts longer initialMessages after router.refresh()', () => {
    // useState ignores new props — without this effect the v1.22 comment
    // "refresh surfaces the persisted answer" was a false promise.
    expect(client).toMatch(
      /initialMessages\.length > prev\.length \? initialMessages : prev/,
    );
  });

  it('a brand-new thread mounts with one bounded catch-up refresh for the goal row', () => {
    expect(client).toMatch(/didCatchUpRef/);
    expect(client).toMatch(/setTimeout\(\(\) => router\.refresh\(\), 1500\)/);
  });
});
