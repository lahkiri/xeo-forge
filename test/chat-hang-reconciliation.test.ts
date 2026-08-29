/**
 * v1.22 regression: the chat surface could hang forever in "Thinking" with a
 * locked composer.
 *
 * Failure shape (user-reported, 2026-08-28): the chat UI stayed in a live
 * "thinking / working" state and the composer never re-enabled. Root cause:
 * the client treated the SSE stream as the only source of status truth. Any
 * missed `done` event — dead EventSource, provider crash without a terminal
 * event, Electron reload orphaning the stream, or a `cancelled` status the
 * client's terminal check did not even recognize — left status === 'running'
 * permanently. The DB row knew the run was over; the UI never asked.
 *
 * Fixed & pinned here (source-contract style, like test/cancellation.test.ts):
 *   H1 runtime-state — isTerminalTaskStatus covers the server's full terminal
 *      vocabulary (completed / failed / cancelled / planned).
 *   H2 ChatClient    — SSE guard uses that helper; a reconciliation poll
 *      re-reads the task row while streaming and the SERVER's status wins;
 *      a Stop escape hatch is rendered while a turn is live; stream loss is
 *      stated honestly instead of pretending to think.
 *   H3 WorkClient    — the same reconciliation poll heals the work surface.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isTerminalTaskStatus } from '../lib/agent/runtime-state';

const REPO_ROOT = path.resolve(__dirname, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('H1 runtime-state: terminal vocabulary matches the server', () => {
  it('treats completed, failed, cancelled and planned as terminal', () => {
    expect(isTerminalTaskStatus('completed')).toBe(true);
    expect(isTerminalTaskStatus('failed')).toBe(true);
    expect(isTerminalTaskStatus('cancelled')).toBe(true);
    expect(isTerminalTaskStatus('planned')).toBe(true);
  });

  it('keeps live and gate statuses non-terminal', () => {
    expect(isTerminalTaskStatus('running')).toBe(false);
    expect(isTerminalTaskStatus('pending')).toBe(false);
    expect(isTerminalTaskStatus('awaiting_decision')).toBe(false);
    expect(isTerminalTaskStatus('awaiting_approval')).toBe(false);
  });
});

describe('H2 ChatClient: the stream is an input, the task row is the truth', () => {
  const src = readSrc('app/chat/ChatClient.tsx');

  it('guards the SSE subscription with isTerminalTaskStatus (cancelled included)', () => {
    expect(src).toContain('isTerminalTaskStatus');
    expect(src).toMatch(/if \(!activeTask \|\| isTerminalTaskStatus\(status\)\) return;/);
    expect(src).not.toMatch(/status === 'completed' \|\| status === 'failed'\) return;/);
  });

  it('reconciles against GET /api/tasks/:id while streaming', () => {
    expect(src).toContain("fetch(`/api/tasks/${activeTask.id}`, { cache: 'no-store' })");
    expect(src).toMatch(/isTerminalTaskStatus\(serverStatus\)/);
    expect(src).toMatch(/setStatus\(serverStatus as TaskStatus\)/);
  });

  it('surfaces the persisted answer via router.refresh when nothing streamed', () => {
    expect(src).toMatch(/router\.refresh\(\)/);
  });

  it('keeps a Stop escape hatch rendered for the whole live turn', () => {
    expect(src).toMatch(/activeTask && isStreaming && \(/);
    expect(src).toContain("fetch(`/api/tasks/${activeTask.id}/cancel`, { method: 'POST' })");
  });

  it('tracks stream loss instead of silently pretending to think', () => {
    expect(src).toContain('source.onerror = () => setStreamLost(true);');
    expect(src).toContain('Live connection interrupted');
  });

  it('reads current-run text through the ref mirror in the done handler', () => {
    expect(src).toMatch(/splitRuns\(eventsRef\.current\)\.currentRunText/);
  });
});

describe('H3 WorkClient: the work surface heals the same way', () => {
  // v1.24 structural rework: the reconciliation poll lives in
  // app/work/useWorkRunState.ts (beside the SSE stream it heals); WorkClient
  // wires the hook. Pinned both sides — poll text in the hook, wiring in the
  // client.
  const src = readSrc('app/work/useWorkRunState.ts');
  const client = readSrc('app/work/WorkClient.tsx');

  it('the client mounts the run-state hook that owns the poll', () => {
    expect(client).toContain('useWorkRunState({');
  });

  it('reconciles against the task row while a run is live', () => {
    expect(src).toMatch(/isTerminalStatus\(serverStatus\)/);
    expect(src).toMatch(/setStatus\(serverStatus as Task\['status'\]\)/);
  });

  it('never reconciles inside the recorded demo', () => {
    expect(src).toMatch(/if \(demoMode \|\| !isRunning\) return;/);
  });

  it('rebuilds the run log from persisted events when nothing streamed', () => {
    expect(src).toMatch(/if \(!sawLiveOutput\) router\.refresh\(\);/);
  });
});
