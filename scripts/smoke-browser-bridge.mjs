import { startBrowserBridge } from '../desktop/electron/browser-bridge.cjs';

const port = Number(process.env.XEO_BROWSER_SMOKE_PORT || 4399);
const token = 'smoke-token-' + 'x'.repeat(32);
const bridge = startBrowserBridge({ port, token });

async function waitForBridge() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'x-xeo-browser-token': token } });
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Browser bridge did not start.');
}

try {
  await waitForBridge();
  const unauthorized = await fetch(`http://127.0.0.1:${port}/state`);
  if (unauthorized.status !== 401) throw new Error(`Expected 401 without token, got ${unauthorized.status}`);
  const state = await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'x-xeo-browser-token': token } });
  const body = await state.json();
  if (state.status !== 200 || body.connected !== false) throw new Error(`Unexpected bridge state: ${JSON.stringify(body)}`);
  const command = await fetch(`http://127.0.0.1:${port}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xeo-browser-token': token },
    body: JSON.stringify({ action: 'read_page' }),
  });
  const commandBody = await command.json();
  if (command.status !== 409 || commandBody.ok !== false) throw new Error(`Expected disconnected command rejection: ${JSON.stringify(commandBody)}`);
  console.log(JSON.stringify({ ok: true, checks: ['loopback-token-auth', 'bridge-state', 'disconnected-command-rejection'] }, null, 2));
} finally {
  bridge.close();
}
