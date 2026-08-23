import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { updateMcpServer, deleteMcpServer } from '@/lib/mcp/registry';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH  /api/mcp/servers/:id — edit config or toggle enabled.
 * DELETE /api/mcp/servers/:id — remove the config and drop its connection.
 *
 * Tenancy is enforced inside the registry: every statement filters on user_id,
 * and a missing row and another user's row are both simply "not found" here.
 */

const EnvSchema = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(64), z.string().max(4096));

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  command: z.string().trim().min(1).max(512).optional(),
  args: z.array(z.string().max(1024)).max(32).optional(),
  env: EnvSchema.optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireUser();
    const parsed = UpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid MCP server update.' }, { status: 400 });
    }
    const server = await updateMcpServer(params.id, user.id, parsed.data);
    if (!server) return NextResponse.json({ error: 'MCP server not found.' }, { status: 404 });
    return NextResponse.json({ server });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.startsWith('mcp:')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return errorResponse('mcp/servers/update', err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireUser();
    const removed = await deleteMcpServer(params.id, user.id);
    if (!removed) return NextResponse.json({ error: 'MCP server not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('mcp/servers/delete', err);
  }
}
