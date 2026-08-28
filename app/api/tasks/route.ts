import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guard';
import { isDesktopLocalMode } from '@/lib/auth/session';
import { getTasksByUser, createTask, getSelectedProviderModel, updateTaskStatus, appendMessage, appendTaskEvent } from '@/lib/db/queries';
import { tryDebit } from '@/lib/credits/engine';
import { TASK_CREATE_COST } from '@/lib/credits/pricing';
import { startAgentRun } from '@/lib/agent/runner';
import { classifyWorkIntent } from '@/lib/agent/intent';
import { normalizeAutonomyInput } from '@/lib/agent/permissions';
import { THINKING_LEVELS, isThinkingEffort } from '@/lib/model/thinking';
import { errorResponse } from '../_lib/respond';
import { rateLimit, RATE_LIMITS } from '../_lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateTaskSchema = z.object({
  goal: z.string().min(1).max(20000),
  mode: z.enum(['chat', 'planning', 'build']).optional(),
  surface: z.enum(['chat', 'work']).optional(),
  projectPath: z.string().trim().min(1).max(4096).nullable().optional(),
  profileId: z.string().uuid().nullable().optional(),
  skillId: z.string().uuid().nullable().optional(),
  providerId: z.string().uuid().nullable().optional(),
  providerModelId: z.string().uuid().nullable().optional(),
  /** Validated against the real level set below — not inside Zod, so the error names the valid levels. */
  autonomyLevel: z.string().max(20).optional(),
  /** v1.23 thinking-effort level — validated against lib/model/thinking. */
  thinkingEffort: z.string().max(20).optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const tasks = await getTasksByUser(user.id);
    return NextResponse.json({ tasks });
  } catch (err) {
    return errorResponse('tasks/list', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    // Keyed by user, not by IP: the route is authenticated, so the session is a
    // stronger identity than a header we may not be able to trust, and one
    // account cannot exhaust another's allowance. Creating a task starts an
    // agent run — host processes, provider calls, credits — so this is the most
    // expensive thing an authenticated client can ask for in a loop.
    const limited = rateLimit(
      `taskCreate:${user.id}`,
      RATE_LIMITS.taskCreate.limit,
      RATE_LIMITS.taskCreate.windowMs,
    );
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'Too many tasks started. Please wait before starting another.' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
      );
    }

    const body = await req.json();
    const parsed = CreateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'A non-empty goal is required.' }, { status: 400 });
    }

    // Authority is chosen BEFORE the run starts and validated with a human
    // reason, because an unknown level that silently coerced to a broader one
    // would be an authority escalation hidden behind a typo.
    const autonomy = normalizeAutonomyInput(parsed.data.autonomyLevel);
    if (!autonomy.ok) {
      return NextResponse.json({ error: autonomy.reason }, { status: 400 });
    }
    if (parsed.data.thinkingEffort !== undefined && !isThinkingEffort(parsed.data.thinkingEffort)) {
      return NextResponse.json(
        { error: `Unknown thinking effort "${parsed.data.thinkingEffort}". Valid levels: ${THINKING_LEVELS.map((l) => l.id).join(', ')}.` },
        { status: 400 },
      );
    }

    if (parsed.data.providerId || parsed.data.providerModelId) {
      if (!parsed.data.providerId || !parsed.data.providerModelId) {
        return NextResponse.json({ error: 'Choose both a provider and a model.' }, { status: 400 });
      }
      const selectedModel = await getSelectedProviderModel({ userId: user.id, providerId: parsed.data.providerId, providerModelId: parsed.data.providerModelId });
      if (!selectedModel) {
        return NextResponse.json({ error: 'The selected provider or model is disabled or unavailable.' }, { status: 400 });
      }
    }

    const requestedMode = parsed.data.mode === 'chat' ? 'chat' : 'planning';
    const surface = parsed.data.surface ?? (requestedMode === 'chat' ? 'chat' : 'work');
    const intent = surface === 'work'
      ? classifyWorkIntent(parsed.data.goal)
      : classifyWorkIntent('');
    const needsDecision = surface === 'work'
      && (intent.kind === 'direct_execution' || intent.kind === 'clarification_needed');
    const mode = surface === 'chat'
      ? 'chat'
      : intent.kind === 'explicit_plan'
        ? 'planning'
        : needsDecision
          ? 'planning'
          : requestedMode;
    const decisionExpiresAt = needsDecision
      ? new Date(Date.now() + 30_000).toISOString()
      : null;

    const task = await createTask({
      userId: user.id,
      goal: parsed.data.goal,
      mode,
      projectPath: parsed.data.projectPath,
      profileId: parsed.data.profileId,
      skillId: parsed.data.skillId,
      providerId: parsed.data.providerId,
      providerModelId: parsed.data.providerModelId,
      autonomyLevel: autonomy.level,
      thinkingEffort: parsed.data.thinkingEffort ?? null,
      status: needsDecision ? 'awaiting_decision' : 'pending',
      intentKind: intent.kind,
      decisionState: needsDecision ? 'pending' : null,
      decisionExpiresAt,
    });

    // A direct Work request is deliberately not charged or started before the
    // user chooses a path. The choice endpoint owns the later transition.
    if (needsDecision) {
      await appendMessage(task.id, 'user', parsed.data.goal);
      await appendTaskEvent(task.id, 'intent', {
        kind: intent.kind,
        reason: intent.reason,
        confidence: intent.confidence,
        summary: intent.summary,
        options: intent.options,
        expires_at: decisionExpiresAt,
      });
      return NextResponse.json({
        task,
        decision: {
          kind: intent.kind,
          reason: intent.reason,
          summary: intent.summary,
          options: intent.options,
          expiresAt: decisionExpiresAt,
        },
      }, { status: 202 });
    }

    // Ordinary chat is not a billable SaaS task and must not be blocked by a
    // local credit balance. Planning/build requests retain the explicit budget
    // guard until a cloud usage ledger is connected.
    if (mode !== 'chat' && !isDesktopLocalMode()) {
      const debited = await tryDebit(user.id, TASK_CREATE_COST, 'task_create', task.id);
      if (!debited.ok) {
        await updateTaskStatus(task.id, 'failed', {
          error: `Insufficient credits to start task (balance ${debited.balance}, need ${debited.needed}).`,
        });
        return NextResponse.json(
          { error: 'Insufficient credits', balance: debited.balance, needed: debited.needed },
          { status: 402 },
        );
      }
    }

    await appendMessage(task.id, 'user', parsed.data.goal);
    await appendTaskEvent(task.id, 'intent', {
      kind: intent.kind,
      reason: intent.reason,
      confidence: intent.confidence,
      summary: intent.summary,
    });

    // Fire-and-forget; the runner owns status transitions and failure emission.
    startAgentRun({
      taskId: task.id,
      userId: user.id,
      goal: parsed.data.goal,
      mode,
      projectPath: task.project_path,
      // The row is authoritative from here on: this value was just persisted
      // and every later run (approve/message) re-reads it from the row.
      autonomyLevel: autonomy.level,
      thinkingEffort: parsed.data.thinkingEffort ?? null,
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return errorResponse('tasks/create', err);
  }
}
