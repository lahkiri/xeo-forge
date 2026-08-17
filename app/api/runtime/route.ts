import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const port = Number(process.env.XEO_RUNTIME_PORT || 4317);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 700);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return NextResponse.json({ available: false, mode: 'web' });
    const health = await response.json() as { service?: string; version?: string; platform?: string };
    return NextResponse.json({
      available: true,
      mode: 'native',
      service: health.service || 'xeo-forge-runtime-broker',
      version: health.version || 'unknown',
      platform: health.platform || 'unknown',
    });
  } catch {
    return NextResponse.json({ available: false, mode: 'web' });
  } finally {
    clearTimeout(timeout);
  }
}
