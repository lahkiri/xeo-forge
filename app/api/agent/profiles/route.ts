import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { createAgentProfile, deleteAgentProfile, listAgentProfiles, updateAgentProfile } from '@/lib/db/queries';
import type { AgentProfileKind } from '@/lib/types';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KindSchema = z.enum(['builder', 'researcher', 'analyst', 'operator', 'custom']);
const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: KindSchema.default('custom'),
  description: z.string().trim().max(500).default(''),
  instructions: z.string().trim().min(1).max(6000),
});
const UpdateSchema = CreateSchema.partial().extend({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
});
const DeleteSchema = z.object({ id: z.string().uuid() });

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ profiles: await listAgentProfiles(user.id, true) });
  } catch (err) {
    return errorResponse('agent/profiles/list', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = CreateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid agent profile.' }, { status: 400 });
    const profile = await createAgentProfile({ userId: user.id, ...parsed.data });
    return NextResponse.json({ profile }, { status: 201 });
  } catch (err) {
    return errorResponse('agent/profiles/create', err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = UpdateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid agent profile update.' }, { status: 400 });
    const { id, ...input } = parsed.data;
    const profile = await updateAgentProfile(id, user.id, {
      name: input.name,
      kind: input.kind,
      description: input.description,
      instructions: input.instructions,
      enabled: input.enabled === undefined ? undefined : (input.enabled ? 1 : 0),
    });
    if (!profile) return NextResponse.json({ error: 'Agent profile not found.' }, { status: 404 });
    return NextResponse.json({ profile });
  } catch (err) {
    return errorResponse('agent/profiles/update', err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = DeleteSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid agent profile deletion.' }, { status: 400 });
    const removed = await deleteAgentProfile(parsed.data.id, user.id);
    if (!removed) return NextResponse.json({ error: 'Agent profile not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('agent/profiles/delete', err);
  }
}
