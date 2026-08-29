import { rmSync } from 'node:fs';
import { startBrowserBridge } from '../desktop/electron/browser-bridge.cjs';
import { WebSocket } from 'ws';

const port = Number(process.env.XEO_BROWSER_SMOKE_PORT || 4399);
const token = 'smoke-token-' + 'x'.repeat(32);
const preferencePath = `/tmp/xeo-forge-browser-smoke-${process.pid}.json`;
const policyPath = `/tmp/xeo-forge-browser-policy-smoke-${process.pid}.json`;
const bridge = startBrowserBridge({ port, token, preferencePath, policyPath, approvedPath: `/tmp/xeo-forge-browser-approved-smoke-${process.pid}.json` });
const sockets = [];

// Shared CI runners jank for whole seconds at a time right after the vitest
// suite (GC pauses, CPU steal). The original flat attempt counts — 20×25ms for
// startup, 40×25ms = 1s for every state propagation — flaked at tag time on
// 'paired profile disconnect' (Desktop release run #53, build-linux) while the
// same commit passed CI minutes earlier. Budgets are now deadline-based;
// every assertion below is unchanged — only how long we are willing to wait.
const WAIT_BUDGET_MS = Number(process.env.XEO_SMOKE_WAIT_BUDGET_MS || 10_000);

async function waitForBridge() {
  const deadline = Date.now() + WAIT_BUDGET_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'x-xeo-browser-token': token } });
      if (response.status === 200) return;
    } catch (error) {
      // Expected while the bridge binds its port; surfaced if it never does.
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Browser bridge did not start within ${WAIT_BUDGET_MS}ms.${lastError ? ` Last error: ${lastError.message || lastError}` : ''}`);
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + WAIT_BUDGET_MS;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${WAIT_BUDGET_MS}ms waiting for ${label}.`);
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

  /* ── v1.25: tokenless pairing with explicit operator approval ── */
  const pairSocket = new WebSocket(`ws://127.0.0.1:${port}/pair`);
  sockets.push(pairSocket);
  pairSocket.on('error', () => {});
  await new Promise((resolve, reject) => {
    pairSocket.once('open', resolve);
    pairSocket.once('error', reject);
    setTimeout(() => reject(new Error('pair socket never opened')), 2000);
  });
  let pairedAck = null;
  pairSocket.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === 'paired') pairedAck = message;
  });
  pairSocket.send(JSON.stringify({
    type: 'pair',
    browserId: 'pair-smoke-browser',
    profileName: 'Paired Chrome',
    browserName: 'Smoke Chrome',
    extensionVersion: '1.1.0',
    userAgent: 'smoke-test',
    tab: { id: 9, url: 'https://pair.example.test', title: 'Pair me' },
    permissions: ['state', 'read_page', 'screenshot'],
  }));
  await waitFor(async () => (await state()).pendingPairing.length === 1, 'pending pairing request');
  let current2 = await state();
  if (current2.pendingPairing[0].browserName !== 'Smoke Chrome') {
    throw new Error(`Pairing metadata did not arrive: ${JSON.stringify(current2.pendingPairing)}`);
  }
  // A pre-approval pending connection must NOT be commandable.
  const preApproval = await state();
  if (preApproval.connected || preApproval.profiles.some((p) => p.browserId === 'pair-smoke-browser')) {
    throw new Error('Pending pairing connection leaked into the registered profiles.');
  }
  const approvedState = bridge.approvePairing(current2.pendingPairing[0].id);
  const pairedProfile = approvedState.profiles.find((p) => p.browserId === 'pair-smoke-browser');
  if (!pairedProfile?.connected) {
    throw new Error(`Approved pairing did not connect: ${JSON.stringify(approvedState)}`);
  }
  await waitFor(async () => pairedAck !== null, 'paired acknowledgement');
  commandResponder(pairSocket, { browserId: 'pair-smoke-browser', ok: true });
  bridge.selectBrowser('pair-smoke-browser');
  const pairedCommand = await fetch(`http://127.0.0.1:${port}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xeo-browser-token': token },
    body: JSON.stringify({ action: 'state' }),
  });
  const pairedCommandBody = await pairedCommand.json();
  if (pairedCommand.status !== 200 || pairedCommandBody.result.browserId !== 'pair-smoke-browser') {
    throw new Error(`Approved pairing cannot route commands: ${JSON.stringify(pairedCommandBody)}`);
  }

  // Reconnect with the same browserId → auto-approved, no new request.
  pairSocket.close();
  // The bridge's close handler DROPS the profile from the connections map
  // (browser-bridge.cjs `candidate.on('close')`), so after disconnect the row
  // is gone from /state profiles — `connected === false` only exists inside the
  // few-ms closing-handshake window. Asserting that transient alone was a race
  // lottery: it passed CI #106, failed Desktop run #53, and failed again with a
  // 10s budget (CI on 5ff4f15). The semantic contract is "the paired profile is
  // no longer connected" — either still-present-but-disconnected or dropped.
  // Before close the row is connected:true so this still fails honestly.
  await waitFor(async () => {
    const row = (await state()).profiles.find((p) => p.browserId === 'pair-smoke-browser');
    return !row || row.connected === false;
  }, 'paired profile disconnect');
  const reSocket = new WebSocket(`ws://127.0.0.1:${port}/pair`);
  sockets.push(reSocket);
  reSocket.on('error', () => {});
  await new Promise((resolve) => reSocket.once('open', resolve));
  reSocket.send(JSON.stringify({ type: 'pair', browserId: 'pair-smoke-browser', profileName: 'Paired Chrome', browserName: 'Smoke Chrome', extensionVersion: '1.1.0', userAgent: 'smoke-test', permissions: ['state'] }));
  await waitFor(async () => (await state()).profiles.some((p) => p.browserId === 'pair-smoke-browser' && p.connected), 'auto-approved reconnection');
  const noPending = await state();
  if (noPending.pendingPairing.length !== 0) {
    throw new Error(`Reconnection was not auto-approved: ${JSON.stringify(noPending.pendingPairing)}`);
  }
  reSocket.close();

  // A deny closes the socket without registering anything.
  const denySocket = new WebSocket(`ws://127.0.0.1:${port}/pair`);
  sockets.push(denySocket);
  denySocket.on('error', () => {});
  await new Promise((resolve) => denySocket.once('open', resolve));
  denySocket.send(JSON.stringify({ type: 'pair', browserId: 'deny-smoke-browser', profileName: 'Deny Me', browserName: 'Smoke Chrome', extensionVersion: '1.1.0', userAgent: 'smoke-test', permissions: ['state'] }));
  await waitFor(async () => (await state()).pendingPairing.length === 1, 'deny pairing request');
  const deniedState = await state();
  const denyEntry = deniedState.pendingPairing[0];
  bridge.denyPairing(denyEntry.id);
  await new Promise((resolve) => denySocket.once('close', resolve));
  const afterDeny = await state();
  if (afterDeny.pendingPairing.length !== 0 || afterDeny.profiles.some((p) => p.browserId === 'deny-smoke-browser')) {
    throw new Error('Denied pairing was not cleanly rejected.');
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
      'pending-pairing-holds-unapproved-connection',
      'explicit-pairing-approval-connects-and-routes',
      'approved-browser-reconnects-without-token',
      'denied-pairing-closes-without-registration',
    ],
  }, null, 2));
} finally {
  for (const socket of sockets) socket.close();
  bridge.close();
  rmSync(preferencePath, { force: true });
  rmSync(policyPath, { force: true });
  try { rmSync(`/tmp/xeo-forge-browser-approved-smoke-${process.pid}.json`, { force: true }); } catch {}
}
