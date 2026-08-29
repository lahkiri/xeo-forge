import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import {
  appendTaskEvent,
  getModelProvider,
  getProviderModel,
  getTaskById,
  updateTaskModel,
} from '@/lib/db/queries';
import { errorResponse } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ModelSwitchSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});

/**
 * v1.25: switch the provider/model for an existing task, from inside the
 * session. The row is the truth; the `model_switch` event is the honest
 * audit trail (old → new, with the wall-clock time).
 *
 * A live run is refused: credentials are resolved once per run, so the
 * in-flight run keeps its loaded provider and the switch lands on the next
 * run — never a mid-run credential swap.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    if (task.status === 'running' || task.status === 'pending') {
      return NextResponse.json(
        { error: 'A run is active. Wait for it to finish or stop it, then switch the model.' },
        { status: 409 },
      );
    }

    const parsed = ModelSwitchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'providerId and modelId are required.' }, { status: 400 });
    }

    const provider = await getModelProvider(parsed.data.providerId, user.id);
    if (!provider) {
      return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });
    }
    const model = await getProviderModel(parsed.data.modelId, user.id);
    if (!model || model.provider_id !== provider.id) {
      return NextResponse.json({ error: 'Model not found on this provider.' }, { status: 404 });
    }
    if (!provider.enabled || !model.enabled) {
      return NextResponse.json({ error: 'Both the provider and the model must be enabled.' }, { status: 409 });
    }

    const previous = {
      provider_id: task.provider_id,
      model_id: task.provider_model_id,
      provider_name: null as string | null,
      model_name: null as string | null,
    };
    if (task.provider_id && task.provider_model_id) {
      const prevProvider = await getModelProvider(task.provider_id, user.id);
      const prevModel = await getProviderModel(task.provider_model_id, user.id);
      previous.provider_name = prevProvider?.name ?? null;
      previous.model_name = prevModel?.name ?? null;
    }

    const updated = await updateTaskModel(task.id, user.id, provider.id, model.id);
    if (!updated) {
      return NextResponse.json(
        { error: 'A run just started. Wait for it to finish, then switch the model.' },
        { status: 409 },
      );
    }

    await appendTaskEvent(task.id, 'model_switch', {
      from: {
        provider_id: previous.provider_id,
        model_id: previous.model_id,
        provider_name: previous.provider_name,
        model_name: previous.model_name,
      },
      to: {
        provider_id: provider.id,
        model_id: model.id,
        provider_name: provider.name,
        model_name: model.name,
      },
      at: new Date().toISOString(),
    });

    return NextResponse.json({ task: updated });
  } catch (err) {
    return errorResponse('tasks/model-switch', err);
  }
}
