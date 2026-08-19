export type BrowserAction = 'state' | 'read_page' | 'screenshot' | 'navigate' | 'click' | 'type';

const READ_ACTIONS = new Set<BrowserAction>(['state', 'read_page', 'screenshot']);

function bridgeConfig() {
  const token = process.env.XEO_BROWSER_TOKEN || '';
  const port = Number(process.env.XEO_BROWSER_PORT || 4321);
  return { token, port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 4321 };
}

export function browserActionIsReadOnly(action: BrowserAction): boolean {
  return READ_ACTIONS.has(action);
}

export async function browserRequest(action: BrowserAction, args: Record<string, unknown> = {}): Promise<unknown> {
  const { token, port } = bridgeConfig();
  if (!token) throw new Error('Local browser bridge is not configured. Start Xeo Forge Desktop and connect the optional extension.');
  if (!browserActionIsReadOnly(action) && process.env.XEO_BROWSER_ALLOW_INTERACTION !== '1') {
    throw new Error(`Browser action "${action}" requires explicit browser interaction permission.`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xeo-browser-token': token },
      body: JSON.stringify({ action, args }),
      signal: controller.signal,
    });
    const payload = await response.json() as { ok?: boolean; result?: unknown; error?: string };
    if (!response.ok || !payload.ok) throw new Error(payload.error || `Browser bridge returned HTTP ${response.status}.`);
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function browserState(): Promise<unknown> {
  const { token, port } = bridgeConfig();
  if (!token) return { connected: false, reason: 'bridge_not_configured' };
  const response = await fetch(`http://127.0.0.1:${port}/state`, {
    headers: { 'x-xeo-browser-token': token },
  });
  if (!response.ok) throw new Error(`Browser bridge returned HTTP ${response.status}.`);
  return response.json();
}
