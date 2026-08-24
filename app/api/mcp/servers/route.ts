import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { listMcpServers, createMcpServer } from '@/lib/mcp/registry';
import { errorResponse } from '../../_lib/respond';
import { rateLimit, RATE_LIMITS } from '../../_lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MCP server configuration — the user-owned half of the MCP surface.
 *
 * The registry layer (lib/mcp/registry.ts) is the single source of truth for
 * validation, limits, and tenancy; these routes only authenticate, parse, and
 * delegate. That is deliberate: the same registry functions are the ONLY
 * mutation path anywhere, so the agent tool layer structurally cannot reach
 * them (see the registry header — server config is a user decision, never a
 * model decision).
 *
 * Creating a server does NOT connect to it. A bad command fails later, at the
 * first listing, and is reported as a per-server error the UI shows — refusing
 * to store an unverified config would make "add server, fix command later"
 * impossible and teach users to work around the UI.
 */

const EnvSchema = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(64), z.string().max(4096));

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  command: z.string().trim().min(1).max(512),
  args: z.array(z.string().max(1024)).max(32).optional(),
  env: EnvSchema.optional(),
});

/** GET /api/mcp/servers — the caller's configured servers (never another user's). */
export async function GET() {
  try {
    const user = await requireUser();
    const servers = await listMcpServers(user.id, true);
    return NextResponse.json({ servers });
  } catch (err) {
    return errorResponse('mcp/servers/list', err);
  }
}

/** POST /api/mcp/servers — add one stdio server config. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    // Each stored row is a standing invitation to spawn a process; a flood of
    // creates is bounded like task creation.
    const limited = rateLimit(
      `mcpServerCreate:${user.id}`,
      RATE_LIMITS.taskCreate.limit,
      RATE_LIMITS.taskCreate.windowMs,
    );
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
      );
    }
    const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid MCP server configuration.' }, { status: 400 });
    }
    const server = await createMcpServer({ userId: user.id, ...parsed.data });
    return NextResponse.json({ server }, { status: 201 });
  } catch (err) {
    // Registry errors (limits, control characters) are user-actionable —
    // surface the message rather than a generic 500.
    const message = err instanceof Error ? err.message : '';
    if (message.startsWith('mcp:')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse('mcp/servers/create', err);
  }
}
