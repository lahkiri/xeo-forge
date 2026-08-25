import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { importLocalSkill } from '@/lib/skills/hub';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a SKILL.md or skill archive first.' }, { status: 400 });
    const filename = file.name.split(/[\\/]/).pop() || 'skill.md';
    const skill = await importLocalSkill({ userId: user.id, filename, bytes: Buffer.from(await file.arrayBuffer()) });
    return NextResponse.json({ skill }, { status: 201 });
  } catch (error) {
    return errorResponse('skill-hub/import-local', error);
  }
}
