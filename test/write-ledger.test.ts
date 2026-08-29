/**
 * WriteLedger contract tests — Commit A of the approved subagent
 * concurrent-write design (docs/subagent-write-concurrency-design.md §4.1,
 * §4.2, §4.4, §6.1), written RED-first before any ledger code exists.
 *
 * What Commit A pins here:
 *   - generation counters increment across repeated writes;
 *   - single-call leases refuse a second writer with `conflictWith`;
 *   - read-stamps gate staleness; stale writes are refused, never merged;
 *   - every applied mutation and every ledger refusal produces a complete
 *     `file_mutation` event (applied + refused-lease + refused-stale only —
 *     the owner's Q4 ruling: policy refusals stay on the governance path);
 *   - FileTool wired to a ledger emits those events at the write boundary;
 *   - a FileTool WITHOUT a ledger behaves byte-identically to today
 *     (the single-writer no-op invariant, design §4.1);
 *   - through the REAL executeTool chokepoint, parent writes are attributed
 *     `agent: "parent"` and increment generations (§6.1 test list);
 *   - end-to-end: a real run (mock provider, real DB) persists file_mutation
 *     events in the timeline.
 *
 * Zero capability change is asserted implicitly: nothing here grants a
 * subagent a write tool — refusals are exercised directly against the
 * ledger, exactly as design §6.1 prescribes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Server } from 'node:http';

process.env.XEO_DESKTOP_LOCAL = '1'; // credit debits bypassed — loop-local contract

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-write-ledger-'));
process.env.DB_PATH = path.join(tempDir, 'write-ledger.sqlite');

const {
  WriteLedger,
  WriteConflictError,
  refusalMessage,
} = await import('../lib/agent/write-ledger');
const { FileTool } = await import('../lib/agent/files');
const { createToolContext, executeTool } = await import('../lib/agent/tools');
const { effectiveRules } = await import('../lib/agent/permissions');
// Type-only import: erased at runtime, so the RED-first dynamic import above
// stays the sole loader of the implementation.
import type { FileMutationEvent } from '../lib/agent/write-ledger';

/** sha256 first-16-hex — the ledger's replay anchor format, mirrored here. */
function sha16(text: string): string {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex').slice(0, 16);
}

/** A perform() that records the digests FileTool would compute. */
function digests(before: string | null, after: string) {
  return {
    bytesBefore: before === null ? 0 : Buffer.byteLength(before, 'utf8'),
    bytesAfter: Buffer.byteLength(after, 'utf8'),
    shaBefore: before === null ? null : sha16(before),
    shaAfter: sha16(after),
  };
}

/* ────────────────────────────────────────────────────────────────── */
/* 1. Pure ledger semantics (design §4.1, §4.2 — refusal paths are    */
/*    unit-exercised directly against the ledger, per §6.1)           */
/* ────────────────────────────────────────────────────────────────── */

describe('WriteLedger (pure)', () => {
  it('applied writes increment generations and carry complete event fields', async () => {
    const ledger = new WriteLedger();
    const e1 = await ledger.run('parent', 'src/a.ts', 'write', async () => digests(null, 'one'));
    expect(e1.outcome).toBe('applied');
    expect(e1.agent).toBe('parent');
    expect(e1.op).toBe('write');
    expect(e1.path).toBe('src/a.ts');
    expect(e1.generationBefore).toBe(0);
    expect(e1.generationAfter).toBe(1);
    expect(e1.bytesBefore).toBe(0);
    expect(e1.bytesAfter).toBe(3);
    expect(e1.shaBefore).toBeNull();
    expect(e1.shaAfter).toBe(sha16('one'));

    const e2 = await ledger.run('parent', 'src/a.ts', 'write', async () => digests('one', 'two!'));
    expect(e2.generationBefore).toBe(1);
    expect(e2.generationAfter).toBe(2);
    expect(e2.shaBefore).toBe(sha16('one'));
    expect(ledger.generation('src/a.ts')).toBe(2);
  });

  it('a successful write stamps the writer — its own next write is not stale', async () => {
    const ledger = new WriteLedger();
    await ledger.run('parent', 'a.ts', 'write', async () => digests(null, 'v1'));
    const e2 = await ledger.run('parent', 'a.ts', 'edit', async () => digests('v1', 'v2'));
    // The single-writer no-op invariant (§4.1): the parent's own follow-up
    // write must NEVER be refused by its own previous write.
    expect(e2.outcome).toBe('applied');
    expect(e2.op).toBe('edit');
    expect(e2.generationAfter).toBe(2);
  });

  it('refuses with refused-lease while another agent holds the one-call lease', async () => {
    const ledger = new WriteLedger();
    let releaseSlow!: () => void;
    const slow = new Promise<void>((r) => (releaseSlow = r));
    const pending = ledger.run('sub-1', 'a.ts', 'write', async () => {
      await slow;
      return digests(null, 'slow write');
    });

    const refused = await ledger.run('sub-2', 'a.ts', 'write', async () => digests(null, 'racer'));
    expect(refused.outcome).toBe('refused-lease');
    expect(refused.conflictWith).toBe('sub-1');
    expect(refused.generationBefore).toBe(0);
    expect(refused.generationAfter).toBe(0);
    expect(refusalMessage(refused)).toBe(
      'Write conflict on "a.ts": held by sub-1 right now. Re-read after it finishes.',
    );

    releaseSlow();
    const applied = await pending;
    expect(applied.outcome).toBe('applied');
    expect(ledger.generation('a.ts')).toBe(1);
  });

  it('refuses with refused-stale when the caller read an older generation', async () => {
    const ledger = new WriteLedger();
    await ledger.run('sub-1', 'a.ts', 'write', async () => digests(null, 'gen 1 by sub-1'));
    ledger.stampRead('sub-2', 'a.ts'); // sub-2 reads at gen 1
    await ledger.run('sub-1', 'a.ts', 'write', async () => digests('gen 1 by sub-1', 'gen 2 by sub-1'));

    const refused = await ledger.run('sub-2', 'a.ts', 'edit', async () => digests('whatever', 'x'));
    expect(refused.outcome).toBe('refused-stale');
    expect(refused.conflictWith).toBe('sub-1');
    expect(refused.readStampAt).toBe(1);
    expect(refused.generationBefore).toBe(2);
    expect(refused.generationAfter).toBe(2);
    expect(refusalMessage(refused)).toBe(
      'Write conflict on "a.ts": the file changed (gen 1 → 2, last writer sub-1) after your read. Re-read and re-apply.',
    );
  });

  it('a stale agent recovers by re-reading — then its write applies', async () => {
    const ledger = new WriteLedger();
    await ledger.run('sub-1', 'a.ts', 'write', async () => digests(null, 'v1'));
    ledger.stampRead('sub-2', 'a.ts');
    await ledger.run('sub-1', 'a.ts', 'write', async () => digests('v1', 'v2'));

    const stale = await ledger.run('sub-2', 'a.ts', 'write', async () => digests('v1', 'x'));
    expect(stale.outcome).toBe('refused-stale');

    ledger.stampRead('sub-2', 'a.ts'); // the re-read the refusal demands
    const fresh = await ledger.run('sub-2', 'a.ts', 'write', async () => digests('v2', 'v3'));
    expect(fresh.outcome).toBe('applied');
    expect(fresh.conflictWith).toBeUndefined();
    expect(ledger.generation('a.ts')).toBe(3);
  });

  it('lease check precedes staleness check (design §4.2 order)', async () => {
    const ledger = new WriteLedger();
    await ledger.run('sub-1', 'a.ts', 'write', async () => digests(null, 'v1'));
    ledger.stampRead('sub-2', 'a.ts'); // sub-2 is ALSO stale (gen moved to 1, then 2 below)
    await ledger.run('sub-1', 'a.ts', 'write', async () => digests('v1', 'v2'));

    let releaseSlow!: () => void;
    const slow = new Promise<void>((r) => (releaseSlow = r));
    const pending = ledger.run('sub-1', 'a.ts', 'write', async () => {
      await slow;
      return digests('v2', 'v3');
    });

    // sub-2 is both stale AND racing a held lease — the LEASE refusal wins.
    const refused = await ledger.run('sub-2', 'a.ts', 'write', async () => digests('v1', 'race'));
    expect(refused.outcome).toBe('refused-lease');

    releaseSlow();
    await pending;
  });

  it('a held lease refuses even the same agent — no self special case, no deadlock', async () => {
    const ledger = new WriteLedger();
    let releaseSlow!: () => void;
    const slow = new Promise<void>((r) => (releaseSlow = r));
    const pending = ledger.run('parent', 'a.ts', 'write', async () => {
      await slow;
      return digests(null, 'first');
    });

    const refused = await ledger.run('parent', 'a.ts', 'write', async () => digests(null, 'overlap'));
    expect(refused.outcome).toBe('refused-lease');
    expect(refused.conflictWith).toBe('parent');

    releaseSlow();
    expect((await pending).outcome).toBe('applied');
  });

  it('refused mutations leave the generation and hashes untouched', async () => {
    const ledger = new WriteLedger();
    await ledger.run('parent', 'a.ts', 'write', async () => digests(null, 'only real write'));
    ledger.stampRead('sub-1', 'a.ts');
    ledger.stampRead('sub-2', 'a.ts');
    const genBefore = ledger.generation('a.ts');

    let releaseSlow!: () => void;
    const slow = new Promise<void>((r) => (releaseSlow = r));
    const pending = ledger.run('sub-1', 'a.ts', 'write', async () => {
      await slow;
      return digests('only real write', 'applied under the lease');
    });
    const refused = await ledger.run('sub-2', 'a.ts', 'write', async () => digests('x', 'y'));
    expect(refused.outcome).toBe('refused-lease');
    releaseSlow();
    const applied = await pending;
    expect(applied.outcome).toBe('applied');

    // Exactly ONE bump landed (sub-1's applied write); the refusal itself
    // changed nothing.
    expect(ledger.generation('a.ts')).toBe(genBefore + 1);
  });

  it('a perform() crash releases the lease, emits nothing, bumps nothing', async () => {
    const ledger = new WriteLedger();
    const events: unknown[] = [];
    await expect(
      ledger.run('parent', 'a.ts', 'edit', async () => {
        throw new Error('edit: oldString not found in a.ts');
      }),
    ).rejects.toThrow('oldString not found');
    expect(ledger.generation('a.ts')).toBe(0);
    expect(ledger.leaseHolder('a.ts')).toBeUndefined();
    expect(events).toHaveLength(0);

    // The path is free again immediately.
    const next = await ledger.run('parent', 'a.ts', 'write', async () => digests(null, 'recovered'));
    expect(next.outcome).toBe('applied');
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* 2. FileTool integration — the write boundary emits, the legacy      */
/*    path stays a byte-identical no-op (design §4.1, §4.4)            */
/* ────────────────────────────────────────────────────────────────── */

describe('FileTool + WriteLedger', () => {
  it('a FileTool WITHOUT a ledger behaves exactly as today and emits nothing', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-ledger-legacy-'));
    try {
      const files = new FileTool('legacy-task', ws);
      let emitted = 0;
      (files as { onMutation?: unknown }).onMutation = async () => void ++emitted;

      await files.write('note.txt', 'legacy path');
      expect(await files.read('note.txt')).toBe('legacy path');
      await files.edit('note.txt', 'legacy', 'changed');
      expect(await files.read('note.txt')).toBe('changed path'.replace('path', 'path'));
      expect(emitted).toBe(0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('every parent write emits file_mutation with agent "parent" from the boundary', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-ledger-files-'));
    try {
      const ledger = new WriteLedger();
      const files = new FileTool('boundary-task', ws, ledger);
      const events: FileMutationEvent[] = [];
      files.onMutation = async (e) => void events.push(e);

      await files.write('src/demo.txt', 'hello ledger');
      await files.write('src/demo.txt', 'hello ledger, second pass');

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        agent: 'parent',
        op: 'write',
        path: 'src/demo.txt',
        outcome: 'applied',
        generationBefore: 0,
        generationAfter: 1,
      });
      expect(events[1]).toMatchObject({
        agent: 'parent',
        op: 'write',
        outcome: 'applied',
        generationBefore: 1,
        generationAfter: 2,
      });
      expect(events[1].shaBefore).toBe(events[0].shaAfter);
      expect(await fs.promises.readFile(path.join(ws, 'src/demo.txt'), 'utf8')).toBe(
        'hello ledger, second pass',
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('file_read stamps the reader; a foreign write makes the next edit refused-stale', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-ledger-stale-'));
    try {
      const ledger = new WriteLedger();
      const parent = new FileTool('stale-task', ws, ledger);
      const events: FileMutationEvent[] = [];
      parent.onMutation = async (e) => void events.push(e);

      await parent.write('doc.md', 'original text');
      const seen = await parent.read('doc.md');
      expect(seen).toBe('original text');

      // A second tool instance over the SAME task ledger plays the foreign
      // writer — attributed as its own agent (the way Commit B will pass
      // sub-N through executeTool). It must READ before writing: the design
      // refuses an agent that never saw the file, and this line documents
      // that contract in action.
      const foreign = new FileTool('stale-task', ws, ledger);
      await foreign.read('doc.md', 'sub-1');
      await foreign.write('doc.md', 'replaced by the other writer', 'sub-1');

      let thrown: unknown;
      try {
        await parent.edit('doc.md', 'original text', 'parent edit');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(WriteConflictError);
      expect((thrown as Error).message).toBe(
        'Write conflict on "doc.md": the file changed (gen 1 → 2, last writer sub-1) after your read. Re-read and re-apply.',
      );
      // The refusal is a first-class event (§4.4), emitted like any other.
      const refusal = events[events.length - 1];
      expect(refusal).toMatchObject({
        agent: 'parent',
        op: 'edit',
        path: 'doc.md',
        outcome: 'refused-stale',
        conflictWith: 'sub-1',
      });
      // And the disk still holds the foreign writer's content — no merge.
      expect(await fs.promises.readFile(path.join(ws, 'doc.md'), 'utf8')).toBe(
        'replaced by the other writer',
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('an anchor failure stays an ordinary error: no event, no generation bump', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-ledger-anchor-'));
    try {
      const ledger = new WriteLedger();
      const files = new FileTool('anchor-task', ws, ledger);
      const events: FileMutationEvent[] = [];
      files.onMutation = async (e) => void events.push(e);

      await files.write('code.ts', 'export const a = 1;\n');
      await expect(files.edit('code.ts', 'NOT PRESENT', 'x')).rejects.toThrow('not found');
      expect(events).toHaveLength(1); // only the applied write above
      expect(ledger.generation('code.ts')).toBe(1);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* 3. The real chokepoint + a real run (§6.1: parent writes emit       */
/*    file_mutation; repeated writes increment generations; the        */
/*    timeline persists the events)                                    */
/* ────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────── */
/* Timeline labels — the Activity view renders file_mutation rows       */
/* (design §6.1 live proof: the events must be VISIBLE, not just        */
/* persisted). describeEvent is the single label authority.             */
/* ────────────────────────────────────────────────────────────────── */

describe('file_mutation timeline labels', () => {
  it('applied writes render as File written with generation trail and attribution', async () => {
    const { describeEvent } = await import('../lib/agent/events');
    const label = describeEvent('file_mutation', {
      agent: 'parent',
      op: 'write',
      path: 'ledger-demo.txt',
      generationBefore: 0,
      generationAfter: 1,
      bytesBefore: 0,
      bytesAfter: 12,
      shaBefore: null,
      shaAfter: 'dbcdb1f658e3f222',
      outcome: 'applied',
    });
    expect(label).toEqual({
      title: 'File written · gen 0 → 1',
      detail: 'ledger-demo.txt · by parent',
      tone: 'good',
    });
  });

  it('ledger refusals render as refused rows with who blocked whom', async () => {
    const { describeEvent } = await import('../lib/agent/events');
    const lease = describeEvent('file_mutation', {
      agent: 'sub-2', op: 'write', path: 'src/a.ts', generationBefore: 3, generationAfter: 3,
      bytesBefore: 0, bytesAfter: 0, shaBefore: null, shaAfter: null,
      outcome: 'refused-lease', conflictWith: 'sub-1',
    });
    expect(lease).toMatchObject({ title: 'File written — refused', tone: 'warn' });
    expect(String(lease?.detail)).toContain('held by sub-1');

    const stale = describeEvent('file_mutation', {
      agent: 'sub-2', op: 'edit', path: 'src/a.ts', generationBefore: 5, generationAfter: 5,
      bytesBefore: 0, bytesAfter: 0, shaBefore: null, shaAfter: null,
      outcome: 'refused-stale', conflictWith: 'sub-1', readStampAt: 3,
    });
    expect(stale).toMatchObject({ title: 'File edited — refused', tone: 'warn' });
    expect(String(stale?.detail)).toContain('gen 3 → 5, last writer sub-1');
  });
});

describe('executeTool chokepoint + end-to-end run', () => {
  it('file_write through executeTool emits file_mutation with agent "parent" and increments generations', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-ledger-chokepoint-'));
    try {
      const ctx = createToolContext('chokepoint-task', 'ledger-user', 'build', ws, effectiveRules('execute'));
      const events: FileMutationEvent[] = [];
      ctx.files.onMutation = async (e) => void events.push(e);

      const out1 = await executeTool('file_write', { path: 'demo.txt', content: 'A' }, ctx);
      expect(out1).toBe('Wrote demo.txt');
      const out2 = await executeTool('file_write', { path: 'demo.txt', content: 'AA' }, ctx);
      expect(out2).toBe('Wrote demo.txt');

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ agent: 'parent', op: 'write', path: 'demo.txt', outcome: 'applied', generationBefore: 0, generationAfter: 1 });
      expect(events[1]).toMatchObject({ agent: 'parent', op: 'write', outcome: 'applied', generationBefore: 1, generationAfter: 2 });
      expect(events[0].shaAfter).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

/* ── End-to-end: real loop, real DB, mock provider (the repo's own
 * definition of a live run — the same harness family as
 * test/run-agent-behavior.test.ts). The scripted build writes one file
 * TWICE and reads it back; the persisted timeline must contain the
 * file_mutation events with parent attribution and rising generations. */

let db: typeof import('../lib/db/index').db;
let initSchema: typeof import('../lib/db/schema').initSchema;
let queries: typeof import('../lib/db/queries');
let runAgent: typeof import('../lib/agent/loop').runAgent;
let server: Server;

type Chunk = { delta: Record<string, unknown>; finish_reason: string | null };

function sseChunk(c: Chunk): string {
  return (
    'data: ' +
    JSON.stringify({
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'mock-ledger-model',
      choices: [{ index: 0, delta: c.delta, finish_reason: c.finish_reason }],
    }) +
    '\n\n'
  );
}

function writeSse(res: http.ServerResponse, chunks: Chunk[]): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'close',
  });
  for (const c of chunks) res.write(sseChunk(c));
  res.write('data: [DONE]\n\n');
  res.end();
}

function toolCallChunks(name: string, args: unknown, index: number): Chunk[] {
  return [
    {
      delta: {
        tool_calls: [
          {
            index: 0,
            id: `call_mock_${index}`,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      },
      finish_reason: null,
    },
    { delta: {}, finish_reason: 'tool_calls' },
  ];
}

describe('end-to-end: file_mutation events persist in the real timeline', () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
        const bodyChunks: Buffer[] = [];
        req.on('data', (c: Buffer) => bodyChunks.push(c));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(bodyChunks).toString('utf8') || '{}');
          const toolMsgs = (body.messages || []).filter((m: { role: string }) => m.role === 'tool').length;
          const scripted: Array<{ name: string; args: Record<string, unknown> }> = [
            { name: 'file_write', args: { path: 'ledger-demo.txt', content: 'version one\n' } },
            { name: 'file_write', args: { path: 'ledger-demo.txt', content: 'version two with more text\n' } },
            { name: 'file_read', args: { path: 'ledger-demo.txt' } },
          ];
          if (toolMsgs < scripted.length) {
            const call = scripted[toolMsgs];
            writeSse(res, toolCallChunks(call.name, call.args, toolMsgs + 1));
          } else {
            writeSse(
              res,
              toolCallChunks(
                'task_complete',
                {
                  summary: [
                    'Assumptions:',
                    '- none',
                    '',
                    'Decisions:',
                    '- wrote the demo file twice through the ledger',
                    '',
                    'Issues:',
                    '- none found',
                    '',
                    'Workarounds:',
                    '- none needed',
                  ].join('\n'),
                },
                scripted.length + 1,
              ),
            );
          }
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'mock provider: not found' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const schema = await import('../lib/db/schema');
    const q = await import('../lib/db/queries');
    const database = await import('../lib/db/index');
    const loop = await import('../lib/agent/loop');
    initSchema = schema.initSchema;
    queries = q;
    db = database.db;
    runAgent = loop.runAgent;
    await initSchema();
    const addr = server.address() as { port: number };
    await queries.upsertModelSettings({
      name: 'Mock Ledger Model',
      baseUrl: `http://127.0.0.1:${addr.port}/v1`,
      apiKey: 'test-key-not-real',
      modelId: 'mock-ledger-model',
      temperature: 0.2,
      maxTokens: 2048,
      contextWindow: 128000,
      autoCompactThreshold: 80,
    });
  });

  afterAll(async () => {
    await db.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('two parent writes land as two applied file_mutation events in the persisted timeline', async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-ledger-e2e-'));
    try {
      const email = `ledger-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
      const user = await queries.createUser({ email, passwordHash: 'test-hash', displayName: 'Ledger E2E' });
      const goal = 'Write the ledger demo file twice, then read it back.';
      const task = await queries.createTask({ userId: user.id, goal, mode: 'planning' });
      await queries.updateTaskStatus(task.id, 'planned', { plan: '1. Write twice.\n2. Read back.\n3. Complete.' });
      const approved = await queries.approveTaskPlan(task.id);
      if (!approved) throw new Error('harness: approveTaskPlan did not transition');
      // The runner contract mirrors the routes: the approved plan arrives
      // from the task ROW, not from caller-invented state (B4 pattern).
      const approvedRow = await queries.getTaskById(task.id);

      await runAgent({
        taskId: task.id,
        userId: user.id,
        goal,
        mode: 'build',
        approvedPlan: approvedRow?.approved_plan ?? null,
        projectPath: projectDir,
      });

      const row = await queries.getTaskById(task.id);
      const events = await queries.getTaskEvents(task.id);
      const errorEvent = events.find((e) => e.type === 'error');
      expect(row?.status, `run failed: ${errorEvent?.content ?? 'no error event persisted'}`).toBe(
        'completed',
      );
      const mutations = events
        .filter((e) => e.type === 'file_mutation')
        .map((e) => JSON.parse(e.content) as Record<string, unknown>);

      expect(mutations).toHaveLength(2);
      expect(mutations[0]).toMatchObject({
        agent: 'parent',
        op: 'write',
        path: 'ledger-demo.txt',
        outcome: 'applied',
        generationBefore: 0,
        generationAfter: 1,
      });
      expect(mutations[1]).toMatchObject({
        agent: 'parent',
        op: 'write',
        path: 'ledger-demo.txt',
        outcome: 'applied',
        generationBefore: 1,
        generationAfter: 2,
      });
      // Replay anchors: the second write's before-state is the first's after-state.
      expect(mutations[1].shaBefore).toBe(mutations[0].shaAfter);
      expect(mutations[0].shaAfter).toMatch(/^[0-9a-f]{16}$/);
      expect(mutations[1].bytesAfter).toBe(Buffer.byteLength('version two with more text\n', 'utf8'));

      // And the workspace holds the final generation's content.
      expect(await fs.promises.readFile(path.join(projectDir, 'ledger-demo.txt'), 'utf8')).toBe(
        'version two with more text\n',
      );
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  }, 30_000);
});
