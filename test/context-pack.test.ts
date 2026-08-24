import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/*  Context resolution — the single pass the agent loop and the        */
/*  Context Inspector both read (AGENTS.md rule 1).                    */
/*                                                                     */
/*  Exercises lib/agent/context-pack.ts against a real schema. No      */
/*  resolution logic is re-declared here.                              */
/* ------------------------------------------------------------------ */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-ctx-'));
process.env.DB_PATH = path.join(tempDir, 'context.sqlite');

const BASE = 'BASE PLATFORM POLICY';

let db: typeof import('../lib/db/index').db;
let initSchema: typeof import('../lib/db/schema').initSchema;
let createUser: typeof import('../lib/db/queries').createUser;
let createTask: typeof import('../lib/db/queries').createTask;
let createAgentMemory: typeof import('../lib/db/queries').createAgentMemory;
let createAgentInstruction: typeof import('../lib/db/queries').createAgentInstruction;
let updateAgentInstruction: typeof import('../lib/db/queries').updateAgentInstruction;
let resolveContext: typeof import('../lib/agent/context-pack').resolveContext;
let describeEffectiveContext: typeof import('../lib/agent/context-pack').describeEffectiveContext;

let userId: string;
let taskId: string;

beforeAll(async () => {
  const schema = await import('../lib/db/schema');
  const queries = await import('../lib/db/queries');
  const database = await import('../lib/db/index');
  const contextPack = await import('../lib/agent/context-pack');
  initSchema = schema.initSchema;
  createUser = queries.createUser;
  createTask = queries.createTask;
  createAgentMemory = queries.createAgentMemory;
  createAgentInstruction = queries.createAgentInstruction;
  updateAgentInstruction = queries.updateAgentInstruction;
  resolveContext = contextPack.resolveContext;
  describeEffectiveContext = contextPack.describeEffectiveContext;
  db = database.db;
  await initSchema();

  const user = await createUser({
    email: `ctx-${Date.now()}@example.test`,
    passwordHash: 'test-hash',
    displayName: 'Context Tester',
  });
  userId = user.id;
  const task = await createTask({ userId, goal: 'inspect context', mode: 'build' });
  taskId = task.id;
});

afterAll(async () => {
  await db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Context resolution: base policy', () => {
  it('puts the base policy first and marks it authoritative', async () => {
    const resolved = await resolveContext({ userId, taskId, baseSystemPrompt: BASE });
    expect(resolved.layers[0].kind).toBe('base');
    expect(resolved.layers[0].state).toBe('active');
    expect(resolved.layers[0].reason).toMatch(/authoritative/i);
    expect(resolved.systemPrompt.startsWith(BASE)).toBe(true);
  });

  it('reports a reason for every layer, including active ones', async () => {
    const resolved = await resolveContext({ userId, taskId, baseSystemPrompt: BASE });
    for (const layer of resolved.layers) {
      expect(layer.reason.length).toBeGreaterThan(0);
    }
  });

  it('keeps totals consistent with layer states', async () => {
    const resolved = await resolveContext({ userId, taskId, baseSystemPrompt: BASE });
    expect(resolved.totals.activeLayers).toBe(resolved.layers.filter((l) => l.state === 'active').length);
    expect(resolved.totals.excludedLayers).toBe(resolved.layers.filter((l) => l.state !== 'active').length);
    expect(resolved.totals.contextTokens).toBe(
      resolved.totals.promptTokens - resolved.totals.baseTokens,
    );
  });
});

describe('Context resolution: memory approval gate', () => {
  it('withholds a proposed memory and explains that it awaits approval', async () => {
    const memory = await createAgentMemory({
      userId,
      taskId,
      scope: 'task',
      kind: 'fact',
      content: 'This project uses pnpm.',
      status: 'proposed',
      confidence: 0.9,
      sourceTaskId: taskId,
    });

    const resolved = await resolveContext({ userId, taskId, baseSystemPrompt: BASE });
    expect(resolved.memories.some((m) => m.id === memory.id)).toBe(false);
    expect(resolved.systemPrompt).not.toContain('pnpm');

    const described = await describeEffectiveContext({ userId, taskId, baseSystemPrompt: BASE });
    const layer = described.layers.find((l) => l.id === `memory:${memory.id}`);
    expect(layer?.state).toBe('excluded');
    expect(layer?.reason).toMatch(/awaiting your approval/i);
  });

  it('injects an approved memory as reference data with its confidence', async () => {
    const memory = await createAgentMemory({
      userId,
      taskId,
      scope: 'task',
      kind: 'constraint',
      content: 'Never rename the public API surface.',
      status: 'active',
      confidence: 0.8,
      sourceTaskId: taskId,
    });

    const resolved = await resolveContext({ userId, taskId, baseSystemPrompt: BASE });
    expect(resolved.memories.some((m) => m.id === memory.id)).toBe(true);
    expect(resolved.systemPrompt).toContain('Never rename the public API surface.');
    // Framed as data, never as an instruction.
    expect(resolved.systemPrompt).toContain('<xeo_persistent_memory>');
    expect(resolved.systemPrompt).toMatch(/untrusted reference DATA/i);

    const layer = resolved.layers.find((l) => l.id === `memory:${memory.id}`);
    expect(layer?.state).toBe('active');
    expect(layer?.reason).toContain('80%');
  });

  it('collapses byte-identical memories at write time, so only one layer exists', async () => {
    // createAgentMemory already dedupes on normalized content per user+scope+task:
    // a second identical create updates the existing row rather than inserting.
    // The resolver's duplicate detection is therefore a second line of defence
    // for rows that predate that behavior or arrive from different scopes.
    const first = await createAgentMemory({
      userId, taskId, scope: 'task', kind: 'fact',
      content: 'Duplicate memory content.', status: 'active', confidence: 1, sourceTaskId: taskId,
    });
    const second = await createAgentMemory({
      userId, taskId, scope: 'task', kind: 'fact',
      content: 'Duplicate memory content.', status: 'active', confidence: 1, sourceTaskId: taskId,
    });

    expect(second.id).toBe(first.id);

    const resolved = await resolveContext({ userId, taskId, baseSystemPrompt: BASE });
    const matching = resolved.layers.filter((l) => l.id === `memory:${first.id}`);
    expect(matching).toHaveLength(1);
    expect(matching[0].state).toBe('active');

    // The content appears exactly once in the prompt.
    const occurrences = resolved.systemPrompt.split('Duplicate memory content.').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('Context resolution: instruction layers', () => {
  it('injects an enabled instruction and reports its scope and priority', async () => {
    const instruction = await createAgentInstruction({
      userId, taskId, scope: 'task',
      name: 'Design system', content: 'Reuse the existing design system.', priority: 200,
    });

    const resolved = await resolveContext({ userId, taskId, baseSystemPrompt: BASE });
    expect(resolved.systemPrompt).toContain('Reuse the existing design system.');
    expect(resolved.systemPrompt).toContain('<user_configured_instructions>');

    const layer = resolved.layers.find((l) => l.id === `instruction:${instruction.id}`);
    expect(layer?.state).toBe('active');
    expect(layer?.scope).toBe('task');
    expect(layer?.priority).toBe(200);
  });

  it('withholds a disabled instruction and says it is disabled', async () => {
    const instruction = await createAgentInstruction({
      userId, taskId, scope: 'task',
      name: 'Turned off', content: 'This guidance is switched off.', priority: 100,
    });
    await updateAgentInstruction(instruction.id, userId, { enabled: 0 });

    const resolved = await resolveContext({ userId, taskId, baseSystemPrompt: BASE });
    expect(resolved.systemPrompt).not.toContain('This guidance is switched off.');

    const described = await describeEffectiveContext({ userId, taskId, baseSystemPrompt: BASE });
    const layer = described.layers.find((l) => l.id === `instruction:${instruction.id}`);
    expect(layer?.state).toBe('excluded');
    expect(layer?.reason).toMatch(/disabled/i);
  });

  it('treats a task instruction as more specific than a global one with the same name', async () => {
    const globalInstruction = await createAgentInstruction({
      userId, taskId: null, scope: 'global',
      name: 'Package manager', content: 'Use npm for installs.', priority: 100,
    });
    const taskInstruction = await createAgentInstruction({
      userId, taskId, scope: 'task',
      name: 'Package manager', content: 'Use pnpm for installs.', priority: 100,
    });

    const resolved = await resolveContext({ userId, taskId, baseSystemPrompt: BASE });
    const globalLayer = resolved.layers.find((l) => l.id === `instruction:${globalInstruction.id}`);
    const taskLayer = resolved.layers.find((l) => l.id === `instruction:${taskInstruction.id}`);

    expect(taskLayer?.state).toBe('active');
    expect(globalLayer?.state).toBe('overridden');
    expect(globalLayer?.supersededBy).toBe(`instruction:${taskInstruction.id}`);
    expect(globalLayer?.reason).toMatch(/more specific/i);
    expect(resolved.systemPrompt).toContain('Use pnpm for installs.');
    expect(resolved.systemPrompt).not.toContain('Use npm for installs.');
  });
});

describe('describeEffectiveContext', () => {
  it('agrees with the loop on every active layer, so it cannot report a phantom', async () => {
    const args = { userId, taskId, baseSystemPrompt: BASE };
    const resolved = await resolveContext(args);
    const described = await describeEffectiveContext(args);

    const injected = resolved.layers.filter((l) => l.state === 'active').map((l) => l.id).sort();
    const reported = described.layers.filter((l) => l.state === 'active').map((l) => l.id).sort();
    expect(reported).toEqual(injected);
  });

  it('reports withheld layers that the loop does not compute', async () => {
    const args = { userId, taskId, baseSystemPrompt: BASE };
    const resolved = await resolveContext(args);
    const described = await describeEffectiveContext(args);
    expect(described.layers.length).toBeGreaterThanOrEqual(resolved.layers.length);
  });

  it('never returns the system prompt to the client', async () => {
    const described = await describeEffectiveContext({ userId, taskId, baseSystemPrompt: BASE });
    expect('systemPrompt' in described).toBe(false);
  });
});
