/**
 * providers domain queries (moved verbatim from queries.ts).
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../index';
import { nowIso } from './shared';
import type {
  ModelProvider,
  ProviderModel,
} from '../../types';

/* ------------------------------------------------------------------ */
/* Provider catalog (multi-provider / multi-model)                    */
/* ------------------------------------------------------------------ */

export async function listModelProviders(userId: string): Promise<ModelProvider[]> {
  return db.prepare<ModelProvider>(
    `SELECT * FROM model_providers WHERE user_id = ? ORDER BY enabled DESC, updated_at DESC`,
  ).all(userId);
}

export async function listProviderModels(userId: string): Promise<ProviderModel[]> {
  return db.prepare<ProviderModel>(
    `SELECT m.*
       FROM provider_models m
       JOIN model_providers p ON p.id = m.provider_id
      WHERE p.user_id = ?
      ORDER BY p.updated_at DESC, m.enabled DESC, m.updated_at DESC`,
  ).all(userId);
}

export async function getModelProvider(id: string, userId: string): Promise<ModelProvider | undefined> {
  return db.prepare<ModelProvider>(
    `SELECT * FROM model_providers WHERE id = ? AND user_id = ?`,
  ).get(id, userId);
}

export async function getProviderModel(id: string, userId: string): Promise<(ProviderModel & { provider_enabled: number; base_url: string; api_key: string; provider_name: string }) | undefined> {
  return db.prepare<ProviderModel & { provider_enabled: number; base_url: string; api_key: string; provider_name: string }>(
    `SELECT m.*, p.enabled AS provider_enabled, p.base_url, p.api_key, p.name AS provider_name
       FROM provider_models m
       JOIN model_providers p ON p.id = m.provider_id
      WHERE m.id = ? AND p.user_id = ?`,
  ).get(id, userId);
}

export async function createModelProvider(input: {
  userId: string;
  name: string;
  slug: string;
  baseUrl: string;
  apiKey: string;
  enabled?: boolean;
}): Promise<ModelProvider> {
  const id = uuidv4();
  const ts = nowIso();
  await db.prepare(
    `INSERT INTO model_providers (id, user_id, name, slug, base_url, api_key, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.userId, input.name.trim(), input.slug.trim().toLowerCase(), input.baseUrl.trim().replace(/\/+$/, ''), input.apiKey.trim(), input.enabled === false ? 0 : 1, ts, ts);
  const provider = await getModelProvider(id, input.userId);
  if (!provider) throw new Error('Provider was not created.');
  return provider;
}

export async function updateModelProvider(input: {
  id: string;
  userId: string;
  name?: string;
  slug?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
}): Promise<ModelProvider> {
  const existing = await getModelProvider(input.id, input.userId);
  if (!existing) throw new Error('Provider not found.');
  const ts = nowIso();
  await db.prepare(
    `UPDATE model_providers
        SET name = ?, slug = ?, base_url = ?, api_key = ?, enabled = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`,
  ).run(
    input.name?.trim() || existing.name,
    input.slug?.trim().toLowerCase() || existing.slug,
    input.baseUrl?.trim().replace(/\/+$/, '') || existing.base_url,
    input.apiKey?.trim() || existing.api_key,
    input.enabled === undefined ? existing.enabled : (input.enabled ? 1 : 0),
    ts,
    input.id,
    input.userId,
  );
  const provider = await getModelProvider(input.id, input.userId);
  if (!provider) throw new Error('Provider was not updated.');
  return provider;
}

export async function createProviderModel(input: {
  userId: string;
  providerId: string;
  name: string;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  autoCompactThreshold?: number;
  enabled?: boolean;
}): Promise<ProviderModel> {
  const provider = await getModelProvider(input.providerId, input.userId);
  if (!provider) throw new Error('Provider not found.');
  const id = uuidv4();
  const ts = nowIso();
  await db.prepare(
    `INSERT INTO provider_models (id, provider_id, name, model_id, temperature, max_tokens, context_window, auto_compact_threshold, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.providerId,
    input.name.trim(),
    input.modelId.trim(),
    input.temperature ?? 0.7,
    input.maxTokens ?? 4000,
    input.contextWindow ?? 128000,
    input.autoCompactThreshold ?? 80,
    input.enabled === false ? 0 : 1,
    ts,
    ts,
  );
  const model = await db.prepare<ProviderModel>(`SELECT * FROM provider_models WHERE id = ?`).get(id);
  if (!model) throw new Error('Provider model was not created.');
  return model;
}

export async function updateProviderModel(input: {
  id: string;
  userId: string;
  name?: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  autoCompactThreshold?: number;
  enabled?: boolean;
}): Promise<ProviderModel> {
  const existing = await getProviderModel(input.id, input.userId);
  if (!existing) throw new Error('Provider model not found.');
  const ts = nowIso();
  await db.prepare(
    `UPDATE provider_models
        SET name = ?, model_id = ?, temperature = ?, max_tokens = ?, context_window = ?, auto_compact_threshold = ?, enabled = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    input.name?.trim() || existing.name,
    input.modelId?.trim() || existing.model_id,
    input.temperature ?? existing.temperature,
    input.maxTokens ?? existing.max_tokens,
    input.contextWindow ?? existing.context_window,
    input.autoCompactThreshold ?? existing.auto_compact_threshold,
    input.enabled === undefined ? existing.enabled : (input.enabled ? 1 : 0),
    ts,
    input.id,
  );
  const model = await db.prepare<ProviderModel>(`SELECT * FROM provider_models WHERE id = ?`).get(input.id);
  if (!model) throw new Error('Provider model was not updated.');
  return model;
}

export async function getSelectedProviderModel(input: {
  userId: string;
  providerId?: string | null;
  providerModelId?: string | null;
}): Promise<(ProviderModel & { provider_enabled: number; base_url: string; api_key: string; provider_name: string }) | undefined> {
  if (!input.providerId || !input.providerModelId) return undefined;
  return db.prepare<ProviderModel & { provider_enabled: number; base_url: string; api_key: string; provider_name: string }>(
    `SELECT m.*, p.enabled AS provider_enabled, p.base_url, p.api_key, p.name AS provider_name
       FROM provider_models m
       JOIN model_providers p ON p.id = m.provider_id
      WHERE m.id = ? AND m.provider_id = ? AND p.user_id = ? AND p.enabled = 1 AND m.enabled = 1`,
  ).get(input.providerModelId, input.providerId, input.userId);
}

/** Mark exactly one (provider, model) as the user's selection; clears the rest. */
export async function setSelectedProviderModel(input: {
  userId: string;
  providerId: string;
  providerModelId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.prepare(`UPDATE provider_models SET selected = 0 WHERE provider_id IN (SELECT id FROM model_providers WHERE user_id = ?)`).run(input.userId);
    await tx.prepare(`UPDATE provider_models SET selected = 1 WHERE id = ? AND provider_id = ?`).run(
      input.providerModelId, input.providerId);
  });
}

export async function deleteProvider(id: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.prepare(`DELETE FROM provider_models WHERE provider_id IN (SELECT id FROM model_providers WHERE id = ? AND user_id = ?)`).run(id, userId);
    await tx.prepare(`DELETE FROM model_providers WHERE id = ? AND user_id = ?`).run(id, userId);
  });
}

export async function deleteProviderModel(id: string, userId: string): Promise<void> {
  await db.prepare(
    `DELETE FROM provider_models
      WHERE id = ? AND provider_id IN (SELECT id FROM model_providers WHERE user_id = ?)`,
  ).run(id, userId);
}