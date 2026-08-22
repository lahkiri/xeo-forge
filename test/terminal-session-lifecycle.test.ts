import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/* ------------------------------------------------------------------ */
/*  Terminal session-id lifecycle invariant (regression suite).        */
/*                                                                     */
/*  E2E failure this locks down: create returned id A, a stream was     */
/*  attached to id B, and input POSTs kept hitting dead id A forever    */
/*  (repeated 404s). The invariant under test:                          */
/*                                                                     */
/*    create -> returned id -> write -> resize -> output -> kill        */
/*    must all operate on the SAME session id,                          */
/*    and once that id is dead EVERY operation against it fails         */
/*    with an identical 404 — never a silent success, never a           */
/*    resurrected session.                                              */
/*                                                                     */
/*  These tests exercise the REAL module and REAL host PTYs, not        */
/*  copies (AGENTS.md §9).                                              */
/* ------------------------------------------------------------------ */

// files.ts reads TASK_WORK_DIR into a const at module load, so the isolated
// root must be in place BEFORE the terminal module graph is imported.
process.env.TASK_WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-term-lifecycle-'));

const {
  createSession,
  writeToSession,
  resizeSession,
  killSession,
  sessionsForTask,
  scrollbackOf,
  TerminalError,
} = await import('../lib/agent/terminal');

const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const MARKER = 'XEO_LIFECYCLE_OK';

/** Poll until predicate passes; PTY IO is async and unbuffered by contract. */
async function waitFor(pred: () => boolean, what: string, ms = 15000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

function expect404(run: () => void): void {
  try {
    run();
    throw new Error('expected TerminalError(404), but the call succeeded');
  } catch (err) {
    expect(err).toBeInstanceOf(TerminalError);
    expect((err as InstanceType<typeof TerminalError>).status).toBe(404);
  }
}

afterAll(() => {
  try {
    fs.rmSync(process.env.TASK_WORK_DIR!, { recursive: true, force: true });
  } catch (err) {
    // Windows can briefly hold cwd locks on freshly-killed PTYs; the tmpdir
    // is disposable either way — surface it rather than swallow silently.
    console.warn('[terminal-lifecycle] tmp cleanup deferred:', err);
  }
});

describe('terminal session-id lifecycle invariant', () => {
  it('create -> write -> output -> resize -> kill all operate on ONE id', async () => {
    const taskId = randomUUID();
    const session = await createSession({ taskId, ownerId: OWNER_A });
    const id = session.id;

    expect(sessionsForTask(taskId).map((s) => s.id)).toEqual([id]);

    // Write through THE returned id; the shell must execute and answer.
    writeToSession(id, OWNER_A, `echo ${MARKER}\r\n`);
    await waitFor(() => scrollbackOf(id, OWNER_A).includes(MARKER), 'shell echoed marker');

    // Resize through the SAME id.
    expect(() => resizeSession(id, OWNER_A, 100, 30)).not.toThrow();
    expect(sessionsForTask(taskId)[0]?.cols).toBe(100);

    // Kill through the SAME id.
    expect(killSession(id, OWNER_A)).toBe(true);
    await waitFor(() => sessionsForTask(taskId).length === 0, 'session removed after kill');

    // Post-death: every operation on the dead id refuses identically. This is
    // the server-side half of the observed 404 loop — correct behaviour is a
    // consistent 404, and it is the CLIENT's job to stop asking.
    expect404(() => writeToSession(id, OWNER_A, 'dir'));
    expect404(() => resizeSession(id, OWNER_A, 80, 24));
    expect404(() => scrollbackOf(id, OWNER_A));

    // Kill is idempotent at the API shape: second call reports nothing killed.
    expect(killSession(id, OWNER_A)).toBe(false);
  });

  it('natural shell exit removes the session; late input receives exactly 404', async () => {
    const taskId = randomUUID();
    const session = await createSession({ taskId, ownerId: OWNER_A });
    const id = session.id;

    writeToSession(id, OWNER_A, 'exit\r\n');
    await waitFor(() => sessionsForTask(taskId).length === 0, 'natural exit removed session');

    // The exact production signature: input fired at an exited session gets
    // one consistent 404 per attempt — detectable, never silent.
    expect404(() => writeToSession(id, OWNER_A, 'still here'));
  });

  it('ownership mismatch is indistinguishable from a missing session', async () => {
    const session = await createSession({ taskId: randomUUID(), ownerId: OWNER_A });

    let mismatchStatus = 0;
    let mismatchMsg = '';
    try {
      writeToSession(session.id, OWNER_B, 'x');
    } catch (err) {
      mismatchStatus = (err as InstanceType<typeof TerminalError>).status;
      mismatchMsg = (err as InstanceType<typeof TerminalError>).message;
    }

    let unknownStatus = 0;
    let unknownMsg = '';
    try {
      writeToSession(randomUUID(), OWNER_B, 'x');
    } catch (err) {
      unknownStatus = (err as InstanceType<typeof TerminalError>).status;
      unknownMsg = (err as InstanceType<typeof TerminalError>).message;
    }

    // A wrong-owner probe must learn NOTHING about the existence of ids.
    expect(mismatchStatus).toBe(unknownStatus);
    expect(mismatchMsg).toBe(unknownMsg);

    killSession(session.id, OWNER_A);
    await waitFor(
      () => sessionsForTask(session.taskId).length === 0,
      'ownership-test session removed',
    );
  });

  it('unknown ids refuse write and resize with 404 without touching state', () => {
    const ghost = randomUUID();
    expect404(() => writeToSession(ghost, OWNER_A, 'x'));
    expect404(() => resizeSession(ghost, OWNER_A, 80, 24));
  });
});
