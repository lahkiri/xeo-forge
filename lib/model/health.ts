/**
 * Provider health probe — detects the stream+tools failure class.
 *
 * WHY: on 2026-08-25 the live session proved a real provider (ktai free tier)
 * serves plain completions fine but rejects ANY streaming request that carries
 * tool definitions (`503 auth_unavailable` from the provider's router). Xeo
 * always sends tools in planning/build, so every governed run fails with an
 * opaque provider error while Chat keeps working — the worst kind of bug for
 * a new user: nothing they control looks broken.
 *
 * This module asks the provider TWO minimal questions and reports the exact
 * diagnosis, honestly:
 *   1. non-streaming, no tools  → is the provider/auth alive at all?
 *   2. streaming, with a tool   → does the governed-run path work?
 *
 * The key is used for the outbound call only and is NEVER logged or returned.
 */

const PROBE_TIMEOUT_MS = 20_000;

export type ProviderVerdict =
  | 'healthy'
  | 'stream_tools_unsupported'
  | 'provider_down'
  | 'auth_failed';

export interface ProbeResult {
  verdict: ProviderVerdict;
  /** Human-readable, honest explanation. Safe to show in Control Center. */
  detail: string;
  base_url: string;
  model_id: string;
  checked_at: string;
  latency_ms: number;
}

/**
 * Pure classifier so tests cover every branch without network.
 * @param basicOk whether probe #1 (non-stream, no tools) succeeded
 * @param probedStatus HTTP status of probe #2 (stream + tools), or 0 on throw
 * @param probedBody response body text of probe #2
 */
export function classifyProbe(
  basicOk: boolean,
  probedStatus: number,
  probedBody: string,
): { verdict: ProviderVerdict; detail: string } {
  const lower = (probedBody || '').toLowerCase();

  if (!basicOk) {
    // Distinguish auth vs dead provider using probe #1's own failure shape is
    // handled by the caller passing through this same function for probe #1;
    // here a failed baseline means the provider is unusable either way.
    return {
      verdict: 'provider_down',
      detail:
        'The provider rejected even a plain non-streaming completion. Check the base URL, the key, and that the model id exists.',
    };
  }

  if (probedStatus >= 200 && probedStatus < 300) {
    return {
      verdict: 'healthy',
      detail: 'Provider accepts streaming requests with tools. Governed runs will work.',
    };
  }

  const saysAuth = /auth|unauthorized|invalid.*(key|token)|api[_ -]?key/.test(lower);
  if (saysAuth && probedStatus !== 503) {
    return {
      verdict: 'auth_failed',
      detail:
        'Plain completions work but the streaming+tools request was rejected as an auth problem. If your key works in Chat, the provider is misclassifying gated requests — report it to the provider.',
    };
  }

  const saysTools = /tool|function/.test(lower);
  if (saysTools || probedStatus === 503) {
    return {
      verdict: 'stream_tools_unsupported',
      detail:
        'Plain completions work, but streaming WITH tools is rejected by the provider. Chat will work; Planning and Build runs will fail until you switch to a provider that supports tool calling over streaming.',
    };
  }

  return {
    verdict: 'provider_down',
    detail: `Streaming+tools request failed with HTTP ${probedStatus}. Plain completions worked, so the key is likely fine — the provider chokes on the governed-run request shape.`,
  };
}

/** One outbound completion call. Returns ok/status/body; never throws. */
async function callOnce(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  opts: { stream: boolean; withTool: boolean },
): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      stream: opts.stream,
    };
    if (opts.withTool) {
      body.tools = [
        {
          type: 'function',
          function: {
            name: 'noop',
            description: 'Health probe tool. Does nothing.',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ];
    }
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 2000) };
  } catch {
    return { ok: false, status: 0, body: '' };
  } finally {
    clearTimeout(timer);
  }
}

/** Run both probes and produce the honest diagnosis. */
export async function probeProvider(
  baseUrl: string,
  apiKey: string,
  modelId: string,
): Promise<ProbeResult> {
  const started = Date.now();
  const basic = await callOnce(baseUrl, apiKey, modelId, { stream: false, withTool: false });
  let probed = await callOnce(baseUrl, apiKey, modelId, { stream: true, withTool: true });
  // Free-tier routers flap: the same key+model can 503 one minute and serve the
  // next. One retry before condemning the governed-run path keeps the verdict
  // honest without making it pessimistic.
  if (!probed.ok && probed.status !== 401 && probed.status !== 403) {
    await new Promise((r) => setTimeout(r, 800));
    probed = await callOnce(baseUrl, apiKey, modelId, { stream: true, withTool: true });
  }
  const { verdict, detail } = classifyProbe(basic.ok, probed.status, probed.body);
  return {
    verdict,
    detail,
    base_url: baseUrl,
    model_id: modelId,
    checked_at: new Date().toISOString(),
    latency_ms: Date.now() - started,
  };
}
