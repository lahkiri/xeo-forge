/**
 * Focused re-capture of desktop evidence 03 (work decision gate + model rail).
 *
 * Why this exists: v1.25.0 shipped the rail's model switcher reading
 * `body?.catalog` from GET /api/providers — a POST-only wrapper — so the
 * MODEL section rendered "No model selected for this task" forever. The
 * original 03 frame documented that empty state honestly: the API was
 * verified correct, but the DISPLAY was never checked — the exact monitoring
 * gap the owner called out.
 *
 * This harness closes that gap at the only layer that matters: it boots the
 * REAL desktop shell against a scripted OpenAI-compatible provider and
 * asserts the selected model name in the rail's RENDERED text
 * (aside.w-rail innerText), plus the switcher's actual selected value.
 * Hard-fail by design — if the value does not reach the display, this
 * errors out instead of capturing garbage.
 *
 * Run under a display: DISPLAY=:77 node scripts/recapture-03-work.mjs
 */
import http from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const outDir = '/home/z/my-project/download/desktop-evidence';
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, '03-work-decision-gate-model-rail.png');
const dbPath = join(mkdtempSync(join(tmpdir(), 'xeo-recap03-')), 'recapture.sqlite');
const appPort = 3110; // XEO_APP_PORT — the desktop shell's actual knob
const mockPort = 4321;
const appBase = `http://127.0.0.1:${appPort}`;

/* Planning prose becomes the proposed plan; the capture stops at the
 * decision gate on purpose — no approval, no build run. */
const PLAN_TEXT = [
  '1. Map every API route in the sandbox service before touching code.',
  '2. Propose the minimal change set with the contract tests that pin it.',
  '3. Report results in the four-section summary.',
].join('\n');

function sseChunk(delta, finish) {
  return (
    'data: ' +
    JSON.stringify({
      id: 'chatcmpl-recap03',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'kimi-k3',
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

const mockServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
    const bodyChunks = [];
    req.on('data', (c) => bodyChunks.push(c));
    req.on('end', () => {
      void Buffer.concat(bodyChunks).toString('utf8');
      writeSse(res, [
        { delta: { content: PLAN_TEXT }, finish: null },
        { delta: {}, finish: 'stop' },
      ]);
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'mock provider: not found' } }));
});
await new Promise((r) => mockServer.listen(mockPort, '127.0.0.1', r));

/* ── The REAL desktop shell, own temp SQLite, own port. ── */
const electronApp = await _electron.launch({
  args: ['.'],
  executablePath: join(root, 'node_modules', 'electron', 'dist', 'electron'),
  cwd: root,
  env: {
    ...process.env,
    DATABASE_URL: '', // globally preset on this machine — must be empty for SQLite
    DB_PATH: dbPath,
    XEO_APP_PORT: String(appPort),
    HOSTNAME: '127.0.0.1',
    XEO_DESKTOP_LOCAL: '1',
    XEO_DISABLE_UPDATES: '1',
  },
  timeout: 90_000,
});

electronApp.process().stderr?.on('data', (d) => {
  const line = String(d).trim();
  if (line.includes('[desktop]') || line.toLowerCase().includes('error')) {
    console.error(`[electron] ${line}`);
  }
});

const fail = async (message) => {
  console.error(`RECAPTURE 03 FAILED: ${message}`);
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
  // The rail mounts at the xl breakpoint (>=1280px) — capture at desktop size.
  await window.setViewportSize({ width: 1440, height: 950 });

  // ── Seed through the LIVE API — same names as the documented evidence series. ──
  const provider = await api('/api/providers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Scripted Provider',
      slug: 'scripted',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: 'sk-capture-not-real',
    }),
  });
  const model = await api(`/api/providers/${provider.provider.id}/models`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Kimi K3 (scripted)',
      modelId: 'kimi-k3',
      contextWindow: 131072,
      maxTokens: 4096,
      temperature: 0.6,
    }),
  });

  const created = await api('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      // Explicit planning language ONLY (classifyWorkIntent): any direct
      // execution word ("build", "change", "implement"...) would classify
      // direct_execution and park the task in awaiting_decision instead of
      // the planned decision gate this evidence frame documents.
      goal: 'Draft a plan that maps out every API route in the sandbox service.',
      surface: 'work',
      mode: 'build',
      providerId: provider.provider.id,
      providerModelId: model.model.id,
      autonomyLevel: 'execute',
    }),
  });
  const taskId = created.task.id;
  console.log(`[recap03] task created: ${taskId} (planning run started)`);

  // ── Wait for the REAL decision gate: status planned, plan proposed. ──
  await poll(
    'plan proposal',
    async () => {
      const { task } = await api(`/api/tasks/${taskId}`);
      return task.status === 'planned' ? { ok: true } : { why: `status=${task.status}` };
    },
    90_000,
  );
  console.log('[recap03] plan proposed — driving the UI to the decision gate');

  await window.goto(`${appBase}/work/${taskId}`, { waitUntil: 'domcontentloaded' });
  await window.waitForSelector('aside.w-rail', { timeout: 45_000 }); // throws on timeout — honest failure
  await window.waitForSelector('button:has-text("Approve and build")', { timeout: 45_000 });
  await window.waitForTimeout(800); // catalog fetch + render settle

  const planShown = await window.locator('text=Map every API route').first().isVisible();
  if (!planShown) throw new Error('plan prose ("Map every API route") is not visible at the gate');

  // ── THE ASSERTION THAT MATTERS: the value reaching the DISPLAY. ──
  const railText = (await window.locator('aside.w-rail').innerText()).replace(/\n/g, ' | ');
  if (!railText.includes('Kimi K3 (scripted)')) {
    throw new Error(`rail MODEL section does not show the selected model. Rail text: ${railText}`);
  }
  if (!railText.includes('Scripted Provider')) {
    throw new Error(`rail MODEL section does not show the provider name. Rail text: ${railText}`);
  }
  if (railText.includes('No model selected')) {
    throw new Error('rail still shows the v1.25.0 empty-model state ("No model selected for this task")');
  }
  const select = window.locator('select[aria-label="Switch model for this session"]');
  const selectValue = await select.inputValue();
  if (selectValue !== model.model.id) {
    throw new Error(`switcher selected value "${selectValue}" != task model id "${model.model.id}"`);
  }
  const optionText = (await select.locator('option:checked').innerText()).trim();
  if (optionText !== 'Kimi K3 (scripted)') {
    throw new Error(`switcher selected option text "${optionText}" is not the seeded model name`);
  }

  console.log('[recap03] ASSERTIONS PASSED: gate rendered, plan shown, rail MODEL filled from the live API');
  await window.screenshot({ path: outPath });
  console.log(`captured: ${outPath}`);
  console.log(
    JSON.stringify({
      ok: true,
      taskId,
      selectValueMatches: selectValue === model.model.id,
      optionText,
      railExcerpt: railText.slice(0, 400),
      pageErrors: errors,
    }),
  );

  await electronApp.close();
  mockServer.close();
} catch (err) {
  await fail(String(err?.stack ?? err));
} finally {
  try { rmSync(dbPath, { force: true }); } catch {}
}
