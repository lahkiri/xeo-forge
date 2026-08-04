/**
 * Truth-based preview readiness tests.
 *
 * These exercise the REAL preview pipeline (startPreviewWithStrategy →
 * staticServer → detectReadiness → httpProbe) against real workspaces and
 * real loopback HTTP servers. No mocking of the readiness path — readiness
 * is only ever confirmed by an actual HTTP response.
 *
 * Covers the root-cause guarantees:
 *  - static project with a real index.html → READY (HTTP 2xx, non-empty body)
 *  - empty workspace (no index.html) → NOT READY (404 / empty)
 *  - wrong serveRoot (points at empty dir) → NOT READY
 *  - getPreviewPort returns a port ONLY for a verified-ready preview
 *  - getPreviewPort returns null after stop (connection would be refused)
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// WORK_ROOT (files.ts) and HARD_TIMEOUT_MS (preview.ts) are read at module
// import time. vitest.config.ts sets TASK_WORK_DIR + PREVIEW_HARD_TIMEOUT_MS
// via its `env` block so they are in place before any import is evaluated.
const TMP_ROOT = process.env.TASK_WORK_DIR || path.join(os.tmpdir(), 'xeo-tasks');
fs.mkdirSync(TMP_ROOT, { recursive: true });

import {
  startPreviewWithStrategy,
  stopPreview,
  getPreviewPort,
  getPreviewStatus,
} from '../lib/agent/preview';

function makeWorkspace(taskId: string): string {
  const dir = path.join(TMP_ROOT, taskId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Unique ids per run so repeated suites never collide on a stale workspace.
const RUN = Date.now().toString(36);
const tid = (name: string) => `preview-test-${RUN}-${name}`;

const started: string[] = [];
function track(id: string) { started.push(id); return id; }

afterEach(() => {
  for (const id of started.splice(0)) stopPreview(id);
});

describe('preview readiness — truth-based, no fake success', () => {
  it('static project with a real index.html becomes READY via HTTP 2xx', async () => {
    const id = track(tid('ok-static'));
    const ws = makeWorkspace(id);
    fs.writeFileSync(path.join(ws, 'index.html'), '<!doctype html><h1>hello preview</h1>');

    const res = await startPreviewWithStrategy(id, { runtime: 'static' }, {});

    expect(res.ok).toBe(true);
    expect(res.readiness?.ok).toBe(true);
    expect(res.readiness?.signal).toBe('http-2xx');
    expect(res.readiness?.method).toBe('http-probe');
    // A verified preview is proxyable, and the proxy port matches the live port.
    expect(typeof getPreviewPort(id)).toBe('number');
    expect(getPreviewPort(id)).toBe(getPreviewStatus(id)?.port);
  }, 60000);

  it('empty workspace (no index.html) is NOT READY — no fake build-complete success', async () => {
    const id = track(tid('empty-static'));
    makeWorkspace(id); // no index.html

    const res = await startPreviewWithStrategy(id, { runtime: 'static' }, {});

    expect(res.ok).toBe(false);
    expect(res.readiness?.ok).toBe(false);
    // Must NOT be a build-complete style fake success.
    expect(res.readiness?.signal).not.toBe('build-complete');
    expect(['no-progress', 'process-exited', 'crash-detected', 'none']).toContain(res.readiness?.signal);
    // Not proxyable.
    expect(getPreviewPort(id)).toBeNull();
  }, 60000);

  it('wrong serveRoot (empty subdir) is NOT READY', async () => {
    const id = track(tid('wrong-serveroot'));
    const ws = makeWorkspace(id);
    // index.html exists at root, but we point serveRoot at an empty subdir.
    fs.writeFileSync(path.join(ws, 'index.html'), '<h1>real</h1>');
    fs.mkdirSync(path.join(ws, 'empty-out'), { recursive: true });

    const res = await startPreviewWithStrategy(
      id, { runtime: 'static', serveRoot: 'empty-out' }, {},
    );

    expect(res.ok).toBe(false);
    expect(res.readiness?.ok).toBe(false);
    expect(getPreviewPort(id)).toBeNull();
  }, 60000);

  it('serveRoot escaping the workspace is rejected before any server starts', async () => {
    const id = track(tid('escape-serveroot'));
    makeWorkspace(id);

    const res = await startPreviewWithStrategy(
      id, { runtime: 'static', serveRoot: '../../etc' }, {},
    );

    expect(res.ok).toBe(false);
    expect(getPreviewPort(id)).toBeNull();
  }, 30000);

  it('getPreviewPort returns null after stop (port becomes unreachable)', async () => {
    const id = track(tid('stop-clears-port'));
    const ws = makeWorkspace(id);
    fs.writeFileSync(path.join(ws, 'index.html'), '<h1>bye</h1>');

    const res = await startPreviewWithStrategy(id, { runtime: 'static' }, {});
    expect(res.ok).toBe(true);
    expect(typeof getPreviewPort(id)).toBe('number');

    stopPreview(id);
    expect(getPreviewPort(id)).toBeNull();
    expect(getPreviewStatus(id)).toBeNull();
  }, 60000);
});
