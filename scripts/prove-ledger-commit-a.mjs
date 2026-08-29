/**
 * LIVE PROOF — Commit A of the approved subagent write-concurrency design
 * (docs/subagent-write-concurrency-design.md §6.1):
 *
 *   "Live proof: a desktop run showing file_mutation events in the timeline
 *    exactly as before, plus the new events."
 *
 * What this script does, end to end, with NO test harness in the loop:
 *   1. boots a scripted OpenAI-compatible mock provider (any key accepted);
 *   2. boots the REAL Electron desktop shell (standalone Next server inside),
 *      own temp SQLite, own port;
 *   3. seeds provider + model through the LIVE API, then creates a REAL
 *      build task (surface=work, autonomy=execute) whose scripted build
 *      writes one file TWICE and reads it back;
 *   4. waits for the real planning run to propose its plan, approves through
 *      the REAL decision-gate route, waits for the build run to complete;
 *   5. asserts the persisted timeline contains two APPLIED file_mutation
 *      events — agent "parent", generations 0→1→2, sha16 replay anchors
 *      chained — and captures the desktop timeline as evidence.
 *
 * Hard-fail by design: any missing piece errors out instead of faking proof.
 *
 * Run under a display (manual Xvfb works): DISPLAY=:77 node scripts/prove-ledger-commit-a.mjs
 */

import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const outDir = '/home/z/my-project/download/desktop-evidence';
mkdirSync(outDir, { recursive: true });
const shotPath = join(outDir, '07-ledger-file-mutation-timeline.png');
const dbPath = join(mkdtempSync(join(tmpdir(), 'xeo-ledger-proof-')), 'proof.sqlite');
const appPort = 3200; // passed as XEO_APP_PORT — the desktop shell's actual knob (main.cjs APP_PORT)
const mockPort = 4320;
const appBase = `http://127.0.0.1:${appPort}`;

/* ── 1. Scripted provider: planning asks get prose; the build run gets the
 *      write-twice-read-once script. Discriminator: only build mode is
 *      offered file_write in its tool list. ── */
const SUMMARY = [
  'Assumptions:',
  '- none',
  '',
  'Decisions:',
  '- wrote the demo file twice through the write ledger',
  '',
  'Issues:',
  '- none found',
  '',
  'Workarounds:',
  '- none needed',
].join('\n');

const PLAN_TEXT = [
  '1. Create ledger-demo.txt with an initial line.',
  '2. Overwrite it with a second, longer version (generation 2 through the ledger).',
  '3. Read it back to confirm, then complete with the four-section summary.',
].join('\n');

function sseChunk(delta, finish) {
  return (
    'data: ' +
    JSON.stringify({
      id: 'chatcmpl-proof',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'proof-model',
      choices: [{ index: 0, delta, finish_reason: finish }],
    }) +
    '\n\n'
  );
}

function writeSse(res, chunks) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'close',
  });
  for (const c of chunks) res.write(sseChunk(c.delta, c.finish));
  res.write('data: [DONE]\n\n');
  res.end();
}

function toolCall(name, args, index) {
  return [
    {
      delta: {
        tool_calls: [
          {
            index: 0,
            id: `call_proof_${index}`,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      },
      finish: null,
    },
    { delta: {}, finish: 'tool_calls' },
  ];
}

const BUILD_SCRIPT = [
  { name: 'file_write', args: { path: 'ledger-demo.txt', content: 'version one\n' } },
  { name: 'file_write', args: { path: 'ledger-demo.txt', content: 'version two with more text\n' } },
  { name: 'file_read', args: { path: 'ledger-demo.txt' } },
];

const mockServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
    const bodyChunks = [];
    req.on('data', (c) => bodyChunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(bodyChunks).toString('utf8') || '{}');
      const tools = (body.tools ?? []).map((t) => t?.function?.name);
      const isBuild = tools.includes('file_write');
      if (!isBuild) {
        // Planning run: prose becomes the proposed plan.
        writeSse(res, [
          { delta: { content: PLAN_TEXT }, finish: null },
          { delta: {}, finish: 'stop' },
        ]);
        return;
      }
      const toolMsgs = (body.messages ?? []).filter((m) => m.role === 'tool').length;
      if (toolMsgs < BUILD_SCRIPT.length) {
        const call = BUILD_SCRIPT[toolMsgs];
        writeSse(res, toolCall(call.name, call.args, toolMsgs + 1));
      } else {
        writeSse(res, toolCall('task_complete', { summary: SUMMARY }, BUILD_SCRIPT.length + 1));
      }
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'mock provider: not found' } }));
});
await new Promise((r) => mockServer.listen(mockPort, '127.0.0.1', r));

/* ── 2. The REAL desktop shell. ── */
const electronApp = await _electron.launch({
  args: ['.'],
  executablePath: join(root, 'node_modules', 'electron', 'dist', 'electron'),
  cwd: root,
  env: {
    ...process.env,
    DATABASE_URL: '', // globally preset on this machine — must be empty for SQLite
    DB_PATH: dbPath,
    XEO_APP_PORT: String(appPort), // main.cjs APP_PORT = XEO_APP_PORT || 3100
    HOSTNAME: '127.0.0.1',
    XEO_DESKTOP_LOCAL: '1',
    XEO_DISABLE_UPDATES: '1',
  },
  timeout: 90_000,
});

// The main process's own stderr is invisible to the script otherwise — and a
// silent '[desktop] startup failed' is exactly what a windowless exit looks like.
electronApp.process().stderr?.on('data', (d) => {
  const line = String(d).trim();
  if (line.includes('[desktop]') || line.toLowerCase().includes('error')) {
    console.error(`[electron] ${line}`);
  }
});

const fail = async (message) => {
  console.error(`PROOF FAILED: ${message}`);
  await electronApp.close().catch(() => {});
  mockServer.close();
  process.exit(1);
};

async function api(path, options) {
  const res = await fetch(`${appBase}${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API ${path} → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function poll(label, predicate, timeoutMs, everyMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value.ok) return value.value;
    last = value.why ?? '';
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}. Last: ${last}`);
}

const errors = [];
try {
  const window = await electronApp.firstWindow();
  window.on('pageerror', (e) => errors.push(String(e)));
  await window.context().addInitScript(() => localStorage.setItem('xeo-theme', 'dark'));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2500);

  // ── 3. Seed provider + model through the LIVE API, then the REAL task. ──
  const provider = await api('/api/providers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Ledger Proof Provider',
      slug: 'ledger-proof',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: 'sk-proof-not-real',
    }),
  });
  const model = await api(`/api/providers/${provider.provider.id}/models`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Proof Model',
      modelId: 'proof-model',
      contextWindow: 128000,
      maxTokens: 2048,
      temperature: 0.2,
    }),
  });

  const created = await api('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      goal: 'Write the ledger demo file twice through the write ledger, then read it back.',
      surface: 'work',
      mode: 'build',
      providerId: provider.provider.id,
      providerModelId: model.model.id,
      autonomyLevel: 'execute',
    }),
  });
  const taskId = created.task.id;
  console.log(`[proof] task created: ${taskId} (planning run started)`);

  // ── 4. The REAL decision gate: wait for the plan, approve, wait for build. ──
  await poll(
    'plan proposal',
    async () => {
      const { task } = await api(`/api/tasks/${taskId}`);
      return task.status === 'planned' ? { ok: true } : { why: `status=${task.status}` };
    },
    90_000,
  );
  console.log('[proof] plan proposed — approving through the real gate route');
  await api(`/api/tasks/${taskId}/approve`, { method: 'POST' });

  const finalStatus = await poll(
    'build completion',
    async () => {
      const { task } = await api(`/api/tasks/${taskId}`);
      if (task.status === 'completed' || task.status === 'failed') return { ok: true, value: task.status };
      return { why: `status=${task.status}` };
    },
    120_000,
  );
  if (finalStatus !== 'completed') {
    const { events } = await api(`/api/tasks/${taskId}`);
    const err = events.find((e) => e.type === 'error');
    await fail(`build run ended ${finalStatus}: ${err?.content ?? 'no error event'}`);
  }
  console.log('[proof] build run completed');

  // ── 5. The numeric proof, straight from the persisted timeline. ──
  const { events } = await api(`/api/tasks/${taskId}`);
  const mutations = events
    .filter((e) => e.type === 'file_mutation')
    .map((e) => JSON.parse(e.content));

  console.log('[proof] file_mutation events in the real timeline:');
  for (const m of mutations) console.log('  ' + JSON.stringify(m));

  if (mutations.length !== 2) await fail(`expected 2 file_mutation events, got ${mutations.length}`);
  const [m1, m2] = mutations;
  for (const [label, m] of [['first', m1], ['second', m2]]) {
    if (m.agent !== 'parent') await fail(`${label} mutation agent is ${m.agent}, expected parent`);
    if (m.op !== 'write') await fail(`${label} mutation op is ${m.op}, expected write`);
    if (m.outcome !== 'applied') await fail(`${label} mutation outcome is ${m.outcome}, expected applied`);
    if (!/^[0-9a-f]{16}$/.test(String(m.shaAfter))) await fail(`${label} sha16 malformed`);
  }
  if (m1.generationBefore !== 0 || m1.generationAfter !== 1) await fail('first generations not 0→1');
  if (m2.generationBefore !== 1 || m2.generationAfter !== 2) await fail('second generations not 1→2');
  if (m2.shaBefore !== m1.shaAfter) await fail('replay anchors not chained (m2.shaBefore !== m1.shaAfter)');
  console.log('[proof] ASSERTIONS PASSED: parent writes attributed, generations chained, anchors replayable');

  // ── The desktop timeline, as evidence: the Activity tab renders the raw
  // event stream — the file_mutation rows must be visible there. ──
  await window.goto(`${appBase}/work/${taskId}`, { waitUntil: 'domcontentloaded' });
  await window.waitForTimeout(3500);
  await window.screenshot({ path: shotPath.replace('.png', '-run-view.png') });
  await window.locator('text=Activity').first().click();
  await window.waitForTimeout(1500);
  // The Activity timeline renders file_mutation rows with their human labels
  // ("File written · gen 0 → 1"); both writes must be visible, plus the path.
  const writtenRows = await window.locator('text=File written').count();
  if (writtenRows < 2) throw new Error(`Activity timeline shows ${writtenRows} "File written" rows, expected >= 2`);
  if ((await window.locator('text=ledger-demo.txt').count()) === 0) {
    throw new Error('Activity timeline does not show the written path');
  }
  console.log(`[proof] Activity timeline renders ${writtenRows} file_mutation rows with generation trail`);
  await window.screenshot({ path: shotPath });
  console.log(`[proof] timeline captured: ${shotPath}`);
  console.log(JSON.stringify({ ok: true, taskId, mutations: mutations.length, pageErrors: errors }));

  await electronApp.close();
  mockServer.close();
} catch (err) {
  await fail(String(err?.stack ?? err));
} finally {
  try { rmSync(dbPath, { force: true }); } catch {}
}
