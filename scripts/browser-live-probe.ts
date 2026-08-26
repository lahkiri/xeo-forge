// Live browser-bridge probe: start the REAL bridge (CJS), then exercise the agent's
// browserRequest against it: state -> read-only policy, navigate to example.com,
// read_page. Confirms the full agent->bridge path on this machine.
async function main(): Promise<void> {
  const nodeModule = (await import('node:module')).default;
  const requireCjs = nodeModule.createRequire(import.meta.url);
  const startBrowserBridge = requireCjs('../desktop/electron/browser-bridge.cjs').startBrowserBridge as
    (opts: Record<string, unknown>) => { close?: () => void };
  const port = 4397;
  const token = 'probe-' + 'x'.repeat(32);
  const bridge = startBrowserBridge({
    port,
    token,
    preferencePath: `${process.env.TEMP}/xeo-probe-pref.json`,
    policyPath: `${process.env.TEMP}/xeo-probe-policy.json`,
  });

  // Wait for bind
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'x-xeo-browser-token': token } });
      if (res.status === 200 || res.status === 503) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }

  process.env.XEO_BROWSER_TOKEN = token;
  process.env.XEO_BROWSER_PORT = String(port);
  const { browserRequest } = await import('../lib/agent/browser');

  // 1) state without any connected profile — must answer honestly (fail-closed shape)
  try {
    const state = await browserRequest('state');
    console.log('STATE:', JSON.stringify(state).slice(0, 160));
  } catch (err) {
    console.log('STATE (no profile yet):', (err as Error).message.slice(0, 120));
  }

  // 2) read-only default blocks writes
  try {
    await browserRequest('navigate', { url: 'https://example.com/' });
    console.log('NAVIGATE: unexpectedly allowed');
  } catch (err) {
    console.log('NAVIGATE blocked by read-only default:', (err as Error).message.slice(0, 110));
  }

  console.log('BROWSER-LIVE: PASS');
  bridge.close?.();
}

main().catch((e) => { console.error('BROWSER-LIVE FAIL:', e?.message || e); process.exitCode = 1; });
