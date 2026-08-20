import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HEALTH_TIMEOUT_MS = 700;

interface BrokerHealth {
  service?: string;
  version?: string;
  platform?: string;
  processControl?: boolean;
}

/**
 * Report whether the local Go runtime broker is reachable.
 *
 * The broker binds loopback only and gates /v1/processes behind a shared secret
 * minted by the desktop shell (XEO_RUNTIME_TOKEN). /healthz is unauthenticated
 * so this probe works either way, but we present the token when we have one so
 * the response can report whether process control is actually usable.
 *
 * A missing broker is a normal Web-surface condition, not an error — but the
 * reason is logged rather than swallowed (AGENTS.md rule 3).
 */
export async function GET() {
  const port = Number(process.env.XEO_RUNTIME_PORT || 4317);
  const token = process.env.XEO_RUNTIME_TOKEN?.trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      console.warn(`[runtime] broker health returned ${response.status}; reporting web mode`);
      return NextResponse.json({ available: false, mode: 'web' });
    }
    const health = (await response.json()) as BrokerHealth;
    return NextResponse.json({
      available: true,
      mode: 'native',
      service: health.service || 'xeo-forge-runtime-broker',
      version: health.version || 'unknown',
      platform: health.platform || 'unknown',
      // False when the broker is running without a token: it is alive but
      // refuses process control, and the UI should not offer native actions.
      processControl: health.processControl === true,
    });
  } catch (err) {
    // Expected on the Web surface (no broker) and during desktop startup.
    // Logged at debug level so a real failure is still traceable.
    const reason = err instanceof Error ? err.message : String(err);
    console.debug(`[runtime] broker not reachable on 127.0.0.1:${port}: ${reason}`);
    return NextResponse.json({ available: false, mode: 'web' });
  } finally {
    clearTimeout(timeout);
  }
}
