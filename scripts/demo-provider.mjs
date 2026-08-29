/**
 * Demo provider — an OpenAI-compatible scripted streaming provider for the
 * README live-capture session.
 *
 * Drives the REAL governed loop (real DB, real emitter, real tools, real UI)
 * through a full planning → approval → build run:
 *   - detects the mode from the offered tools (file_write present = build)
 *   - streams reasoning_content + text + tool_calls with human-ish pacing
 *   - build phase writes real files and runs the real test suite in the
 *     task workspace, so the Diff tab and verification gate show REAL work
 *
 * Honesty note: this provider scripts the MODEL, nothing else. The loop,
 * guards, permissions, persistence, credits, SSE, and UI are the shipped
 * code paths. README labels captures made with it as "scripted provider".
 */
import http from 'node:http';

const PORT = Number(process.env.DEMO_PORT || 8899);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sseChunk(model, delta, finish) {
  return (
    'data: ' +
    JSON.stringify({
      id: 'chatcmpl-demo',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    }) +
    '\n\n'
  );
}

/** Stream a scripted turn: reasoning → text tokens → tool call → finish. */
async function writeTurn(res, model, { reasoning, text, call }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'close',
  });
  if (reasoning) {
    for (const piece of reasoning.match(/.{1,24}(\s|$)/g) ?? []) {
      res.write(sseChunk(model, { reasoning_content: piece }));
      await sleep(28);
    }
  }
  if (text) {
    for (const piece of text.match(/\S+\s*/g) ?? []) {
      res.write(sseChunk(model, { content: piece }));
      await sleep(55);
    }
  }
  if (call) {
    res.write(
      sseChunk(model, {
        tool_calls: [
          {
            index: 0,
            id: `call_demo_${Date.now()}`,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          },
        ],
      }),
    );
    await sleep(120);
    res.write(sseChunk(model, {}, 'tool_calls'));
  } else {
    res.write(sseChunk(model, {}, 'stop'));
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

const RATE_LIMIT_SRC = [
  "'use strict';",
  '',
  '/**',
  ' * Token-bucket rate limiter for the login route.',
  ' * Keyed by client IP; refills continuously, bursts allowed up to capacity.',
  ' */',
  'class TokenBucket {',
  '  constructor({ capacity = 5, refillPerSec = 0.5 } = {}) {',
  '    this.capacity = capacity;',
  '    this.refillPerSec = refillPerSec;',
  '    this.buckets = new Map();',
  '  }',
  '',
  '  _bucket(key, now) {',
  '    let b = this.buckets.get(key);',
  '    if (!b) {',
  '      b = { tokens: this.capacity, last: now };',
  '      this.buckets.set(key, b);',
  '    }',
  '    return b;',
  '  }',
  '',
  '  take(key, now = Date.now()) {',
  '    const b = this._bucket(key, now);',
  '    const elapsed = (now - b.last) / 1000;',
  '    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);',
  '    b.last = now;',
  '    if (b.tokens >= 1) {',
  '      b.tokens -= 1;',
  '      return { ok: true, remaining: Math.floor(b.tokens) };',
  '    }',
  '    return { ok: false, remaining: 0, retryAfterMs: Math.ceil(((1 - b.tokens) / this.refillPerSec) * 1000) };',
  '  }',
  '',
  '  middleware() {',
  '    return (req, res, next) => {',
  "      const key = req.ip || req.socket?.remoteAddress || 'unknown';",
  '      const result = this.take(key);',
  "      res.setHeader('X-RateLimit-Remaining', result.remaining);",
  '      if (result.ok) return next();',
  "      res.setHeader('Retry-After', Math.ceil(result.retryAfterMs / 1000));",
  "      res.status(429).json({ error: 'Too many login attempts. Try again shortly.' });",
  '    };',
  '  }',
  '}',
  '',
  'module.exports = { TokenBucket };',
  '',
].join('\n');

const TEST_SRC = [
  "'use strict';",
  '',
  "const test = require('node:test');",
  "const assert = require('node:assert');",
  "const { TokenBucket } = require('../src/rateLimit');",
  '',
  "test('allows bursts up to capacity then blocks', () => {",
  '  const limiter = new TokenBucket({ capacity: 3, refillPerSec: 0.001 });',
  "  assert.equal(limiter.take('ip1').ok, true);",
  "  assert.equal(limiter.take('ip1').ok, true);",
  "  assert.equal(limiter.take('ip1').ok, true);",
  "  assert.equal(limiter.take('ip1').ok, false);",
  '});',
  '',
  "test('keys are isolated per client', () => {",
  '  const limiter = new TokenBucket({ capacity: 1, refillPerSec: 0.001 });',
  "  assert.equal(limiter.take('a').ok, true);",
  "  assert.equal(limiter.take('b').ok, true);",
  "  assert.equal(limiter.take('a').ok, false);",
  '});',
  '',
  "test('tokens refill over time', async () => {",
  '  const limiter = new TokenBucket({ capacity: 1, refillPerSec: 50 });',
  "  assert.equal(limiter.take('c').ok, true);",
  "  assert.equal(limiter.take('c').ok, false);",
  '  await new Promise((r) => setTimeout(r, 40));',
  "  assert.equal(limiter.take('c').ok, true);",
  '});',
  '',
].join('\n');

const PLAN = [
  'PLAN — Add rate limiting to the login route (workspace is empty: greenfield build)',
  '',
  'Objective',
  '- Provide a token-bucket rate limiter protecting the login route from brute-force attempts.',
  '',
  'Findings',
  '- file_list shows an empty workspace; there is no existing route to patch.',
  '- Therefore the deliverable is a self-contained module plus its own verification.',
  '',
  'Steps',
  '1. Implement src/rateLimit.js — token bucket keyed by client IP (capacity 5, 0.5 tokens/sec refill), express-style middleware, 429 + Retry-After on exhaustion.',
  '2. Add test/rateLimit.test.js — node:test suite covering burst-then-block, per-key isolation, and refill-over-time.',
  '3. Verify with `node --test test/` and require a fully green exit code before completion.',
  '',
  'Verification',
  '- The suite above must pass inside the task workspace; failure blocks completion.',
  '',
  'Assumptions',
  '- The workspace is greenfield: no existing login route or framework is present to integrate with.',
  '- An express-style middleware shape is the target interface for the limiter.',
  '',
  'Decisions',
  '- Token bucket (not fixed window) — continuous refill is fairer for login attempts.',
  '- Keyed by client IP; capacity 5 with 0.5 tokens/sec refill balances brute-force protection against false lockouts.',
  '',
  'Issues/Limitations',
  '- A single-process in-memory map: distributed deployments would need a shared store.',
  '- IP keying can penalize users behind shared NAT.',
  '',
  'Workarounds/Placeholders',
  '- none — no placeholders are planned; every listed step ships real code in this run.',
].join('\n');

const SUMMARY = [
  'Rate limiting added and verified. src/rateLimit.js implements a token-bucket',
  'limiter keyed by client IP (capacity 5, refill 0.5/s) with an express-style',
  'middleware that answers 429 + Retry-After on exhaustion and exposes',
  'X-RateLimit-Remaining. test/rateLimit.test.js covers burst-then-block,',
  'per-key isolation, and refill-over-time. `node --test test/` — 3/3 passed,',
  'exit code 0, so the verification gate is green.',
  '',
  'Assumptions:',
  '- Greenfield workspace; the limiter ships as a standalone module.',
  '',
  'Decisions:',
  '- Token bucket with continuous refill; IP keying; 429 + Retry-After contract.',
  '',
  'Issues:',
  '- In-memory state is single-process only; a shared store is future work.',
  '',
  'Workarounds:',
  '- none needed.',
].join('\n');

function planningTurn(toolMsgs) {
  if (toolMsgs === 0) {
    return {
      reasoning: 'The plan must rest on what is actually in the workspace. Listing files first.',
      text: "I'll inspect the workspace before proposing anything.",
      call: { name: 'file_list', args: { path: '.' } },
    };
  }
  return {
    reasoning: 'Empty workspace — greenfield. The plan is a self-contained module with its own verification gate.',
    text: 'Workspace is empty, so the plan delivers a self-contained module with its own tests.',
    call: {
      name: 'task_complete',
      args: { summary: PLAN },
    },
  };
}

function buildTurn(toolMsgs) {
  if (toolMsgs === 0) {
    return {
      reasoning: 'Core module first, exactly as the approved plan step 1 says.',
      text: 'Writing the token-bucket limiter (step 1).',
      call: { name: 'file_write', args: { path: 'src/rateLimit.js', content: RATE_LIMIT_SRC } },
    };
  }
  if (toolMsgs === 1) {
    return {
      reasoning: 'Now step 2 — the suite that will gate completion.',
      text: 'Adding the verification suite (step 2).',
      call: { name: 'file_write', args: { path: 'test/rateLimit.test.js', content: TEST_SRC } },
    };
  }
  if (toolMsgs === 2) {
    return {
      reasoning: 'Step 3 — run the suite. Nothing is done until it is green.',
      text: 'Running the tests (step 3).',
      call: { name: 'code_execute', args: { language: 'bash', code: 'node --test test/ 2>&1' } },
    };
  }
  return {
    reasoning: 'Suite is green. Completing with a summary and two bounded memory proposals.',
    text: 'All green — completing.',
    call: {
      name: 'task_complete',
      args: {
        summary: SUMMARY,
        memory_candidates: [
          {
            content: 'This project verifies Node changes with `node --test test/` and requires a green run before completion.',
            kind: 'preference',
            scope: 'global',
            confidence: 0.9,
          },
          {
            content: 'The token-bucket limiter lives in src/rateLimit.js (capacity 5, refill 0.5/s) and guards the login route.',
            kind: 'fact',
            scope: 'global',
            confidence: 0.85,
          },
        ],
      },
    },
  };
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
    const bodyChunks = [];
    req.on('data', (c) => bodyChunks.push(c));
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(bodyChunks).toString('utf8') || '{}');
        const model = body.model || 'demo-governed-model';
        const toolMsgs = (body.messages || []).filter((m) => m.role === 'tool').length;
        const toolNames = (body.tools || []).map((t) => t?.function?.name);
        const isBuild = toolNames.includes('file_write');
        const isChat = toolNames.includes('web_search') && !toolNames.includes('file_list');
        let turn;
        if (isChat) {
          turn = {
            reasoning: 'A direct question about capability — answer plainly, no tools needed.',
            text:
              'I run on a governed Work surface and a separate Chat surface. In Chat I answer and can search the web, but I never write files or execute code. In Work, every run starts with an explicit contract: Planning mode can only inspect; writes stay locked until you approve a structured plan; Build mode executes that frozen plan inside a confined workspace, and every tool call lands in an auditable trail you can export. This answer itself went through the same dispatch gate as every other event in the system.',
            call: null,
          };
        } else {
          turn = isBuild ? buildTurn(toolMsgs) : planningTurn(toolMsgs);
        }
        console.log(`[demo-provider] ${isChat ? 'CHAT' : isBuild ? 'BUILD' : 'PLANNING'} turn ${toolMsgs}: ${turn.call?.name ?? 'text'}`);
        await writeTurn(res, model, turn);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `demo provider failure: ${String(err)}` } }));
      }
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'demo provider: not found' } }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[demo-provider] listening on http://127.0.0.1:${PORT}/v1`);
});
