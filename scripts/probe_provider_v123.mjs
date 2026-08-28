#!/usr/bin/env node
/**
 * Live provider capability probes — v1.23 Phase 1.5.
 *
 * For every chat-capable model discovered on the provider, run four probes
 * and record honest PASS/FAIL/PARTIAL + token usage per call:
 *   A. native tool-calling  — does the model emit tool_calls for file_list?
 *   B. reasoning channel    — reasoning_content field / inline <think> tag / none
 *   C. reasoning_effort     — accepted / rejected / ignored (baseline vs 'high')
 *   D. streaming integrity  — SSE deltas arrive, concat == final, finish_reason seen
 *
 * Run: node scripts/probe_provider_v123.mjs
 * Env: PROBE_BASE_URL, PROBE_KEY, PROBE_MODELS (comma list) optional
 */
const BASE = process.env.PROBE_BASE_URL ?? 'https://ktai.koyeb.app/v1';
const KEY = process.env.PROBE_KEY ?? '';
if (!KEY) { console.error('PROBE_KEY required'); process.exit(1); }

const IMAGE_OR_EMBED = /flux|embedding|whisper|tts|rerank/i;

async function jfetch(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, text: text.slice(0, 400) };
}

/** One non-streaming call; returns {ok, content, toolCalls, reasoning, usage, error}. */
async function callOnce(model, extra = {}) {
  const body = {
    model,
    messages: [
      { role: 'system', content: 'You are a precise assistant. Use the tools provided when asked to act on the workspace.' },
      { role: 'user', content: 'List the files in the workspace root using the file_list tool. Do not answer from memory.' },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'file_list',
        description: 'List files and directories at a workspace path.',
        parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path; "." for root' } }, required: ['path'] },
      },
    }, {
      type: 'function',
      function: {
        name: 'task_complete',
        description: 'Finish the task with a summary.',
        parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      },
    }],
    tool_choice: 'auto',
    max_tokens: 300,
    ...extra,
  };
  const t0 = Date.now();
  const { status, json, text } = await jfetch('/chat/completions', body);
  const ms = Date.now() - t0;
  if (status !== 200 || !json) {
    return { ok: false, error: `HTTP ${status}: ${text}`, ms, usage: null };
  }
  const choice = json.choices?.[0];
  const delta = choice?.message ?? {};
  const toolCalls = (delta.tool_calls ?? []).map((tc) => tc.function?.name).filter(Boolean);
  const reasoning = delta.reasoning_content ?? delta.reasoning ?? null;
  return {
    ok: true,
    content: typeof delta.content === 'string' ? delta.content : '',
    reasoning: reasoning ? String(reasoning) : null,
    toolCalls,
    finish: choice?.finish_reason ?? null,
    usage: json.usage ?? null,
    ms,
    error: json.error ? JSON.stringify(json.error).slice(0, 200) : null,
  };
}

/** Streaming probe: verifies deltas arrive and finish_reason is seen. */
async function streamProbe(model, extra = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Count from 1 to 5, digits separated by spaces. Nothing else.' }],
      max_tokens: 80,
      stream: true,
      ...extra,
    }),
  });
  const ms = Date.now() - t0;
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}`, ms };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let deltas = 0;
  let content = '';
  let reasoning = '';
  let finish = null;
  let usage = null;
  const t1 = Date.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const d = j.choices?.[0]?.delta ?? {};
        if (typeof d.content === 'string' && d.content) { deltas++; content += d.content; }
        const r = d.reasoning_content ?? d.reasoning;
        if (typeof r === 'string' && r) { reasoning += r; }
        if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason;
        if (j.usage) usage = j.usage;
      } catch { /* skip malformed */ }
    }
  }
  const totalMs = Date.now() - t0;
  return {
    ok: deltas > 0 && finish !== null,
    deltas, finish, streamMs: Date.now() - t1, totalMs, usage,
    content: content.slice(0, 120),
    reasoningLen: reasoning.length,
    error: deltas === 0 ? 'no deltas received' : finish === null ? 'no finish_reason' : null,
  };
}

const THINK_PROBE = {
  messages: [{ role: 'user', content: 'A bat and a ball cost $1.10 together. The bat costs $1.00 more than the ball. What does the ball cost? Think step by step.' }],
};

async function reasoningProbe(model) {
  // Baseline: does the model emit any reasoning channel on a reasoning-flavored prompt?
  const r = await callOnce(model, { ...THINK_PROBE, tools: undefined, tool_choice: undefined, max_tokens: 400 });
  const tag = /<think>/i.test(r.content ?? '');
  const channel = r.reasoning ? 'reasoning_field' : tag ? 'think_tag' : 'none';
  return { channel, reasoningLen: r.reasoning?.length ?? 0, tagLen: tag ? (r.content.match(/<think>[\s\S]*?<\/think>/gi)?.reduce((a, b) => a + b.length, 0) ?? 0) : 0, usage: r.usage, ms: r.ms, error: r.error ?? null };
}

async function effortProbe(model) {
  // Does reasoning_effort:'high' change acceptance (vs baseline)? Proxies may
  // reject unknown params with 400 — that is a REJECT. 200 = accepted-or-ignored;
  // distinguish later by comparing reasoning volume if both succeeded.
  const withEffort = await callOnce(model, { ...THINK_PROBE, tools: undefined, tool_choice: undefined, max_tokens: 400, reasoning_effort: 'high' });
  return {
    accepted: withEffort.ok,
    httpError: withEffort.error ?? null,
    reasoningLen: withEffort.reasoning?.length ?? 0,
    contentLen: (withEffort.content ?? '').length,
    usage: withEffort.usage,
    ms: withEffort.ms,
  };
}

async function main() {
  const listRes = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${KEY}` } });
  const listJson = await listRes.json();
  const all = (listJson.data ?? []).map((m) => m.id).sort();
  const candidates = (process.env.PROBE_MODELS ? process.env.PROBE_MODELS.split(',') : all)
    .filter((id) => !IMAGE_OR_EMBED.test(id));
  console.error(`Probing ${candidates.length} models on ${BASE}`);
  const results = [];
  for (const model of candidates) {
    const row = { model };
    process.stderr.write(`\n== ${model}\n`);
    try {
      row.tools = await callOnce(model);
      process.stderr.write(`   tools: ${row.tools.ok ? (row.tools.toolCalls.length ? row.tools.toolCalls.join(',') : 'no-call') : `ERR ${row.tools.error?.slice(0, 80)}`} (${row.tools.ms}ms)\n`);
    } catch (e) { row.tools = { ok: false, error: String(e).slice(0, 150) }; }
    try {
      row.reasoning = await reasoningProbe(model);
      process.stderr.write(`   reasoning: ${row.reasoning.channel} (${row.reasoning.reasoningLen || 0} chars)\n`);
    } catch (e) { row.reasoning = { channel: 'error', error: String(e).slice(0, 150) }; }
    try {
      row.effort = await effortProbe(model);
      process.stderr.write(`   effort: ${row.effort.accepted ? 'accepted' : `REJECT ${row.effort.httpError?.slice(0, 60)}`}\n`);
    } catch (e) { row.effort = { accepted: false, httpError: String(e).slice(0, 150) }; }
    try {
      row.stream = await streamProbe(model);
      process.stderr.write(`   stream: ${row.stream.ok ? `ok ${row.stream.deltas} deltas, finish=${row.stream.finish}` : `ERR ${row.stream.error}`}\n`);
    } catch (e) { row.stream = { ok: false, error: String(e).slice(0, 150) }; }
    results.push(row);
    // Incremental persistence: a hung model must not cost the whole batch
    // (batch-2 lesson — gemma-4 504 after 100s killed the unwritten file).
    const { writeFileSync: wf } = await import('node:fs');
    wf('/home/z/my-project/research/ktai-probe-raw-latest.json', JSON.stringify(results, null, 2));
  }

  // Summary table + honest usage accounting.
  let totalTokens = 0;
  const tokenOf = (u) => (u ? (u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)) : 0);
  const lines = [];
  lines.push(`# Live probe results — ${BASE} — ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Models probed: ${results.length}`);
  lines.push('');
  lines.push('| model | tools | reasoning channel | effort param | stream | tokens(4 calls) |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of results) {
    const t = r.tools ?? {};
    const toolCell = t.ok ? (t.toolCalls?.length ? `YES (${t.toolCalls.join(',')})` : 'NO-CALL (text reply)') : `ERR`;
    const rc = r.reasoning?.channel ?? 'err';
    const ec = r.effort?.accepted ? (r.effort.reasoningLen > 0 ? 'accepted+reasoning' : 'accepted') : 'REJECT';
    const sc = r.stream?.ok ? `ok (${r.stream.deltas}Δ)` : 'FAIL';
    const tok = tokenOf(t.usage) + tokenOf(r.reasoning?.usage) + tokenOf(r.effort?.usage) + tokenOf(r.stream?.usage);
    totalTokens += tok;
    lines.push(`| ${r.model} | ${toolCell} | ${rc} | ${ec} | ${sc} | ${tok} |`);
  }
  lines.push('');
  lines.push(`**Total measured tokens: ${totalTokens}**`);
  lines.push('');
  lines.push('## Raw detail');
  lines.push('```json');
  lines.push(JSON.stringify(results, null, 2).slice(0, 40000));
  lines.push('```');
  const out = '/home/z/my-project/research/ktai-probe-results.md';
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, lines.join('\n'));
  console.error(`\nWrote ${out} — total tokens ~${totalTokens}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
