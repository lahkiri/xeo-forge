export type BrowserAction = 'state' | 'read_page' | 'screenshot' | 'navigate' | 'click' | 'type';

const READ_ACTIONS = new Set<BrowserAction>(['state', 'read_page', 'screenshot']);
const SENSITIVE_ACTIONS = new Set<BrowserAction>(['click', 'type']);

type BrowserPolicy = {
  interactionEnabled?: boolean;
  allowedDomains?: string[];
  redactSensitiveData?: boolean;
  allowSensitiveActions?: boolean;
};

type BrowserBridgeState = {
  tab?: { url?: string } | null;
  browserPolicy?: BrowserPolicy | null;
};

function domainAllowed(value: unknown, domains: unknown): boolean {
  if (typeof value !== 'string' || !value.trim() || !Array.isArray(domains)) return false;
  let hostname: string;
  try {
    hostname = new URL(value).hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
  } catch {
    return false;
  }
  return domains.some((item) => {
    if (typeof item !== 'string') return false;
    const domain = item.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
    return Boolean(domain) && (hostname === domain || hostname.endsWith(`.${domain}`));
  });
}

async function assertInteractionPolicy(action: BrowserAction, args: Record<string, unknown>, token: string, port: number): Promise<void> {
  if (browserActionIsReadOnly(action)) return;
  const state = await fetch(`http://127.0.0.1:${port}/state`, { headers: { 'x-xeo-browser-token': token } }).then(async (response) => {
    const payload = await response.json() as BrowserBridgeState;
    if (!response.ok) throw new Error(`Browser bridge returned HTTP ${response.status}.`);
    return payload;
  });
  const policy = state.browserPolicy;
  if (!policy?.interactionEnabled) throw new Error(`Browser action "${action}" requires explicit browser interaction permission.`);
  const targetUrl = action === 'navigate' ? args.url : state.tab?.url;
  if (!domainAllowed(targetUrl, policy.allowedDomains)) throw new Error('Browser action blocked: target domain is not in the local allowlist.');
  if (SENSITIVE_ACTIONS.has(action) && (!policy.allowSensitiveActions || args.confirmSensitive !== true)) {
    throw new Error(`Browser action "${action}" requires sensitive-action permission and explicit confirmation.`);
  }
}

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
  await assertInteractionPolicy(action, args, token, port);
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
