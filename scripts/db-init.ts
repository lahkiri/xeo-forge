/**
 * DB init + seed.
 *
 * - Creates the schema (idempotent).
 * - Seeds the root admin user from ROOT_ADMIN_EMAIL / ROOT_ADMIN_PASSWORD.
 * - Seeds the single global model_settings row (id=1) from MODEL_* env vars,
 *   but only if one does not already exist (DB row is the source of truth).
 *
 * Safe to run repeatedly.
 */
import './load-env';

import { initSchema } from '../lib/db/schema';
import { getUserByEmail, createUser, getModelSettings, upsertModelSettings } from '../lib/db/queries';
import { ensureUserCredits } from '../lib/credits/engine';
import { hashPassword } from '../lib/auth/password';
import { modelFromEnv } from '../lib/model/config';
import { db } from '../lib/db/index';

async function seedRootAdmin(): Promise<void> {
  const email = process.env.ROOT_ADMIN_EMAIL;
  const password = process.env.ROOT_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('[db-init] ROOT_ADMIN_EMAIL/PASSWORD not set — skipping root admin seed.');
    return;
  }
  const existing = await getUserByEmail(email);
  if (existing) {
    console.log(`[db-init] root admin already exists: ${email}`);
    return;
  }
  const passwordHash = await hashPassword(password);
  const user = await createUser({
    email,
    passwordHash,
    displayName: 'Root Admin',
    isAdmin: true,
    isRootAdmin: true,
  });
  await ensureUserCredits(user.id);
  console.log(`[db-init] seeded root admin: ${email}`);
}

async function seedModel(): Promise<void> {
  const existing = await getModelSettings();
  if (existing) {
    console.log('[db-init] model_settings row already present — leaving as-is.');
    return;
  }
  const env = modelFromEnv();
  if (!env) {
    console.log('[db-init] MODEL_* env not fully set — skipping model seed (configure via admin later).');
    return;
  }
  await upsertModelSettings({
    name: env.name,
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    modelId: env.modelId,
    temperature: env.temperature,
    maxTokens: env.maxTokens,
    contextWindow: env.contextWindow,
    autoCompactThreshold: env.autoCompactThreshold,
  });
  console.log(`[db-init] seeded model_settings from env: ${env.name} (${env.modelId})`);
}

async function main(): Promise<void> {
  await initSchema();
  console.log('[db-init] schema ready.');
  await seedRootAdmin();
  await seedModel();
  await db.close();
  console.log('[db-init] done.');
}

main().catch((err) => {
  console.error('[db-init] failed:', err);
  process.exit(1);
});
