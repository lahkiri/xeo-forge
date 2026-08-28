/**
 * v1.23 Phase-0 regression smoke — run with:
 *   node --experimental-strip-types scripts/smoke_v123_phase0.mjs
 *
 * Pins the two Phase-0 fixes without vitest (sandbox cannot build
 * better-sqlite3 for a full install; CI runs the vitest twin):
 *   1. separateThinkTags — inline <think> contract (closed/open/multi/plain)
 *   2. splitRuns + run-text integrity — seq identity, verbatim chat prose
 *   3. buildTimeline — live run turn renders the CLEANED answer
 *   4. loop.ts source contract — chat finalizes on first text termination
 *      (grep-level guard: the chat branch must exist ABOVE the build-mode
 *      detectors in the no-tool-calls path)
 */
import { readFileSync } from 'node:fs';
import {
  separateThinkTags,
  splitRuns,
  parseEvents,
  buildTimeline,
} from '../lib/agent/timeline.ts';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    fail++;
    console.error(`FAIL  ${name}\n      ${err?.message ?? err}`);
  }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

console.log('— separateThinkTags —');
check('plain answer untouched', () => {
  const r = separateThinkTags('Hello world');
  eq(r.answer, 'Hello world');
  eq(r.reasoning, '');
});
check('closed think block extracted, answer clean', () => {
  const r = separateThinkTags('<think>let me consider X</think>\n\nThe answer is 4.');
  eq(r.reasoning, 'let me consider X');
  eq(r.answer, 'The answer is 4.');
});
check('multiple blocks, order preserved', () => {
  const r = separateThinkTags('<think>one</think>mid<think>two</think>end');
  eq(r.reasoning, 'one\ntwo');
  eq(r.answer, 'midend');
});
check('unterminated trailing think = reasoning, never answer', () => {
  const r = separateThinkTags('Final: 42\n<think>cut off mid');
  eq(r.answer, 'Final: 42');
  eq(r.reasoning, 'cut off mid');
});
check('partial-only think stream: empty answer', () => {
  const r = separateThinkTags('<think>only thinking so far');
  eq(r.answer, '');
  eq(r.reasoning, 'only thinking so far');
});
check('no pathological backtracking on big input', () => {
  const big = '<think>x</think>'.repeat(2000) + 'answer';
  const t0 = Date.now();
  const r = separateThinkTags(big);
  if (Date.now() - t0 > 500) throw new Error('too slow');
  eq(r.answer, 'answer');
});

console.log('— run text integrity —');
const ev = (seq, type, data) => ({
  seq,
  type,
  content: JSON.stringify(data),
  task_id: 't1',
  created_at: new Date(2026, 0, 1, 12, 0, seq).toISOString(),
});
check('chat prose verbatim through splitRuns (live, pre-done) + separation', () => {
  // LIVE path: no done event yet — currentRunText accumulates the streamed prose.
  const live = parseEvents([ev(1, 'text', { delta: 'مرحبا! ' }), ev(2, 'text', { delta: 'كيف أساعدك؟' })]);
  const { currentRunText } = splitRuns(live);
  eq(currentRunText, 'مرحبا! كيف أساعدك؟');
  eq(separateThinkTags(currentRunText).answer, 'مرحبا! كيف أساعدك؟');
});
check('after done, currentRunText empties by design (persisted messages win)', () => {
  const events = parseEvents([
    ev(1, 'text', { delta: 'مرحبا! كيف أساعدك؟' }),
    ev(2, 'done', { status: 'completed', summary: 'مرحبا! كيف أساعدك؟' }),
  ]);
  eq(splitRuns(events).currentRunText, '');
});
check('think-tagged live stream splits correctly', () => {
  const events = parseEvents([
    ev(1, 'text', { delta: '<think>check the premise</think>' }),
    ev(2, 'text', { delta: '42 is the answer.' }),
  ]);
  const s = separateThinkTags(splitRuns(events).currentRunText);
  eq(s.answer, '42 is the answer.');
  eq(s.reasoning, 'check the premise');
});

console.log('— work timeline —');
check('live run turn renders cleaned answer', () => {
  const events = parseEvents([
    ev(1, 'text', { delta: '<think>plan quietly</think>' }),
    ev(2, 'text', { delta: 'Working on it.' }),
  ]);
  const timeline = buildTimeline({ events, messages: [], status: 'running', goal: 'do the thing' });
  const run = timeline.find((t) => t.id === -1);
  if (!run) throw new Error('no live run turn');
  eq(run.content, 'Working on it.');
});
check('finished run uses persisted messages verbatim', () => {
  const events = parseEvents([ev(1, 'done', { status: 'completed', summary: 'done' })]);
  const timeline = buildTimeline({
    events,
    messages: [
      { id: 1, role: 'user', content: 'hi', active: 1, task_id: 't1', created_at: '' },
      { id: 2, role: 'assistant', content: 'persisted answer', active: 1, task_id: 't1', created_at: '' },
    ],
    status: 'completed',
    goal: 'g',
  });
  eq(timeline.map((t) => t.content).join('|'), 'hi|persisted answer');
});

console.log('— loop.ts source contracts (grep-level guards) —');
const loopSrc = readFileSync(new URL('../lib/agent/loop.ts', import.meta.url), 'utf8');
check('chat finalizes in the no-tool-calls path ABOVE build detectors', () => {
  const noToolIdx = loopSrc.indexOf('// No tool calls — handle trailing text carefully.');
  if (noToolIdx === -1) throw new Error('no-tool-calls marker missing');
  const chatIdx = loopSrc.indexOf("if (mode === 'chat') {", noToolIdx);
  const questionIdx = loopSrc.indexOf('textAsksUserQuestion(text)', noToolIdx);
  if (chatIdx === -1) throw new Error('chat finalize branch missing after no-tool-calls marker');
  if (questionIdx === -1) throw new Error('build detectors moved?');
  if (chatIdx > questionIdx) throw new Error('chat branch must run BEFORE textAsksUserQuestion');
});
check('inline think extraction exists in loop.ts', () => {
  if (!loopSrc.includes("match(/<think>[\\s\\S]*?<\\/think>/g)")) throw new Error('closed-think extraction missing');
  if (!loopSrc.includes('inline_think_tag')) throw new Error('reasoning source marker missing');
});

console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
