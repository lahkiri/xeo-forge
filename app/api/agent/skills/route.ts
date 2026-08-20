import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { createAgentSkill, deleteAgentSkill, listAgentSkills, updateAgentSkill } from '@/lib/db/queries';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KindSchema = z.enum(['build', 'research', 'analysis', 'operations', 'content', 'custom']);
const CreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: KindSchema.default('custom'),
  description: z.string().trim().max(500).default(''),
  instructions: z.string().trim().min(1).max(8000),
  profileId: z.string().uuid().nullable().optional(),
});
const UpdateSchema = CreateSchema.partial().extend({ id: z.string().uuid(), enabled: z.boolean().optional() });
const DeleteSchema = z.object({ id: z.string().uuid() });

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ skills: await listAgentSkills(user.id, true) });
  } catch (err) {
    return errorResponse('agent/skills/list', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = CreateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid agent skill.' }, { status: 400 });
    const skill = await createAgentSkill({ userId: user.id, ...parsed.data, profileId: parsed.data.profileId });
    return NextResponse.json({ skill }, { status: 201 });
  } catch (err) {
    return errorResponse('agent/skills/create', err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = UpdateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid agent skill update.' }, { status: 400 });
    const { id, ...input } = parsed.data;
    const skill = await updateAgentSkill(id, user.id, {
      name: input.name,
      kind: input.kind,
      description: input.description,
      instructions: input.instructions,
      profile_id: input.profileId,
      enabled: input.enabled === undefined ? undefined : (input.enabled ? 1 : 0),
    });
    if (!skill) return NextResponse.json({ error: 'Agent skill not found.' }, { status: 404 });
    return NextResponse.json({ skill });
  } catch (err) {
    return errorResponse('agent/skills/update', err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = DeleteSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid agent skill deletion.' }, { status: 400 });
    const removed = await deleteAgentSkill(parsed.data.id, user.id);
    if (!removed) return NextResponse.json({ error: 'Agent skill not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('agent/skills/delete', err);
  }
}
