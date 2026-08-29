/**
 * admin domain queries (moved verbatim from queries.ts).
 */

import { db } from '../index';
import { nowIso } from './shared';
import type {
  ModelSettings,
  AdminAction,
} from '../../types';

/* ------------------------------------------------------------------ */
/* Model settings (single row id=1)                                   */
/* ------------------------------------------------------------------ */

export async function getModelSettings(): Promise<ModelSettings | undefined> {
  return db.prepare<ModelSettings>(`SELECT * FROM model_settings WHERE id = 1`).get();
}

export async function upsertModelSettings(input: {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  contextWindow?: number;
  autoCompactThreshold?: number;
  reasoningEffort?: string;
}): Promise<void> {
  const existing = await getModelSettings();
  const ts = nowIso();
  const contextWindow = input.contextWindow ?? 128000;
  const threshold = input.autoCompactThreshold ?? 80;
  if (existing) {
    await db
      .prepare(
        `UPDATE model_settings
         SET name = ?, base_url = ?, api_key = ?, model_id = ?, temperature = ?,
             max_tokens = ?, context_window = ?, auto_compact_threshold = ?, reasoning_effort = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(
        input.name, input.baseUrl, input.apiKey, input.modelId,
        input.temperature, input.maxTokens, contextWindow, threshold, input.reasoningEffort ?? existing?.reasoning_effort ?? 'default', ts,
      );
  } else {
    await db
      .prepare(
        `INSERT INTO model_settings (id, name, base_url, api_key, model_id, temperature,
         max_tokens, context_window, auto_compact_threshold, reasoning_effort, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name, input.baseUrl, input.apiKey, input.modelId,
        input.temperature, input.maxTokens, contextWindow, threshold, input.reasoningEffort ?? 'default', ts,
      );
  }
}

/* ------------------------------------------------------------------ */
/* Admin actions (audit)                                              */
/* ------------------------------------------------------------------ */

export async function recordAdminAction(input: {
  adminId: string;
  targetUserId?: string | null;
  action: string;
  detail?: string | null;
}): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_actions (admin_id, target_user_id, action, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.adminId, input.targetUserId ?? null, input.action, input.detail ?? null, nowIso());
}

export async function listAdminActions(limit = 200): Promise<AdminAction[]> {
  return db
    .prepare<AdminAction>(`SELECT * FROM admin_actions ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}
