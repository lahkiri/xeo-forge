import { describe, it, expect } from 'vitest';
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
