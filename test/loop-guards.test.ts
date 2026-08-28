import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_REQUIRED_NUDGE,
  AUTONOMY_VIOLATION_NUDGE,
  AUTONOMY_VIOLATION_NUDGE_FALLBACK,
  DESCRIPTION_PATTERNS,
  MAX_CONSECUTIVE_READS,
  QUESTION_PATTERNS,
  READ_TOOLS,
  WRITE_TOOLS,
  createExecutionEvidence,
  hasDoneRealWork,
  incompleteTodosNudge,
  isDescribingNotDoing,
  isQuestionToUser,
  isReadTool,
  isWriteTool,
  nextConsecutiveReads,
  readOnlyLoopDetected,
  readOnlyLoopNudge,
} from '../lib/agent/guards';

/* ------------------------------------------------------------------ */
/* Agent loop guards — AGENTS.md section 5.5                          */
/*                                                                     */
/* These tests import the SAME functions lib/agent/loop.ts calls. They */
/* previously re-declared the pattern arrays inline, which meant they  */
/* stayed green even if the real guards were deleted.                  */
/* ------------------------------------------------------------------ */

describe('Agent loop guards', () => {
  describe('Question pattern detection', () => {
    const shouldMatch = [
      'What would you like me to do?',
      'How should I proceed?',
      'Would you like me to continue?',
      'Do you want me to fix this?',
      'Shall I proceed with the changes?',
      'Can you confirm the API endpoint?',
      'Please tell me the correct value.',
      'Let me know if this works.',
      'Waiting for your input.',
    ];

    const shouldNotMatch = [
      'I have completed the task.',
      'The file was created successfully.',
      'I fixed the bug by updating the config.',
      'Build completed with no errors.',
      'All tests pass now.',
    ];

    for (const text of shouldMatch) {
      it(`detects question: "${text.slice(0, 40)}..."`, () => {
        expect(isQuestionToUser(text)).toBe(true);
      });
    }

    for (const text of shouldNotMatch) {
      it(`does NOT flag: "${text.slice(0, 40)}..."`, () => {
        expect(isQuestionToUser(text)).toBe(false);
      });
    }

    it('exposes a non-empty pattern set', () => {
      expect(QUESTION_PATTERNS.length).toBeGreaterThan(0);
    });

    it('matches case-insensitively', () => {
      expect(isQuestionToUser('WOULD YOU LIKE ME TO CONTINUE')).toBe(true);
    });

    it('detects a question buried mid-paragraph', () => {
      const text =
        'I inspected the repository and found three candidate files. ' +
        'Shall I proceed with editing them? I can also skip the tests.';
      expect(isQuestionToUser(text)).toBe(true);
    });
  });

  describe('Description-not-doing pattern detection', () => {
    const shouldMatch = [
      'I will now create the configuration file.',
      "I'm going to implement the solution.",
      'Let me now write the code.',
      'Now I will build the component.',
      'The next step is to run the tests.',
    ];

    const shouldNotMatch = [
      'I have created the configuration file.',
      'The code has been implemented.',
      'All tests pass.',
      'Task completed successfully.',
    ];

    for (const text of shouldMatch) {
      it(`detects description: "${text.slice(0, 40)}..."`, () => {
        expect(isDescribingNotDoing(text)).toBe(true);
      });
    }

    for (const text of shouldNotMatch) {
      it(`does NOT flag: "${text.slice(0, 40)}..."`, () => {
        expect(isDescribingNotDoing(text)).toBe(false);
      });
    }

    it('exposes a non-empty pattern set', () => {
      expect(DESCRIPTION_PATTERNS.length).toBeGreaterThan(0);
    });

    it('only inspects the tail, so an early plan followed by real results passes', () => {
      const text = `${'I will now create the file. '}${'Work log entry. '.repeat(80)}Done: 4 files written and tests pass.`;
      expect(isDescribingNotDoing(text)).toBe(false);
    });

    it('flags a trailing intent even after a long body', () => {
      const text = `${'Work log entry. '.repeat(80)}The next step is to wire the router.`;
      expect(isDescribingNotDoing(text)).toBe(true);
    });
  });

  describe('Tool classification', () => {
    it('classifies read tools', () => {
      for (const name of READ_TOOLS) {
        expect(isReadTool(name)).toBe(true);
        expect(isWriteTool(name)).toBe(false);
      }
    });

    it('classifies write tools', () => {
      for (const name of WRITE_TOOLS) {
        expect(isWriteTool(name)).toBe(true);
        expect(isReadTool(name)).toBe(false);
      }
    });

    it('treats neutral tools as neither read nor write', () => {
      for (const name of ['http_request', 'browser', 'task_complete']) {
        expect(isReadTool(name)).toBe(false);
        expect(isWriteTool(name)).toBe(false);
      }
    });
  });

  describe('Read-only loop detection', () => {
    it('increments on reads', () => {
      let reads = 0;
      for (const tool of ['file_read', 'file_list', 'file_read']) {
        reads = nextConsecutiveReads(reads, tool);
      }
      expect(reads).toBe(3);
    });

    it('resets on any write tool', () => {
      let reads = 5;
      reads = nextConsecutiveReads(reads, 'file_write');
      expect(reads).toBe(0);
      expect(readOnlyLoopDetected(reads)).toBe(false);
    });

    it('leaves the counter untouched for neutral tools', () => {
      expect(nextConsecutiveReads(4, 'http_request')).toBe(4);
      expect(nextConsecutiveReads(4, 'task_complete')).toBe(4);
    });

    it('triggers exactly at MAX_CONSECUTIVE_READS', () => {
      let reads = 0;
      for (let i = 0; i < MAX_CONSECUTIVE_READS - 1; i++) {
        reads = nextConsecutiveReads(reads, 'file_read');
      }
      expect(readOnlyLoopDetected(reads)).toBe(false);
      reads = nextConsecutiveReads(reads, 'file_read');
      expect(readOnlyLoopDetected(reads)).toBe(true);
    });

    it('produces a nudge naming the observed read count', () => {
      expect(readOnlyLoopNudge(7)).toContain('7');
      expect(readOnlyLoopNudge(7)).toMatch(/READ-ONLY LOOP DETECTED/);
    });
  });

  describe('Execution evidence tracking', () => {
    it('starts empty and reports no work', () => {
      const evidence = createExecutionEvidence();
      expect(evidence.toolCalls).toHaveLength(0);
      expect(evidence.filesModified.size).toBe(0);
      expect(hasDoneRealWork(evidence)).toBe(false);
    });

    it('tracks filesModified as a set', () => {
      const evidence = createExecutionEvidence();
      evidence.filesModified.add('index.html');
      evidence.filesModified.add('style.css');
      evidence.filesModified.add('index.html');
      expect(evidence.filesModified.size).toBe(2);
      expect(evidence.filesModified.has('unknown.txt')).toBe(false);
    });

    it('does not count reads alone as real work', () => {
      const evidence = createExecutionEvidence();
      evidence.toolCalls.push({ name: 'file_read', ok: true, ts: 1 });
      evidence.toolCalls.push({ name: 'file_list', ok: true, ts: 2 });
      expect(hasDoneRealWork(evidence)).toBe(false);
    });

    it('counts a file write as real work', () => {
      const evidence = createExecutionEvidence();
      evidence.toolCalls.push({ name: 'file_write', ok: true, ts: 1 });
      evidence.filesModified.add('index.html');
      expect(hasDoneRealWork(evidence)).toBe(true);
    });

    it('counts a code execution as real work', () => {
      const evidence = createExecutionEvidence();
      evidence.toolCalls.push({ name: 'code_execute', ok: true, ts: 1 });
      evidence.codeExecutions.push({ exitCode: 0, ts: 1 });
      expect(hasDoneRealWork(evidence)).toBe(true);
    });

    it('counts a successful http_request as real work', () => {
      const evidence = createExecutionEvidence();
      evidence.toolCalls.push({ name: 'http_request', ok: true, ts: 1 });
      expect(hasDoneRealWork(evidence)).toBe(true);
    });

    it('does NOT count a failed http_request as real work', () => {
      const evidence = createExecutionEvidence();
      evidence.toolCalls.push({ name: 'http_request', ok: false, ts: 1 });
      expect(hasDoneRealWork(evidence)).toBe(false);
    });
  });

  describe('Nudge copy', () => {
    it('states the autonomy violation on both paths', () => {
      expect(AUTONOMY_VIOLATION_NUDGE).toMatch(/AUTONOMY VIOLATION/);
      expect(AUTONOMY_VIOLATION_NUDGE_FALLBACK).toMatch(/AUTONOMY VIOLATION/);
    });

    it('demands action rather than description', () => {
      expect(ACTION_REQUIRED_NUDGE).toMatch(/task_complete/);
    });

    it('lists every pending todo with its status', () => {
      const nudge = incompleteTodosNudge([
        { id: '1', description: 'write the router', status: 'pending' },
        { id: '2', description: 'add tests', status: 'in_progress' },
      ]);
      expect(nudge).toContain('write the router');
      expect(nudge).toContain('add tests');
      expect(nudge).toContain('in_progress');
      expect(nudge).toContain('2 todo item(s)');
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Both loop paths share one guard implementation (AGENTS.md rule 1). */
/*                                                                     */
/*  loop.ts drives two protocols: native tool-calling, and an          */
/*  `<action>` fallback for models without function calling. Each used  */
/*  to carry its own copy of evidence recording and read counting, and  */
/*  they had already diverged — the fallback hand-rolled an if/else     */
/*  instead of calling nextConsecutiveReads(), and never called         */
/*  readOnlyLoopDetected() at all. On a model without function calling  */
/*  the read-only loop guard silently did not exist.                    */
/*                                                                     */
/*  A behavioural test would need a live model, a workspace and a DB.   */
/*  What actually needs locking is structural: that there is ONE        */
/*  implementation and BOTH paths reach it. So we assert on the source  */
/*  — the same technique test/events.test.ts uses to scan emit sites.   */
/* ------------------------------------------------------------------ */

describe('the read-only loop guard is reachable from both loop paths', () => {
  const loopSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'lib', 'agent', 'loop.ts'),
    'utf8',
  );

  it('defines the shared helpers exactly once', () => {
    const count = (needle: string) => loopSource.split(needle).length - 1;
    expect(count('const recordToolEvidence =')).toBe(1);
    expect(count('const checkReadOnlyLoop =')).toBe(1);
    expect(count('const evaluateCompletion =')).toBe(1);
  });

  it('calls each shared helper from the fallback, native, and parallel paths', () => {
    const count = (needle: string) => loopSource.split(needle).length - 1;
    // recordToolEvidence: fallback + native sequential + native parallel batch
    // + the v1.23 delegate_research interception.
    expect(count('await recordToolEvidence(')).toBe(4);
    // checkReadOnlyLoop runs once per iteration for BOTH native paths
    // (sequential and parallel share the post-loop call) plus the fallback.
    expect(count('await checkReadOnlyLoop()')).toBe(2);
    // task_complete evaluation only happens on the sequential paths — the
    // parallel batch is read-only by construction and cannot contain it.
    expect(count('await evaluateCompletion(')).toBe(2);
  });

  it('routes the fallback path through the shared helpers by name', () => {
    // `action.tool` only exists on the fallback path; `call.name` only on the
    // native one. Both must appear as arguments to the shared recorder.
    expect(loopSource).toContain('await recordToolEvidence(action.tool, action.args, obs)');
    expect(loopSource).toContain('await recordToolEvidence(call.name, args, obs)');
  });

  it('does not hand-roll read counting anywhere', () => {
    // The old fallback path incremented/reset a counter inline. Any assignment
    // to consecutiveReads outside the shared helper is that bug returning.
    const assignments = loopSource.match(/consecutiveReads\s*=/g) ?? [];
    // Exactly three: the initial declaration, the update inside
    // recordToolEvidence, and the reset inside checkReadOnlyLoop.
    expect(assignments).toHaveLength(3);
    expect(loopSource).toContain('consecutiveReads = nextConsecutiveReads(consecutiveReads, toolName)');
  });

  it('drives detection through the guards module rather than a local literal', () => {
    expect(loopSource).toContain("from './guards'");
    // The threshold may come from the resolved guard PROFILE (model tier);
    // what matters is that detection itself is the guards-module function,
    // not a re-declared local condition.
    expect(loopSource).toContain('readOnlyLoopDetected(consecutiveReads, guardProfile.maxConsecutiveReads)');
    expect(loopSource).toContain('readOnlyLoopNudge(consecutiveReads)');
    // MAX_CONSECUTIVE_READS must not be re-declared as a local literal.
    expect(loopSource).not.toMatch(/const MAX_CONSECUTIVE_READS\s*=/);
  });
});

/* ───────────────────────── guard profiles ───────────────────────── */

import {
  GUARD_PROFILES,
  guardProfileForModel,
} from '../lib/agent/guards';

describe('guard profiles by model tier', () => {
  it('frontier model families resolve to the strong profile', () => {
    for (const id of [
      'claude-opus-4-5',
      'claude-opus-4-1-20250805',
      'claude-sonnet-4-5',          // claude-4+ flagships
      'gpt-5.1',
      'gpt-5-chat-latest',
      'o3-mini',
      'o4-mini-high',
      'gemini-2.5-pro',
      'deepseek-r1',
      'deepseek-v3',
      'grok-4',
      'glm-4.6',
      'glm-5.3',
      'glm-5.2',
      'kimi-k2-0905-preview',
      'kimi-k3',
      'claude-fable-5',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'qwen3.8-max',
      'gemini-3.1-pro',
      'gpt-5.6-sol',
    ]) {
      expect(guardProfileForModel(id)).toBe('strong');
    }
  });

  it('weaker and unknown models keep the historical standard profile', () => {
    for (const id of [
      'gpt-4o-mini',
      'gpt-4.1',
      'claude-3-5-haiku',
      'claude-3-5-sonnet',
      'gemini-2.0-flash',
      'llama-3.3-70b',
      'mistral-large',
      'qwen2.5-coder',
      'qwen3-32b',      // small Qwen 3 tiers stay standard
      'glm-3-turbo',   // older GLM stays standard
      'deepseek-v2',
      '',
      undefined,
      null,
    ]) {
      expect(guardProfileForModel(id as string | null | undefined)).toBe('standard');
    }
  });

  it('the strong profile is strictly more permissive than standard', () => {
    expect(GUARD_PROFILES.strong.stagnationThreshold).toBeGreaterThan(GUARD_PROFILES.standard.stagnationThreshold);
    expect(GUARD_PROFILES.strong.maxConsecutiveReads).toBeGreaterThan(GUARD_PROFILES.standard.maxConsecutiveReads);
    // Standard keeps the historical numbers — no silent behavior change for
    // every existing deployment.
    expect(GUARD_PROFILES.standard.stagnationThreshold).toBe(3);
    expect(GUARD_PROFILES.standard.maxConsecutiveReads).toBe(6);
  });

  it('readOnlyLoopDetected honors the profile threshold', () => {
    // 9 reads: past standard's 6, under strong's 15.
    expect(readOnlyLoopDetected(9)).toBe(true);                       // default = standard
    expect(readOnlyLoopDetected(9, GUARD_PROFILES.standard.maxConsecutiveReads)).toBe(true);
    expect(readOnlyLoopDetected(9, GUARD_PROFILES.strong.maxConsecutiveReads)).toBe(false);
    expect(readOnlyLoopDetected(15, GUARD_PROFILES.strong.maxConsecutiveReads)).toBe(true);
  });
});

/* ─────────────── stagnation fingerprint: observations count ─────────────── */

describe('the stagnation fingerprint includes tool observations', () => {
  // THE DEFECT THIS PINS: a frontier model fixing a failing test runs the
  // SAME command repeatedly; arguments alone are identical every round, so
  // the old fingerprint counted a converging loop as stagnation and killed
  // productive runs. The observation prefix distinguishes them.
  const loopSource = fs.readFileSync(path.resolve(__dirname, '../lib/agent/loop.ts'), 'utf8');

  it('computeToolSignature takes an observations parameter', () => {
    expect(loopSource).toContain('function computeToolSignature(');
    expect(loopSource).toMatch(/observations/);
  });

  it('every signature call site passes observations', () => {
    const callSites = loopSource.match(/computeToolSignature\(/g) ?? [];
    expect(callSites.length).toBeGreaterThanOrEqual(4); // definition + 3 call sites
    // No call site uses the legacy single-argument form: every invocation
    // spreads over two lines or passes an array literal second argument.
    const legacy = loopServiceLegacyCalls(loopSource);
    expect(legacy).toEqual([]);
  });

  function loopServiceLegacyCalls(source: string): string[] {
    // A call site with no observations would still be valid TypeScript
    // (default []); find single-line invocations without a second argument.
    const lines = source.split('\n').map((l) => l.trim());
    return lines.filter((l) => /^const sig = computeToolSignature\(calls\);$/.test(l));
  }

  it('same arguments + different observations must differ (source contract)', () => {
    // Direct behavioral proof through the module: import the live function.
    // It is not exported (internal to the loop), so the contract is asserted
    // on the source: the fingerprint line includes the observation prefix.
    expect(loopSource).toContain('=>${observations[i].slice(0, 120)}');
  });

  it('the loop resolves thresholds from the model profile, not the constant', () => {
    expect(loopSource).toContain('guardProfileForModel(model.modelId)');
    expect(loopSource).toContain('guardProfile.stagnationThreshold');
    expect(loopSource).toContain('guardProfile.maxConsecutiveReads');
  });
});

/* ───────────── summary section gate: language affinity ───────────── */

import {
  SUMMARY_SECTION_MARKERS,
  validateSummarySections,
} from '../lib/agent/guards';

describe('validateSummarySections obeys LANGUAGE AFFINITY', () => {
  // THE DEFECT THIS PINS: the prompt orders the model to answer in the
  // user's language, but the gate used to accept only the English section
  // words. An Arabic-speaking user's perfectly structured Arabic summary
  // was rejected, retried, and could fail the run. A summary must never
  // fail the gate for obeying the language instruction.

  it('accepts a fully Arabic summary (the reported defect)', () => {
    const summary = `تم بناء الموقع بالكامل.

الافتراضات:
- رابط الديسكورد غير متوفر فاستخدمت رابطاً مؤقتاً

القرارات:
- اخترت متغيرات CSS بدل الأنماط المضمّنة

المشاكل المكتشفة:
- شريط التنقل يتداخل مع القسم الرئيسي تحت 768px

الحلول البديلة:
- استخدمت شعاراً بتدرج بسيط`;
    const result = validateSummarySections(summary);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('accepts a French summary', () => {
    const summary = `Site livré.

Hypothèses :
- Lien Discord indisponible, lien temporaire utilisé

Décisions :
- Variables CSS plutôt que styles inline

Problèmes :
- La navbar chevauche le hero sous 768px

Solutions de contournement :
- Logo en dégradé`;
    expect(validateSummarySections(summary).ok).toBe(true);
  });

  it('accepts a Spanish summary', () => {
    const summary = `Sitio completado.

Supuestos:
- Sin enlace de Discord, se usó un placeholder

Decisiones:
- Variables CSS

Problemas:
- Navbar solapa el hero

Solución alternativa:
- Logo degradado`;
    expect(validateSummarySections(summary).ok).toBe(true);
  });

  it('accepts a Russian summary', () => {
    const summary = `Сайт готов.

Допущения:
- Discord-ссылка недоступна

Решения:
- CSS-переменные

Проблемы:
- Навбар перекрывает hero

Обходной путь:
- Градиентный логотип`;
    expect(validateSummarySections(summary).ok).toBe(true);
  });

  it('still accepts the English-labeled contract (prompt-compliant output)', () => {
    const summary = `Built the site.

Assumptions:
- Discord link unavailable, used placeholder

Decisions:
- CSS variables over inline styles

Issues:
- Navbar overlaps hero below 768px

Workarounds:
- Gradient logo`;
    expect(validateSummarySections(summary).ok).toBe(true);
  });

  it('rejects a summary missing everything, naming all four sections', () => {
    const result = validateSummarySections('أكملت المهمة بنجاح دون أي تفاصيل.');
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      'Assumptions',
      'Decisions',
      'Issues/Limitations',
      'Workarounds/Placeholders',
    ]);
  });

  it('names only the sections that are actually missing (partial credit)', () => {
    const summary = `الافتراضات: لا يوجد\nالقرارات: لا يوجد`;
    const result = validateSummarySections(summary);
    expect(result.ok).toBe(false);
    // Arabic covered the first two; the last two must be the only gaps.
    expect(result.missing).toEqual(['Issues/Limitations', 'Workarounds/Placeholders']);
  });

  it('every marker list is non-empty (no vacuous section)', () => {
    for (const [section, markers] of Object.entries(SUMMARY_SECTION_MARKERS)) {
      expect(markers.length, section).toBeGreaterThan(0);
      // English stays first in every list: the deterministic contract.
      expect(markers[0]).toMatch(/[a-z]/);
    }
  });
});

/* ───────── parallel read-only batch: source contract ───────── */

describe('parallel read-only batch', () => {
  const loopSource = fs.readFileSync(path.resolve(__dirname, '../lib/agent/loop.ts'), 'utf8');

  it('exists: a whole-batch condition gates the parallel path', () => {
    expect(loopSource).toContain('calls.every((c) => isParallelSafeRead(');
    expect(loopSource).toContain('const MAX_PARALLEL_READS = 6');
  });

  it('only read-only tools qualify (writes, http, browser, MCP excluded)', () => {
    // isParallelSafeRead must whitelist by name, never blacklist.
    expect(loopSource).toMatch(/function isParallelSafeRead[\s\S]{0,400}file_read/);
    expect(loopSource).toMatch(/function isParallelSafeRead[\s\S]{0,500}GIT_READ_OPS/);
    // The whitelist must NOT admit the mutating/external tools.
    const fn = loopSource.match(/function isParallelSafeRead[\s\S]{0,700}?\n\}/)?.[0] ?? '';
    for (const banned of ['file_write', 'file_edit', 'code_execute', 'http_request', 'browser', 'preview', 'mcp__']) {
      expect(fn, `isParallelSafeRead must not admit ${banned}`).not.toContain(`'${banned}'`);
    }
  });

  it('results are emitted in CALL order, not completion order', () => {
    // The deterministic audit-stream contract: calls batch first, results
    // batch after Promise.all, both in calls order.
    expect(loopSource).toContain('const observations = await Promise.all(');
    expect(loopSource).toMatch(/for \(let i = 0; i < calls\.length; i\+\+\) \{\s*\n\s*const call = calls\[i\]/);
  });

  it('mixed batches fall back to sequential (no task_complete is dropped)', () => {
    // The parallel branch must be gated on EVERY call being a safe read, so a
    // batch of reads + task_complete runs the sequential path and the
    // completion call is never skipped. The old bug: filtering
    // task_complete out of executableCalls while flagging the batch handled.
    expect(loopSource).not.toContain('executableCalls');
  });

  it('terminal sessions are cleaned up when a run reaches a terminal state', () => {
    // v1.14 wiring: killSessionsForTask was a documented contract with zero
    // callers since inception. It must now be called from BOTH terminal
    // paths of the loop.
    const calls = loopSource.match(/killSessionsForTask\(taskId\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});

/* ─────────── opus-first-run: repetition + reasoning display ─────────── */

describe('the repetition defect (first real Opus-5 run)', () => {
  // THE DEFECT THIS PINS: on the first real-model run the agent answered a
  // question in full prose, our task_complete nudge made it re-emit the same
  // answer, the section-gate retry made it re-emit it AGAIN, and the summary
  // was persisted once more — the user saw the same message three times.

  const loopSource = fs.readFileSync(path.resolve(__dirname, '../lib/agent/loop.ts'), 'utf8');
  const guardsSource = fs.readFileSync(path.resolve(__dirname, '../lib/agent/guards.ts'), 'utf8');
  const chatSource = fs.readFileSync(path.resolve(__dirname, '../app/chat/ChatClient.tsx'), 'utf8');
  const workSource = fs.readFileSync(path.resolve(__dirname, '../app/work/WorkClient.tsx'), 'utf8');

  it('both nudges forbid repeating the answer the user already read', () => {
    expect(guardsSource).toMatch(/Do NOT repeat your previous answer/);
    expect(loopSource).toContain('do NOT repeat your');
  });

  it('finalizeComplete skips persisting a summary that restates the last message', () => {
    expect(loopSource).toContain('function summaryRestatesPrevious(');
    // v1.19.1: chat persists the verbatim streamed prose (chatProse); the
    // anti-duplicate guard now applies to whatever is chosen for persistence.
    expect(loopSource).toContain('function summaryRestatesPrevious(');
    expect(loopSource).toContain('summaryRestatesPrevious(persistedText, lastAssistant.content)');
  });

  it('reasoning deltas render — the capability models paid for is visible', () => {
    // The loop has always emitted reasoning events; no component rendered
    // them. Both surfaces must mount ThinkingBlock from the live run events.
    expect(fs.readFileSync(path.resolve(__dirname, '../components/ThinkingBlock.tsx'), 'utf8')).toContain('reasoningTextOf');
    expect(chatSource).toMatch(/<ThinkingBlock text=\{shownThinking\} live/);
    expect(workSource).toMatch(/<ThinkingBlock text=\{liveThinking\} live/);
  });
});
