import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { importSkillFromGitHub } from '@/lib/skills/hub';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ImportSchema = z.object({
  source: z.string().trim().min(3).max(200).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  skillId: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  ref: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = ImportSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'A valid GitHub source and skill ID are required.' }, { status: 400 });
    const skill = await importSkillFromGitHub({ userId: user.id, ...parsed.data });
    return NextResponse.json({ skill }, { status: 201 });
  } catch (error) {
    return errorResponse('skill-hub/import', error);
  }
}
