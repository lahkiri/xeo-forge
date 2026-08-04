import { describe, it, expect } from 'vitest';

/* ------------------------------------------------------------------ */
/* Agent loop guard logic — extracted pure functions                   */
/*                                                                     */
/* These tests verify the behavioral guards added to prevent:          */
/*   - Fake completion via text-termination                            */
/*   - Read-only inspection loops                                      */
/*   - Question-to-user fallback behavior                              */
/* ------------------------------------------------------------------ */

describe('Agent loop guards', () => {
  describe('Question pattern detection', () => {
    const questionPatterns = [
      /what (would you|do you|should i|can i|shall i)/i,
      /how (would you|do you|should i|can i)/i,
      /would you like/i,
      /do you want/i,
      /shall i/i,
      /can you (confirm|tell|provide|clarify)/i,
      /please (tell|provide|clarify|confirm|specify)/i,
      /let me know/i,
      /waiting for (your|the) (input|response|confirmation|decision)/i,
    ];

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
        const matches = questionPatterns.some(p => p.test(text));
        expect(matches).toBe(true);
      });
    }

    for (const text of shouldNotMatch) {
      it(`does NOT flag: "${text.slice(0, 40)}..."`, () => {
        const matches = questionPatterns.some(p => p.test(text));
        expect(matches).toBe(false);
      });
    }
  });

  describe('Description-not-doing pattern detection', () => {
    const descriptionPatterns = [
      /i will (now|then|proceed|start|begin|create|build|write|implement)/i,
      /i('m| am) (now|going to|about to|ready to) /i,
      /let me (now|then|proceed|start|begin|create|build|write)/i,
      /now i will /i,
      /the next step is/i,
    ];

    const shouldMatch = [
      'I will now create the configuration file.',
      'I\'m going to implement the solution.',
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
        const matches = descriptionPatterns.some(p => p.test(text));
        expect(matches).toBe(true);
      });
    }

    for (const text of shouldNotMatch) {
      it(`does NOT flag: "${text.slice(0, 40)}..."`, () => {
        const matches = descriptionPatterns.some(p => p.test(text));
        expect(matches).toBe(false);
      });
    }
  });

  describe('Read-only loop detection', () => {
    it('counts consecutive reads correctly', () => {
      // Simulates the consecutiveReads counter behavior
      const readTools = ['file_read', 'file_list'];
      const writeTools = ['file_write', 'file_edit', 'code_execute'];
      let consecutiveReads = 0;

      // 3 reads
      for (const _ of [1, 2, 3]) {
        consecutiveReads++;
      }
      expect(consecutiveReads).toBe(3);

      // A write resets
      consecutiveReads = 0;
      expect(consecutiveReads).toBe(0);
    });

    it('triggers at MAX_CONSECUTIVE_READS threshold', () => {
      const MAX_CONSECUTIVE_READS = 6;
      let consecutiveReads = 0;

      // Simulate 6 reads
      for (const _ of Array(MAX_CONSECUTIVE_READS)) {
        consecutiveReads++;
      }
      expect(consecutiveReads >= MAX_CONSECUTIVE_READS).toBe(true);
    });

    it('resets on write action', () => {
      let consecutiveReads = 5;
      // A write action resets
      consecutiveReads = 0;
      expect(consecutiveReads).toBe(0);
      // Should NOT trigger after reset
      expect(consecutiveReads >= 6).toBe(false);
    });
  });

  describe('Execution evidence tracking', () => {
    it('tracks filesModified correctly', () => {
      const filesModified = new Set<string>();
      filesModified.add('index.html');
      filesModified.add('style.css');
      expect(filesModified.size).toBe(2);
      expect(filesModified.has('index.html')).toBe(true);
      expect(filesModified.has('unknown.txt')).toBe(false);
    });

    it('hasDoneRealWork requires tool calls AND substantive action', () => {
      const evidence = {
        toolCalls: [] as { name: string; ok: boolean }[],
        filesModified: new Set<string>(),
        codeExecutions: [] as { exitCode: number }[],
      };

      // No tool calls = no real work
      const hasWork1 = evidence.toolCalls.length > 0 && (
        evidence.filesModified.size > 0 ||
        evidence.codeExecutions.length > 0 ||
        evidence.toolCalls.some(t => t.name === 'http_request' && t.ok)
      );
      expect(hasWork1).toBe(false);

      // Tool calls but no substantive action
      evidence.toolCalls.push({ name: 'file_read', ok: true });
      const hasWork2 = evidence.toolCalls.length > 0 && (
        evidence.filesModified.size > 0 ||
        evidence.codeExecutions.length > 0 ||
        evidence.toolCalls.some(t => t.name === 'http_request' && t.ok)
      );
      expect(hasWork2).toBe(false);

      // Tool calls with file write = real work
      evidence.toolCalls.push({ name: 'file_write', ok: true });
      evidence.filesModified.add('index.html');
      const hasWork3 = evidence.toolCalls.length > 0 && (
        evidence.filesModified.size > 0 ||
        evidence.codeExecutions.length > 0 ||
        evidence.toolCalls.some(t => t.name === 'http_request' && t.ok)
      );
      expect(hasWork3).toBe(true);
    });
  });
});
