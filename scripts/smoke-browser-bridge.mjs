import { rmSync } from 'node:fs';
import { startBrowserBridge } from '../desktop/electron/browser-bridge.cjs';
import { WebSocket } from 'ws';

const port = Number(process.env.XEO_BROWSER_SMOKE_PORT || 4399);
const token = 'smoke-token-' + 'x'.repeat(32);
const preferencePath = `/tmp/xeo-forge-browser-smoke-${process.pid}.json`;
const policyPath = `/tmp/xeo-forge-browser-policy-smoke-${process.pid}.json`;
const bridge = startBrowserBridge({ port, token, preferencePath, policyPath });
const sockets = [];

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

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function state() {
  const response = await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'x-xeo-browser-token': token } });
  return response.json();
}

function connectProfile(browserId, profileName) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/extension?token=${encodeURIComponent(token)}`);
  sockets.push(socket);
  socket.on('open', () => socket.send(JSON.stringify({
    type: 'register',
    browserId,
    profileName,
    browserName: 'Smoke Browser',
    extensionVersion: '1.0.0',
    userAgent: 'smoke-test',
    tab: { id: 1, url: `https://${browserId}.example.test`, title: profileName },
    permissions: ['state', 'read_page', 'screenshot'],
  })));
  socket.on('error', () => {});
  return socket;
}

function commandResponder(socket, result) {
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === 'command') socket.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result }));
  });
}

try {
  await waitForBridge();
  const unauthorized = await fetch(`http://127.0.0.1:${port}/state`);
  if (unauthorized.status !== 401) throw new Error(`Expected 401 without token, got ${unauthorized.status}`);

  const first = connectProfile('browser-smoke-one', 'Smoke Chrome');
  await waitFor(async () => (await state()).profiles.length === 1, 'first browser profile');
  let current = await state();
  if (current.selectedBrowserId !== 'browser-smoke-one' || current.selection !== 'selected') {
    throw new Error(`First connected profile was not selected: ${JSON.stringify(current)}`);
  }

  commandResponder(first, { browserId: 'browser-smoke-one', ok: true });
  const firstCommand = await fetch(`http://127.0.0.1:${port}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xeo-browser-token': token },
    body: JSON.stringify({ action: 'state' }),
  });
  const firstCommandBody = await firstCommand.json();
  if (firstCommand.status !== 200 || firstCommandBody.result.browserId !== 'browser-smoke-one') {
    throw new Error(`Selected profile did not receive command: ${JSON.stringify(firstCommandBody)}`);
  }

  const readOnlyWrite = await fetch(`http://127.0.0.1:${port}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xeo-browser-token': token },
    body: JSON.stringify({ action: 'navigate', args: { url: 'https://example.test' } }),
  });
  const readOnlyWriteBody = await readOnlyWrite.json();
  if (readOnlyWrite.status !== 409 || !readOnlyWriteBody.error.includes('disabled')) {
    throw new Error(`Write action was not blocked by default policy: ${JSON.stringify(readOnlyWriteBody)}`);
  }

  bridge.setPolicy({ interactionEnabled: true, allowedDomains: ['example.test'], redactSensitiveData: true, allowSensitiveActions: false });
  const blockedDomain = await fetch(`http://127.0.0.1:${port}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xeo-browser-token': token },
    body: JSON.stringify({ action: 'navigate', args: { url: 'https://evil.test' } }),
  });
  const blockedDomainBody = await blockedDomain.json();
  if (blockedDomain.status !== 409 || !blockedDomainBody.error.includes('allowlist')) {
    throw new Error(`Disallowed domain was not blocked: ${JSON.stringify(blockedDomainBody)}`);
  }

  const sensitiveWithoutConfirmation = await fetch(`http://127.0.0.1:${port}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xeo-browser-token': token },
    body: JSON.stringify({ action: 'type', args: { selector: '#email', text: 'test@example.test' } }),
  });
  const sensitiveBody = await sensitiveWithoutConfirmation.json();
  if (sensitiveWithoutConfirmation.status !== 409 || !sensitiveBody.error.includes('sensitive-action')) {
    throw new Error(`Sensitive action was not blocked without confirmation: ${JSON.stringify(sensitiveBody)}`);
  }

  const second = connectProfile('browser-smoke-two', 'Smoke Edge');
  await waitFor(async () => (await state()).profiles.length === 2, 'second browser profile');
  current = await state();
  if (current.selectedBrowserId !== 'browser-smoke-one') throw new Error('Second connection silently replaced the selected profile.');

  commandResponder(second, { browserId: 'browser-smoke-two', ok: true });
  current = bridge.selectBrowser('browser-smoke-two');
  if (current.selectedBrowserId !== 'browser-smoke-two') throw new Error('Could not select the second browser profile.');
  const secondCommand = await fetch(`http://127.0.0.1:${port}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xeo-browser-token': token },
    body: JSON.stringify({ action: 'state' }),
  });
  const secondCommandBody = await secondCommand.json();
  if (secondCommand.status !== 200 || secondCommandBody.result.browserId !== 'browser-smoke-two') {
    throw new Error(`Command was not routed to the selected second profile: ${JSON.stringify(secondCommandBody)}`);
  }

  second.close();
  await waitFor(async () => (await state()).selection === 'selected_disconnected', 'selected profile disconnect');
  const disconnectedCommand = await fetch(`http://127.0.0.1:${port}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xeo-browser-token': token },
    body: JSON.stringify({ action: 'read_page' }),
  });
  const disconnectedBody = await disconnectedCommand.json();
  if (disconnectedCommand.status !== 409 || disconnectedBody.ok !== false || !disconnectedBody.error.includes('selected browser profile')) {
    throw new Error(`Disconnected selected profile did not fail closed: ${JSON.stringify(disconnectedBody)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'loopback-token-auth',
      'first-profile-registration-and-selection',
      'selected-profile-routing',
      'second-profile-does-not-steal-selection',
      'explicit-profile-switching',
      'disconnected-selected-profile-fails-closed',
      'read-only-default-blocks-write',
      'domain-allowlist-blocks-unknown-host',
      'sensitive-action-requires-confirmation',
    ],
  }, null, 2));
} finally {
  for (const socket of sockets) socket.close();
  bridge.close();
  rmSync(preferencePath, { force: true });
  rmSync(policyPath, { force: true });
}
