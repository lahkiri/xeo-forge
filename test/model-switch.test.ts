import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * In-session model switch + provider editing (desktop-parity batch, Phases 2 + 3.2).
 *
 * Phase 3.2: the model was pickable exactly once, at session start. The fix:
 * the governance rail carries a live model switcher; POST /api/tasks/:id/model
 * validates, refuses a live run (credentials resolve once per run, so the
 * in-flight run keeps its loaded provider — no mid-run swap), updates the row,
 * and appends a `model_switch` audit event carrying old → new with the time.
 *
 * Phase 2: the provider API surface already had PATCH provider (name,
 * baseUrl, key) and PATCH/DELETE single model — the UI never exposed them
 * (only Pause + Delete). These pins hold the Edit UI and its key-safety
 * contract: the stored key never round-trips; the edit form's key field is
 * write-only (blank = keep the stored key).
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-model-switch-'));
process.env.DB_PATH = path.join(tempDir, 'model-switch.sqlite');

const REPO_ROOT = path.resolve(__dirname, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

let db: typeof import('../lib/db/index').db;
let initSchema: typeof import('../lib/db/schema').initSchema;
let createUser: typeof import('../lib/db/queries').createUser;
let createTask: typeof import('../lib/db/queries').createTask;
let createModelProvider: typeof import('../lib/db/queries').createModelProvider;
let createProviderModel: typeof import('../lib/db/queries').createProviderModel;
let updateTaskStatus: typeof import('../lib/db/queries').updateTaskStatus;
let updateTaskModel: typeof import('../lib/db/queries').updateTaskModel;
let appendTaskEvent: typeof import('../lib/db/queries').appendTaskEvent;
let getTaskEvents: typeof import('../lib/db/queries').getTaskEvents;

beforeAll(async () => {
  const schema = await import('../lib/db/schema');
  const queries = await import('../lib/db/queries');
  const database = await import('../lib/db/index');
  initSchema = schema.initSchema;
  createUser = queries.createUser;
  createTask = queries.createTask;
  createModelProvider = queries.createModelProvider;
  createProviderModel = queries.createProviderModel;
  updateTaskStatus = queries.updateTaskStatus;
  updateTaskModel = queries.updateTaskModel;
  appendTaskEvent = queries.appendTaskEvent;
  getTaskEvents = queries.getTaskEvents;
  db = database.db;
  await initSchema();
});

afterAll(async () => {
  await db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('updateTaskModel — the row is the truth between runs', () => {
  it('switches provider/model on a terminal task and records the audit event', async () => {
    const user = await createUser({
      email: `switch-${Date.now()}@example.test`,
      passwordHash: 'test-hash',
      displayName: 'Switcher',
    });
    const providerA = await createModelProvider({ userId: user.id, name: 'Provider A', slug: `a-${Date.now()}`, baseUrl: 'https://a.test/v1', apiKey: 'sk-a' });
    const providerB = await createModelProvider({ userId: user.id, name: 'Provider B', slug: `b-${Date.now()}`, baseUrl: 'https://b.test/v1', apiKey: 'sk-b' });
    const modelA = await createProviderModel({ userId: user.id, providerId: providerA.id, name: 'Model A', modelId: 'model-a' });
    const modelB = await createProviderModel({ userId: user.id, providerId: providerB.id, name: 'Model B', modelId: 'model-b' });
    const task = await createTask({
      userId: user.id,
      goal: 'Switch me',
      mode: 'build',
      providerId: providerA.id,
      providerModelId: modelA.id,
    });
    await updateTaskStatus(task.id, 'completed');

    const updated = await updateTaskModel(task.id, user.id, providerB.id, modelB.id);
    expect(updated).toBeDefined();
    expect(updated!.provider_id).toBe(providerB.id);
    expect(updated!.provider_model_id).toBe(modelB.id);

    await appendTaskEvent(task.id, 'model_switch', {
      from: { provider_id: providerA.id, model_id: modelA.id, provider_name: 'Provider A', model_name: 'Model A' },
      to: { provider_id: providerB.id, model_id: modelB.id, provider_name: 'Provider B', model_name: 'Model B' },
      at: new Date().toISOString(),
    });
    const events = await getTaskEvents(task.id);
    const switchEvent = events.find((event) => event.type === 'model_switch');
    expect(switchEvent).toBeDefined();
    const content = JSON.parse(switchEvent!.content) as {
      from?: { model_name?: string };
      to?: { model_name?: string };
      at?: string;
    };
    expect(content.from?.model_name).toBe('Model A');
    expect(content.to?.model_name).toBe('Model B');
    expect(typeof content.at).toBe('string');
  });

  it('refuses to switch while a run is live (no mid-run credential swap)', async () => {
    const user = await createUser({
      email: `switch-live-${Date.now()}@example.test`,
      passwordHash: 'test-hash',
      displayName: 'Live Switcher',
    });
    const providerA = await createModelProvider({ userId: user.id, name: 'Live A', slug: `la-${Date.now()}`, baseUrl: 'https://la.test/v1', apiKey: 'sk-la' });
    const providerB = await createModelProvider({ userId: user.id, name: 'Live B', slug: `lb-${Date.now()}`, baseUrl: 'https://lb.test/v1', apiKey: 'sk-lb' });
    const modelA = await createProviderModel({ userId: user.id, providerId: providerA.id, name: 'Live Model A', modelId: 'live-a' });
    const modelB = await createProviderModel({ userId: user.id, providerId: providerB.id, name: 'Live Model B', modelId: 'live-b' });
    const task = await createTask({
      userId: user.id,
      goal: 'Busy right now',
      mode: 'build',
      providerId: providerA.id,
      providerModelId: modelA.id,
    });
    await updateTaskStatus(task.id, 'running');

    expect(await updateTaskModel(task.id, user.id, providerB.id, modelB.id)).toBeUndefined();
  });
});

describe('route + event contracts', () => {
  const route = readSrc('app/api/tasks/[id]/model/route.ts');

  it('refuses a live run with an honest reason', () => {
    expect(route).toMatch(/status === 'running' \|\| task\.status === 'pending'/);
    expect(route).toMatch(/Wait for it to finish or stop it, then switch the model/);
  });

  it('appends the model_switch audit event carrying old → new', () => {
    expect(route).toMatch(/appendTaskEvent\(task\.id, 'model_switch'/);
    expect(route).toMatch(/from: \{/);
    expect(route).toMatch(/to: \{/);
    expect(route).toMatch(/at: new Date\(\)\.toISOString\(\)/);
  });

  it('validates that the model belongs to the provider and both are enabled', () => {
    expect(route).toMatch(/model\.provider_id !== provider\.id/);
    expect(route).toMatch(/!provider\.enabled \|\| !model\.enabled/);
  });

  it('registers model_switch on the work surface with a timeline label', () => {
    const events = readSrc('lib/agent/events.ts');
    expect(events).toMatch(/'model_switch',/);
    expect(events).toMatch(/model_switch: \{ purpose: 'The operator switched the provider\/model/);
    expect(events).toMatch(/title: 'Model switched'/);
    const workTypes = readSrc('lib/agent/events.ts').includes("model_switch: { purpose:");
    expect(workTypes).toBe(true);
  });

  it('the governance rail renders the switcher, locked while running, hidden in demo', () => {
    const rail = readSrc('app/work/WorkGovernanceRail.tsx');
    expect(rail).toMatch(/aria-label="Switch model for this session"/);
    expect(rail).toMatch(/disabled=\{switching \|\| isRunning\}/);
    expect(rail).toMatch(/!demoMode && \(/);
    expect(rail).toMatch(/\/api\/tasks\/\$\{task\.id\}\/model/);
  });
});

describe('Phase 2 — provider editing surfaces with key safety', () => {
  const manager = readSrc('app/settings/ProvidersManager.tsx');

  it('exposes Edit for providers and for individual models', () => {
    expect(manager).toMatch(/onClick=\{\(\) => openEditProvider\(selectedProvider\)\}/);
    expect(manager).toMatch(/onClick=\{\(\) => openEditModel\(model\)\}/);
    expect(manager).toMatch(/saveProviderEdit/);
    expect(manager).toMatch(/saveModelEdit/);
  });

  it('never round-trips the stored key — the edit field is write-only', () => {
    // Blank = keep the stored key; api_key_set is the only key signal the
    // client ever sees (toSafe contract).
    expect(manager).toMatch(/Leave blank to keep the stored key/);
    expect(manager).toMatch(/type="password"/);
    expect(manager).toMatch(/api_key_set/);
    // The PATCH payload only includes apiKey when the user typed one.
    expect(manager).toMatch(/if \(editProviderForm\.apiKey\.trim\(\)\) payload\.apiKey/);
  });

  it('sends partial provider updates (no blind overwrite)', () => {
    expect(manager).toMatch(/Object\.keys\(payload\)\.length === 0/);
  });
});
