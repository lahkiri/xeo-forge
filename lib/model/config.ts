/**
 * Global model configuration (AGENTS.md rule 5).
 *
 * One model for the entire platform. Source of truth: model_settings row
 * id=1. It is seeded from MODEL_* env vars by scripts/db-init.ts, and may be
 * updated by an admin via /api/admin/model.
 *
 * The api_key is NEVER returned to any client — use toSafe() for responses.
 *
 * Context management fields (context_window, auto_compact_threshold) live
 * here because model_settings is the single source of truth for all model
 * config — no separate subsystem.
 */

import { getModelSettings, upsertModelSettings } from '../db/queries';
import type { ModelSettings, ModelSettingsSafe } from '../types';

/** Values commonly used by local setup files and must not be presented as a valid provider key. */
export function isPlaceholderApiKey(apiKey: string | null | undefined): boolean {
  if (!apiKey) return false;
  const normalized = apiKey.trim().toLowerCase();
  return normalized.includes('placeholder')
    || normalized === 'local-key'
    || normalized === 'local-placeholder'
    || normalized === 'change-me'
    || normalized === 'your-api-key'
    || normalized.startsWith('<')
    || normalized.endsWith('holder');
}

function safeKeyState(apiKey: string | null | undefined): Pick<ModelSettingsSafe, 'api_key_set' | 'api_key_issue'> {
  const present = Boolean(apiKey?.trim());
  return {
    api_key_set: present && !isPlaceholderApiKey(apiKey),
    api_key_issue: present && isPlaceholderApiKey(apiKey) ? 'placeholder' : null,
  };
}

export interface ResolvedModel {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  /** Total context window of the model in tokens (denominator for usage %). */
  contextWindow: number;
  /** Auto-compact trigger as a percent of contextWindow (1–100, default 80). */
  autoCompactThreshold: number;
}

/** Read the env-provided defaults (used for seeding). */
export function modelFromEnv(): ResolvedModel | null {
  const baseUrl = process.env.MODEL_BASE_URL;
  const apiKey = process.env.MODEL_API_KEY;
  const modelId = process.env.MODEL_ID;
  if (!baseUrl || !apiKey || !modelId) return null;
  return {
    name: process.env.MODEL_NAME || modelId,
    baseUrl,
    apiKey,
    modelId,
    temperature: Number(process.env.MODEL_TEMPERATURE || '0.7'),
    maxTokens: Number(process.env.MODEL_MAX_TOKENS || '4000'),
    contextWindow: Number(process.env.MODEL_CONTEXT_WINDOW || '128000'),
    autoCompactThreshold: Number(process.env.MODEL_AUTO_COMPACT_THRESHOLD || '80'),
  };
}

/**
 * Resolve the active model for agent runs. DB row id=1 is authoritative;
 * if absent, fall back to env (so a fresh dev box still works before db:init
 * seeds the row). Returns null if neither is configured.
 */
export async function resolveModel(): Promise<ResolvedModel | null> {
  const row = await getModelSettings();
  if (row) {
    return {
      name: row.name,
      baseUrl: row.base_url,
      apiKey: row.api_key,
      modelId: row.model_id,
      temperature: row.temperature,
      maxTokens: row.max_tokens,
      contextWindow: row.context_window,
      autoCompactThreshold: row.auto_compact_threshold,
    };
  }
  return modelFromEnv();
}

export function toSafe(row: ModelSettings): ModelSettingsSafe {
  const { api_key, ...rest } = row;
  return { ...rest, ...safeKeyState(api_key) };
}

export async function getModelSafe(): Promise<ModelSettingsSafe | null> {
  const row = await getModelSettings();
  if (row) return toSafe(row);
  // Surface env-config as a virtual unsaved row so admin UI can show it.
  const env = modelFromEnv();
  if (!env) return null;
  return {
    id: 1,
    name: env.name,
    base_url: env.baseUrl,
    model_id: env.modelId,
    temperature: env.temperature,
    max_tokens: env.maxTokens,
    context_window: env.contextWindow,
    auto_compact_threshold: env.autoCompactThreshold,
    updated_at: '',
    ...safeKeyState(env.apiKey),
  };
}

export async function updateModel(input: {
  name: string;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  contextWindow?: number;
  autoCompactThreshold?: number;
}): Promise<void> {
  // If no new api key supplied, preserve the existing one.
  let apiKey = input.apiKey;
  if (!apiKey) {
    const existing = await getModelSettings();
    apiKey = existing?.api_key || process.env.MODEL_API_KEY || '';
  }
  await upsertModelSettings({
    name: input.name,
    baseUrl: input.baseUrl,
    apiKey,
    modelId: input.modelId,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    contextWindow: input.contextWindow,
    autoCompactThreshold: input.autoCompactThreshold,
  });
}
