import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-memory-'));
process.env.DB_PATH = path.join(tempDir, 'memory.sqlite');

let db: typeof import('../lib/db/index').db;
let initSchema: typeof import('../lib/db/schema').initSchema;
let createUser: typeof import('../lib/db/queries').createUser;
let createTask: typeof import('../lib/db/queries').createTask;
let createAgentMemory: typeof import('../lib/db/queries').createAgentMemory;
let updateAgentMemory: typeof import('../lib/db/queries').updateAgentMemory;
let listAgentMemories: typeof import('../lib/db/queries').listAgentMemories;
let getActiveAgentMemories: typeof import('../lib/db/queries').getActiveAgentMemories;
let compileAgentContext: typeof import('../lib/agent/context-pack').compileAgentContext;

beforeAll(async () => {
  const schema = await import('../lib/db/schema');
  const queries = await import('../lib/db/queries');
  const database = await import('../lib/db/index');
  const contextPack = await import('../lib/agent/context-pack');
  initSchema = schema.initSchema;
  createUser = queries.createUser;
  createTask = queries.createTask;
  createAgentMemory = queries.createAgentMemory;
  updateAgentMemory = queries.updateAgentMemory;
  listAgentMemories = queries.listAgentMemories;
  getActiveAgentMemories = queries.getActiveAgentMemories;
  compileAgentContext = contextPack.compileAgentContext;
  db = database.db;
  await initSchema();
});

afterAll(async () => {
  await db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Memory Foundation lifecycle', () => {
  it('keeps proposals out of context until review activates them', async () => {
    const user = await createUser({
      email: `memory-${Date.now()}@example.test`,
      passwordHash: 'test-hash',
      displayName: 'Memory Tester',
    });
    const task = await createTask({ userId: user.id, goal: 'Test memory lifecycle', mode: 'build' });
    const memory = await createAgentMemory({
      userId: user.id,
      taskId: null,
      scope: 'global',
      kind: 'lesson',
      content: 'The user prefers concise release notes.',
      status: 'proposed',
      confidence: 0.9,
      sourceTaskId: task.id,
    });

    const inbox = await listAgentMemories({ userId: user.id, includeArchived: true });
    expect(inbox.some((item) => item.id === memory.id && item.status === 'proposed')).toBe(true);

    const beforeReview = await getActiveAgentMemories({ userId: user.id, taskId: task.id });
    expect(beforeReview.some((item) => item.id === memory.id)).toBe(false);

    const activated = await updateAgentMemory(memory.id, user.id, {
      status: 'active',
      pinned: 1,
    });
    expect(activated?.status).toBe('active');

    const context = await compileAgentContext({
      userId: user.id,
      taskId: task.id,
      baseSystemPrompt: 'Base policy.',
    });
    expect(context.memories.map((item) => item.id)).toContain(memory.id);
    expect(context.systemPrompt).toContain('<xeo_persistent_memory>');
    expect(context.systemPrompt).toContain('The user prefers concise release notes.');
  });

  it('keeps expired active memories visible for review but excludes them from context', async () => {
    const user = await createUser({
      email: `expired-${Date.now()}@example.test`,
      passwordHash: 'test-hash',
      displayName: 'Expiry Tester',
    });
    const task = await createTask({ userId: user.id, goal: 'Test memory expiry', mode: 'build' });
    const memory = await createAgentMemory({
      userId: user.id,
      taskId: null,
      scope: 'global',
      kind: 'fact',
      content: 'This fact has expired.',
      status: 'active',
      confidence: 1,
      pinned: true,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const inbox = await listAgentMemories({ userId: user.id, includeArchived: true });
    expect(inbox.some((item) => item.id === memory.id)).toBe(true);

    const active = await getActiveAgentMemories({ userId: user.id, taskId: task.id });
    expect(active.some((item) => item.id === memory.id)).toBe(false);

    const context = await compileAgentContext({
      userId: user.id,
      taskId: task.id,
      baseSystemPrompt: 'Base policy.',
    });
    expect(context.memories.some((item) => item.id === memory.id)).toBe(false);
    expect(context.systemPrompt).not.toContain('This fact has expired.');
  });
});
