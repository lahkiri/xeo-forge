/**
 * Run-agent behavior suite — pins END-TO-END loop behavior against a mock
 * OpenAI-compatible provider, through the REAL database, REAL queries and
 * REAL event emitter.
 *
 * WHY THIS EXISTS: lib/agent/loop.ts is being decomposed (v1.24 structural
 * rework). Source-contract tests pin WHERE code lives; these tests pin WHAT
 * the code DOES. They must survive the decomposition with ZERO edits — if
 * one of these goes red during a move, the move changed behavior.
 *
 * Mock provider contract (behavior keys embedded in the task goal):
 *   CHATBEHAVIOR:<answer>            stream content then stop (chat path)
 *   THINKBEHAVIOR:<reasoning>||<ans> stream reasoning_content then content
 *   THINKTAGBEHAVIOR:<answer>        stream inline <think>…</think> in content
 *   TOOLBEHAVIOR:<tool>:<args>@@<summary>
 *                                    first turn: tool_call; after a tool
 *                                    observation: task_complete(summary)
 *   FAILBEHAVIOR:<status>            HTTP <status> error (401 → no retry)
 *   REJECTTOOLSBEHAVIOR:<actionJson> with tools param → 400 "does not
 *                                    support tools"; without → stream the
 *                                    <action> block (fallback path)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

process.env.XEO_DESKTOP_LOCAL = '1'; // credit debits bypassed — loop-local contract

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-run-behavior-'));
process.env.DB_PATH = path.join(tempDir, 'behavior.sqlite');

const SUMMARY_OK = [
  'Assumptions:',
  '- none',
  '',
  'Decisions:',
  '- kept the implementation minimal',
  '',
  'Issues:',
  '- none found',
  '',
  'Workarounds:',
  '- none needed',
].join('\n');

let db: typeof import('../lib/db/index').db;
let initSchema: typeof import('../lib/db/schema').initSchema;
let queries: typeof import('../lib/db/queries');
let runAgent: typeof import('../lib/agent/loop').runAgent;
let server: Server;
let baseUrl = '';
/* ------------------------------------------------------------------ */
/* Mock OpenAI-compatible streaming provider                          */
/* ------------------------------------------------------------------ */

type Chunk = { delta: Record<string, unknown>; finish_reason: string | null };

function sseChunk(c: Chunk): string {
  return (
    'data: ' +
    JSON.stringify({
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'mock-behavior-model',
      choices: [{ index: 0, delta: c.delta, finish_reason: c.finish_reason }],
    }) +
    '\n\n'
  );
}

function writeSse(res: http.ServerResponse, chunks: Chunk[]): void {
  // Connection: close — every request gets a fresh socket. Keep-alive reuse
  // between tests races the server's idle timeout and surfaces as flaky
  // ECONNRESET inside the OpenAI SDK's pooled fetch.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'close',
  });
  for (const c of chunks) res.write(sseChunk(c));
  res.write('data: [DONE]\n\n');
  res.end();
}

function contentChunks(text: string): Chunk[] {
  return [
    { delta: { content: text }, finish_reason: null },
    { delta: {}, finish_reason: 'stop' },
  ];
}

/** Extract `key:<rest>` from the first message containing any behavior key. */
function findBehavior(messages: { role: string; content: unknown }[]): { key: string; rest: string } | null {
  const keys = [
    'CHATBEHAVIOR:',
    'THINKBEHAVIOR:',
    'THINKTAGBEHAVIOR:',
    'TOOLBEHAVIOR:',
    'FAILBEHAVIOR:',
    'REJECTTOOLSBEHAVIOR:',
  ];
  for (const m of messages) {
    let text = typeof m.content === 'string' ? m.content : '';
    // The loop frames the persisted goal as UNTRUSTED DATA:
    // <user_task>\n<goal>\n</user_task>. The behavior script is the goal
    // itself, so cut at the framing close-tag — the summary in TOOLBEHAVIOR
    // is multi-line and must survive intact.
    const closeIdx = text.indexOf('</user_task>');
    if (closeIdx !== -1) text = text.slice(0, closeIdx);
    for (const key of keys) {
      const idx = text.indexOf(key);
      if (idx !== -1) {
        return { key, rest: text.slice(idx + key.length).trim() };
      }
    }
  }
  return null;
}

function handleCompletion(body: any, res: http.ServerResponse): void {
  const behavior = findBehavior(body.messages || []);
  if (!behavior) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock provider: no behavior key in conversation' } }));
    return;
  }

  const toolMsgs = (body.messages || []).filter((m: any) => m.role === 'tool').length;

  if (behavior.key === 'CHATBEHAVIOR:') {
    writeSse(res, contentChunks(behavior.rest));
    return;
  }

  if (behavior.key === 'THINKBEHAVIOR:') {
    const [reasoning, answer] = behavior.rest.split('||');
    writeSse(res, [
      { delta: { reasoning_content: reasoning }, finish_reason: null },
      { delta: { reasoning_content: reasoning }, finish_reason: null },
      ...contentChunks(answer ?? ''),
    ]);
    return;
  }

  if (behavior.key === 'THINKTAGBEHAVIOR:') {
    writeSse(res, contentChunks(`<think>secret chain of thought</think>${behavior.rest}`));
    return;
  }

  if (behavior.key === 'TOOLBEHAVIOR:') {
    // Format: <tool>:<argsJson>@@<summary>. Multi-turn: the number of tool
    // observations already present selects the next scripted tool call —
    // todo_update (bookkeeping only) → file_list (real evidence) →
    // task_complete (final summary).
    const spec = behavior.rest;
    const atIdx = spec.indexOf('@@');
    const summary = spec.slice(atIdx + 2);
    let call: { name: string; args: unknown };
    if (toolMsgs === 0) {
      const colonIdx = spec.indexOf(':');
      call = { name: spec.slice(0, colonIdx), args: JSON.parse(spec.slice(colonIdx + 1, atIdx)) };
    } else if (toolMsgs === 1) {
      call = { name: 'file_list', args: { path: '.' } };
    } else {
      call = { name: 'task_complete', args: { summary } };
    }
    writeSse(res, [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: `call_mock_${toolMsgs + 1}`,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            },
          ],
        },
        finish_reason: null,
      },
      { delta: {}, finish_reason: 'tool_calls' },
    ]);
    return;
  }

  if (behavior.key === 'FAILBEHAVIOR:') {
    const status = parseInt(behavior.rest, 10) || 500;
    const message =
      status === 401 ? 'Incorrect API key provided for the model provider.' : 'Mock provider failure.';
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message, type: 'invalid_request_error', code: status } }));
    return;
  }

  if (behavior.key === 'REJECTTOOLSBEHAVIOR:') {
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'This model does not support tools. Use plain text.', type: 'invalid_request_error' },
        }),
      );
      return;
    }
    writeSse(res, contentChunks(`<action>${behavior.rest}</action>`));
    return;
  }

  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'mock provider: unhandled behavior' } }));
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
      const bodyChunks: Buffer[] = [];
      req.on('data', (c: Buffer) => bodyChunks.push(c));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(bodyChunks).toString('utf8') || '{}');
          handleCompletion(body, res);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `mock parse failure: ${String(err)}` } }));
        }
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock provider: not found' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}/v1`;

  const schema = await import('../lib/db/schema');
  const q = await import('../lib/db/queries');
  const database = await import('../lib/db/index');
  const loop = await import('../lib/agent/loop');
  initSchema = schema.initSchema;
  queries = q;
  db = database.db;
  runAgent = loop.runAgent;
  await initSchema();
  await queries.upsertModelSettings({
    name: 'Mock Behavior Model',
    baseUrl,
    apiKey: 'test-key-not-real',
    modelId: 'mock-behavior-model',
    temperature: 0.2,
    maxTokens: 2048,
    contextWindow: 128000,
    autoCompactThreshold: 80,
  });
});

afterAll(async () => {
  await db.close();
  await new Promise<void>((resolve, reject) =>
    server.close(() => resolve()),
  );
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/* Helpers */

async function makeTask(goal: string, mode: 'chat' | 'build', approvedPlan?: string) {
  const email = `behavior-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const user = await queries.createUser({
    email,
    passwordHash: 'test-hash',
    displayName: 'Behavior Tester',
  });
  if (mode === 'chat') {
    const task = await queries.createTask({ userId: user.id, goal, mode });
    return { userId: user.id, taskId: task.id };
  }
  // Build tasks follow the REAL authorization path: a planning run proposes
  // the plan, the plan is approved (approveTaskPlan snapshots it into the
  // immutable approved_plan), THEN the build runner may start. There is no
  // side door that stores approved_plan directly — by design.
  const task = await queries.createTask({ userId: user.id, goal, mode: 'planning' });
  await queries.updateTaskStatus(task.id, 'planned', { plan: approvedPlan ?? 'Plan:' });
  const approved = await queries.approveTaskPlan(task.id);
  if (!approved) throw new Error('harness: approveTaskPlan did not transition');
  return { userId: user.id, taskId: task.id };
}

function eventsOf(taskId: string) {
  return queries.getTaskEvents(taskId);
}

/** TaskEvent.content is stored JSON-encoded; decode it once here. */
function payload(e: { type: string; content: string } | undefined): any {
  if (!e) return undefined;
  try {
    return JSON.parse(e.content);
  } catch {
    return e.content;
  }
}

function eventsByType(events: Awaited<ReturnType<typeof queries.getTaskEvents>>, type: string) {
  return events.filter((e) => e.type === type);
}

async function statusOf(taskId: string) {
  const task = await queries.getTaskById(taskId);
  return task?.status;
}

/* ------------------------------------------------------------------ */
/* The six behavior pins                                               */
/* ------------------------------------------------------------------ */

describe('runAgent end-to-end behavior (mock provider, real DB)', () => {
  it('B1 chat: finalizes on first text — the answer is the deliverable, no nudge loop', async () => {
    const answer = 'Hello! This is the complete chat answer.';
    const { taskId } = await makeTask(`CHATBEHAVIOR:${answer}`, 'chat');
    await runAgent({ taskId, userId: 'ignored-by-harness', goal: `CHATBEHAVIOR:${answer}`, mode: 'chat' });

    expect(await statusOf(taskId)).toBe('completed');

    const events = await eventsOf(taskId);
    const textDelta = eventsByType(events, 'text')
      .map((e) => payload(e)?.delta ?? '')
      .join('');
    expect(textDelta).toBe(answer);
    const done = events.find((e) => e.type === 'done');
    expect(payload(done)?.status).toBe('completed');

    const messages = await queries.getMessages(taskId);
    const assistant = messages.filter((m) => m.role === 'assistant' && m.active === 1);
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toBe(answer);

    // No build-mode verification nagging in chat: the v1.23 infinite-reply
    // regression pinned shut.
    const verifications = eventsByType(events, 'verification');
    expect(verifications).toHaveLength(0);
  }, 30_000);

  it('B2 native reasoning_content streams as reasoning events and the answer stays clean', async () => {
    const reasoning = 'Weighing options before answering.';
    const answer = 'The final visible answer.';
    const goal = `THINKBEHAVIOR:${reasoning}||${answer}`;
    const { taskId } = await makeTask(goal, 'chat');
    await runAgent({ taskId, userId: 'x', goal, mode: 'chat' });

    expect(await statusOf(taskId)).toBe('completed');

    const events = await eventsOf(taskId);
    const reasoningDelta = eventsByType(events, 'reasoning')
      .filter((e) => payload(e)?.source === undefined)
      .map((e) => payload(e)?.delta ?? '')
      .join('');
    // Two reasoning chunks were streamed; both must reach the event stream.
    expect(reasoningDelta).toContain(reasoning);
    expect(reasoningDelta).toContain(reasoning);

    const textDelta = eventsByType(events, 'text')
      .map((e) => payload(e)?.delta ?? '')
      .join('');
    expect(textDelta).toBe(answer);

    const messages = await queries.getMessages(taskId);
    const assistant = messages.filter((m) => m.role === 'assistant' && m.active === 1);
    expect(assistant[0].content).toBe(answer);
  }, 30_000);

  it('B3 inline <think> tags are extracted server-side: reasoning event + clean answer', async () => {
    const answer = 'Visible answer text only.';
    const goal = `THINKTAGBEHAVIOR:${answer}`;
    const { taskId } = await makeTask(goal, 'chat');
    await runAgent({ taskId, userId: 'x', goal, mode: 'chat' });

    expect(await statusOf(taskId)).toBe('completed');

    const events = await eventsOf(taskId);
    const thinkEvents = eventsByType(events, 'reasoning').filter(
      (e) => payload(e)?.source === 'inline_think_tag',
    );
    expect(thinkEvents.length).toBeGreaterThanOrEqual(1);
    expect(payload(thinkEvents[0]).delta).toBe('secret chain of thought');

    const textDelta = eventsByType(events, 'text')
      .map((e) => payload(e)?.delta ?? '')
      .join('');
    // CURRENT BEHAVIOR (two-channel design): text deltas are emitted LIVE as
    // they arrive — including the raw <think> payload — and the server-side
    // extraction then (a) re-emits the thinking as a reasoning event and
    // (b) strips the tags from what gets PERSISTED. The client mirrors the
    // same stripping for the live view (timeline.separateThinkTags).
    expect(textDelta).toContain(answer);

    const messages = await queries.getMessages(taskId);
    const assistant = messages.filter((m) => m.role === 'assistant' && m.active === 1);
    expect(assistant[0].content).toBe(answer);
    expect(assistant[0].content).not.toContain('<think>');
  }, 30_000);

  it('B4 build: tool calls run, evidence records, verification passes, task completes', async () => {
    // NOTE — records CURRENT behavior, deliberately: todo_update alone is
    // bookkeeping and does NOT satisfy the evidence gate ("no tool calls
    // recorded"). The scenario therefore performs a real read (file_list)
    // before completing, which is exactly what the gate demands of a real run.
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-b4-project-'));
    fs.writeFileSync(path.join(projectDir, 'README.md'), '# scratch project\n');
    try {
      const todos = [{ id: '1', description: 'Record the todo', status: 'done' }];
      const goal = `TOOLBEHAVIOR:todo_update:${JSON.stringify({ items: todos })}@@${SUMMARY_OK}`;
      const plan = '1. Do the todo.\n2. Complete.';
      const { taskId } = await makeTask(goal, 'build', plan);
      // The runner contract mirrors the routes: the approved plan arrives
      // from the task ROW, not from caller-invented state.
      const approvedRow = await queries.getTaskById(taskId);
      await runAgent({
        taskId,
        userId: 'x',
        goal,
        mode: 'build',
        approvedPlan: approvedRow?.approved_plan ?? null,
        projectPath: projectDir,
      });

      expect(await statusOf(taskId)).toBe('completed');

      const events = await eventsOf(taskId);
      const toolCalls = eventsByType(events, 'tool_call').map((e) => payload(e)?.name);
      expect(toolCalls).toContain('todo_update');
      expect(toolCalls).toContain('file_list');

      const todoEvent = events.find((e) => e.type === 'todo_update');
      expect(todoEvent).toBeTruthy();

      const verification = eventsByType(events, 'verification');
      expect(verification.some((e) => payload(e)?.status === 'pass')).toBe(true);

      const done = events.find((e) => e.type === 'done');
      expect(payload(done)?.status).toBe('completed');

      const messages = await queries.getMessages(taskId);
      const assistant = messages.filter((m) => m.role === 'assistant' && m.active === 1);
      expect(assistant[0].content).toBe(SUMMARY_OK);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('B5 provider auth failure: run fails honestly with a public error and done event', async () => {
    const goal = 'FAILBEHAVIOR:401';
    const { taskId } = await makeTask(goal, 'chat');
    await runAgent({ taskId, userId: 'x', goal, mode: 'chat' });

    expect(await statusOf(taskId)).toBe('failed');

    const events = await eventsOf(taskId);
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeTruthy();
    const message = payload(errorEvent)?.message as string;
    // The public error is honest but sanitized — no raw key material.
    expect(typeof message).toBe('string');
    expect(message.toLowerCase()).toContain('api key');
    expect(message).not.toContain('test-key-not-real');

    const done = events.find((e) => e.type === 'done');
    expect(payload(done)?.status).toBe('failed');
  }, 30_000);

  it('B6 fallback path: tools rejected → <action> blocks drive the run to completion', async () => {
    const action = JSON.stringify({ tool: 'task_complete', args: { summary: SUMMARY_OK } });
    const goal = `REJECTTOOLSBEHAVIOR:${action}`;
    const { taskId } = await makeTask(goal, 'build', '1. Use the fallback path.\n2. Complete.');
    const approvedRow = await queries.getTaskById(taskId);
    await runAgent({
      taskId,
      userId: 'x',
      goal,
      mode: 'build',
      approvedPlan: approvedRow?.approved_plan ?? null,
    });

    expect(await statusOf(taskId)).toBe('completed');

    const events = await eventsOf(taskId);
    // The fallback path parsed the <action> block: task_complete finalized
    // the run without any native tool_call event.
    expect(eventsByType(events, 'tool_call')).toHaveLength(0);
    const done = events.find((e) => e.type === 'done');
    expect(payload(done)?.status).toBe('completed');

    const messages = await queries.getMessages(taskId);
    const assistant = messages.filter((m) => m.role === 'assistant' && m.active === 1);
    expect(assistant[0].content).toBe(SUMMARY_OK);
  }, 30_000);
});
