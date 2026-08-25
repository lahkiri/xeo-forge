import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { searchSkillHub } from '@/lib/skills/hub';
import { errorResponse } from '../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const query = req.nextUrl.searchParams.get('q') ?? '';
    const skills = await searchSkillHub(query);
    return NextResponse.json({ skills, query });
  } catch (error) {
    return errorResponse('skill-hub/search', error);
  }
}
