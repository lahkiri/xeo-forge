import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { isDesktopLocalMode } from '@/lib/auth/session';
import { browserRequest } from '@/lib/agent/browser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PreviewTestSchema = z.object({
  url: z.string().url().refine((value) => /^https?:\/\//i.test(value), 'Only http(s) URLs are supported.'),
  clickSelector: z.string().trim().max(240).optional(),
  typeSelector: z.string().trim().max(240).optional(),
  text: z.string().max(500).optional(),
  confirmSensitive: z.boolean().optional().default(false),
});

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function POST(req: NextRequest) {
  if (!isDesktopLocalMode()) {
    return NextResponse.json({ error: 'Browser Preview is available in Desktop Local mode only.' }, { status: 404 });
  }

  try {
    await requireUser();
    const parsed = PreviewTestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Enter a valid http(s) URL. Selectors and text are optional.' }, { status: 400 });
    }

    const { url, clickSelector, typeSelector, text, confirmSensitive } = parsed.data;
    const steps: Array<{ action: string; ok: boolean; result?: unknown; error?: string }> = [];
    const run = async (action: 'navigate' | 'state' | 'read_page' | 'click' | 'type', args: Record<string, unknown> = {}) => {
      try {
        const result = await browserRequest(action, args);
        steps.push({ action, ok: true, result });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steps.push({ action, ok: false, error: message });
        throw new Error(`${action}: ${message}`);
      }
    };

    await run('navigate', { url });
    await wait(500);
    await run('state');
    await run('read_page');

    if (clickSelector) {
      await run('click', { selector: clickSelector, confirmSensitive });
      await wait(250);
    }
    if (typeSelector) {
      if (!text) {
        return NextResponse.json({ error: 'Type selector provided without text.', steps }, { status: 400 });
      }
      await run('type', { selector: typeSelector, text, confirmSensitive });
    }

    return NextResponse.json({
      ok: true,
      steps,
      message: `Browser capability check passed: ${steps.map((step) => step.action).join(' → ')}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[browser/preview-test] failed:', error);
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}
