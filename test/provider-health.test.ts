import { describe, it, expect } from 'vitest';
import { classifyProbe } from '../lib/model/health';

/**
 * Pins the provider-health classifier against every failure shape observed in
 * the wild — most importantly the ktai free-tier behavior proven live on
 * 2026-08-25: plain completions OK, streaming+tools rejected 503
 * auth_unavailable. Chat works, governed runs fail, and nothing tells the
 * user why. This probe turns that into an honest diagnosis.
 */
describe('classifyProbe: provider health verdicts', () => {
  const TOOLY_503 = JSON.stringify({
    error: {
      message:
        'auth_unavailable: no auth available (providers=openai-compatible-provider-oz, model=ox-alpha)',
      type: 'server_error',
      code: 'internal_server_error',
    },
  });

  it('healthy when both probes pass', () => {
    const { verdict, detail } = classifyProbe(true, 200, '{"choices":[]}');
    expect(verdict).toBe('healthy');
    expect(detail).toMatch(/Governed runs will work/);
  });

  it('THE ktai case: baseline ok + 503 on stream+tools → stream_tools_unsupported', () => {
    const { verdict, detail } = classifyProbe(true, 503, TOOLY_503);
    expect(verdict).toBe('stream_tools_unsupported');
    // The detail must tell the user what works and what does not.
    expect(detail).toMatch(/Chat will work/);
    expect(detail).toMatch(/Planning and Build runs will fail/);
    // And must not accuse their key.
    expect(detail).not.toMatch(/check the .*key/i);
  });

  it('provider_down when even the plain completion fails', () => {
    const { verdict } = classifyProbe(false, 0, '');
    expect(verdict).toBe('provider_down');
  });

  it('auth_failed only for a genuine auth rejection on the gated probe (not 503)', () => {
    const body = JSON.stringify({ error: { message: 'Incorrect API key provided' } });
    const { verdict } = classifyProbe(true, 401, body);
    expect(verdict).toBe('auth_failed');
  });

  it('generic non-auth failure on stream+tools still reports the request-shape problem', () => {
    const { verdict, detail } = classifyProbe(true, 500, 'internal error');
    expect(verdict).toBe('provider_down');
    expect(detail).toMatch(/request shape/);
  });

  it('tool-worded 400 counts as tools unsupported, not auth', () => {
    const body = JSON.stringify({ error: { message: 'tools is not supported by this model' } });
    const { verdict } = classifyProbe(true, 400, body);
    expect(verdict).toBe('stream_tools_unsupported');
  });
});
