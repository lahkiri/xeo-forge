import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { registerRun, cancelRun, isRunActive, clearRuns } from '../lib/agent/cancellation';

/* ------------------------------------------------------------------ */
/*  Run cancellation (P1 from the risk register)                       */
/*                                                                     */
/*  The product had no stop control: closing the SSE tab did nothing   */
/*  to the server-side loop. This suite pins the cooperative registry  */
/*  contract and the loop's integration points.                        */
/* ------------------------------------------------------------------ */

beforeEach(() => clearRuns());

describe('cancellation registry', () => {
  it('register → active → cancel → inactive', () => {
    const controller = new AbortController();
    const unregister = registerRun('task-1', controller);
    expect(isRunActive('task-1')).toBe(true);

    expect(cancelRun('task-1')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(isRunActive('task-1')).toBe(false);

    unregister();
  });

  it('cancel of an unknown task returns false (honest no-op)', () => {
    expect(cancelRun('ghost')).toBe(false);
  });

  it('double cancel returns false the second time', () => {
    const controller = new AbortController();
    registerRun('task-2', controller);
    expect(cancelRun('task-2')).toBe(true);
    expect(cancelRun('task-2')).toBe(false);
  });

  it('unregister does not delete a replacement controller', () => {
    const first = new AbortController();
    const second = new AbortController();
    const unregisterFirst = registerRun('task-3', first);
    registerRun('task-3', second);
    unregisterFirst();
    // The second registration survives.
    expect(isRunActive('task-3')).toBe(true);
    expect(cancelRun('task-3')).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(first.signal.aborted).toBe(false);
  });

  it('the abort reason is operator cancellation', () => {
    const controller = new AbortController();
    registerRun('task-4', controller);
    cancelRun('task-4');
    expect(controller.signal.reason).toBeInstanceOf(Error);
    expect((controller.signal.reason as Error).message).toContain('operator');
  });
});

describe('the loop honours cancellation (source contract)', () => {
  const loopSource = fs.readFileSync(path.resolve(__dirname, '../lib/agent/loop.ts'), 'utf8');

  it('registers a controller and unregisters in finally', () => {
    expect(loopSource).toContain('registerRun(taskId, runAbort)');
    // CRLF-agnostic: the repo may be checked out with either line ending.
    // v1.20.1: unregister is preceded by prose-map cleanup (audit A2).
    const finallyRe = /finally \{(?:\r?\n {4}liveChatProse\.delete\(taskId\);)\r?\n {4}unregisterRun\(\);/;
    expect(loopSource).toMatch(finallyRe);
  });

  it('checks the signal every iteration and exits as cancelled', () => {
    expect(loopSource).toMatch(/if \(runAbort\.signal\.aborted\) \{[\s\S]{0,300}status: 'cancelled'/);
  });

  it('the provider stream receives the signal (not just SSE close)', () => {
    expect(loopSource).toContain('signal: runAbort.signal');
  });

  it('an abort during a model call records cancelled, not failed', () => {
    expect(loopSource).toMatch(/if \(runAbort\.signal\.aborted\) \{[\s\S]{0,200}cancelled/);
  });
});

describe('the cancel route and UI exist (source contract)', () => {
  it('POST /api/tasks/:id/cancel exists with owner check and terminal cleanup', () => {
    const route = fs.readFileSync(path.resolve(__dirname, '../app/api/tasks/[id]/cancel/route.ts'), 'utf8');
    expect(route).toContain('assertOwnerOrAdmin');
    expect(route).toContain('cancelRun(params.id)');
    expect(route).toContain('killSessionsForTask(params.id)');
    expect(route).toContain("status: 409"); // non-running cancel is honest, not silent
  });

  it('the Workbench shows a Cancel control only while running', () => {
    const work = fs.readFileSync(path.resolve(__dirname, '../app/work/WorkClient.tsx'), 'utf8');
    expect(work).toMatch(/isRunning && \(\s*\n\s*<Button[^>]*\n?[^<]*Cancel/s);
  });

  it("'cancelled' is a first-class terminal status everywhere", () => {
    const types = fs.readFileSync(path.resolve(__dirname, '../lib/types.ts'), 'utf8');
    expect(types).toMatch(/'cancelled'/);
    const timeline = fs.readFileSync(path.resolve(__dirname, '../lib/agent/timeline.ts'), 'utf8');
    expect(timeline).toMatch(/isTerminalStatus[\s\S]{0,200}'cancelled'/);
  });
});
