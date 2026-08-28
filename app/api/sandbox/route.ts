import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { detectDocker, dockerInstallGuidance, SANDBOX_MODES } from '@/lib/agent/sandbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sandbox tier metadata + a REAL Docker detection probe.
 *
 * GET /api/sandbox → { modes, docker } — the UI renders the honest tier
 * descriptions verbatim and gates the docker tier on the actual probe
 * result, never on an assumption.
 */
export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  }
  const docker = await detectDocker();
  return NextResponse.json({
    modes: SANDBOX_MODES,
    docker: {
      available: docker.available,
      version: docker.version ?? null,
      detail: docker.detail,
      guidance: docker.available ? null : dockerInstallGuidance(process.platform),
    },
  });
}
