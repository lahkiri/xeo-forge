/**
 * Schema — the only place table DDL lives.
 *
 * The 8 canonical tables (see AGENTS.md §4). DDL is emitted per-dialect so
 * the same logical schema works on SQLite (dev) and PostgreSQL (prod).
 *
 * `initSchema()` is idempotent (CREATE TABLE IF NOT EXISTS) and is called by
 * `scripts/db-init.ts`. It does NOT seed data — seeding lives in db-init.
 */

import { db } from './index';

function ddl(kind: 'sqlite' | 'pg'): string[] {
  const pk = kind === 'pg' ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const ts = kind === 'pg' ? 'TIMESTAMPTZ' : 'TEXT';
  const nowDefault = kind === 'pg' ? 'DEFAULT now()' : '';
  // Booleans are stored as INTEGER (0/1) in both dialects. This keeps the
  // single canonical row shape numeric everywhere (see lib/types.ts) and avoids
  // PG's refusal to coerce integer bind params into BOOLEAN columns.
  const bool = 'INTEGER';
  const falseDefault = 'DEFAULT 0';

  const statements: string[] = [];

  if (kind === 'pg') {
    statements.push(`CREATE SCHEMA IF NOT EXISTS xeo`);
  }

  statements.push(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_admin ${bool} NOT NULL ${falseDefault},
      is_root_admin ${bool} NOT NULL ${falseDefault},
      is_suspended ${bool} NOT NULL ${falseDefault},
      created_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  statements.push(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at ${ts} NOT NULL
    )
  `);

  statements.push(`
    CREATE TABLE IF NOT EXISTS credits (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      daily_grant INTEGER NOT NULL DEFAULT 50,
      last_reset_at ${ts},
      updated_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  statements.push(`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id ${pk},
      user_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_id TEXT,
      balance_after INTEGER NOT NULL,
      created_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  statements.push(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      mode TEXT NOT NULL DEFAULT 'build',
      project_path TEXT,
      intent_kind TEXT,
      decision_state TEXT,
      decision_expires_at ${ts},
      plan TEXT,
      approved_plan TEXT,
      plan_version INTEGER NOT NULL DEFAULT 0,
      profile_id TEXT,
      skill_id TEXT,
      provider_id TEXT,
      provider_model_id TEXT,
      autonomy_level TEXT NOT NULL DEFAULT 'execute',
      result_summary TEXT,
      credits_spent INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at ${ts} NOT NULL ${nowDefault},
      updated_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  statements.push(`
    CREATE TABLE IF NOT EXISTS task_events (
      id ${pk},
      task_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at ${ts} NOT NULL ${nowDefault},
      UNIQUE(task_id, seq)
    )
  `);

  statements.push(`
    CREATE TABLE IF NOT EXISTS model_settings (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model_id TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0.7,
      max_tokens INTEGER NOT NULL DEFAULT 4000,
      context_window INTEGER NOT NULL DEFAULT 128000,
      auto_compact_threshold INTEGER NOT NULL DEFAULT 80,
      updated_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  // messages.active: 1 = part of the live context window, 0 = archived after
  // compaction (kept for audit/UI, excluded from the agent's LLM context).
  statements.push(`
    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at ${ts} NOT NULL ${nowDefault},
      updated_at ${ts} NOT NULL ${nowDefault},
      UNIQUE(user_id, slug)
    )
  `);

  statements.push(`
    CREATE TABLE IF NOT EXISTS provider_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      model_id TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0.7,
      max_tokens INTEGER NOT NULL DEFAULT 4000,
      context_window INTEGER NOT NULL DEFAULT 128000,
      auto_compact_threshold INTEGER NOT NULL DEFAULT 80,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at ${ts} NOT NULL ${nowDefault},
      updated_at ${ts} NOT NULL ${nowDefault},
      UNIQUE(provider_id, model_id)
    )
  `);

  statements.push(`
    CREATE TABLE IF NOT EXISTS messages (
      id ${pk},
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  statements.push(`
    CREATE TABLE IF NOT EXISTS admin_actions (
      id ${pk},
      admin_id TEXT NOT NULL,
      target_user_id TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  // User-editable instruction layers. These are configuration, not platform
  // policy: the runtime compiler places them below immutable safety rules.
  statements.push(`
    CREATE TABLE IF NOT EXISTS agent_instructions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_id TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      enabled INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      created_at ${ts} NOT NULL ${nowDefault},
      updated_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  // Reusable user-owned operating profiles. Profiles shape task behavior but
  // remain below immutable platform policy and tool permissions.
  statements.push(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'custom',
      description TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      created_at ${ts} NOT NULL ${nowDefault},
      updated_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  // Reusable workflow templates. Skills define intent and operating guidance;
  // they do not grant permissions or bypass approval gates.
  statements.push(`
    CREATE TABLE IF NOT EXISTS agent_skills (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'custom',
      description TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL,
      profile_id TEXT,
      source_type TEXT NOT NULL DEFAULT 'local',
      source_id TEXT,
      source_url TEXT,
      source_path TEXT,
      source_ref TEXT,
      source_hash TEXT,
      files_json TEXT NOT NULL DEFAULT '[]',
      imported_at ${ts},
      enabled INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      created_at ${ts} NOT NULL ${nowDefault},
      updated_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  // Persistent learning. Proposed memories are stored but are not loaded into
  // the agent context until the user activates or pins them.
  statements.push(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_id TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
      kind TEXT NOT NULL DEFAULT 'lesson',
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      confidence REAL NOT NULL DEFAULT 0.5,
      source_task_id TEXT,
      source_message_id TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      expires_at ${ts},
      created_at ${ts} NOT NULL ${nowDefault},
      updated_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  // Uploads ingested for a task. Files live under the task workspace
  // (_uploads/<id>) — the same realpath-confined workspace the agent file tools
  // use. Uploaded content is untrusted DATA; status gates agent exposure.
  statements.push(`
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'quarantined',
      byte_size INTEGER NOT NULL DEFAULT 0,
      rel_path TEXT NOT NULL,
      file_count INTEGER NOT NULL DEFAULT 0,
      extracted_bytes INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at ${ts} NOT NULL ${nowDefault},
      updated_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  // MCP server configuration, per user.
  //
  // A stdio MCP server config is `command` + `args` + `env` — that is arbitrary
  // code execution on the user's own machine. It is therefore USER-OWNED and
  // USER-INITIATED ONLY: nothing the agent can reach writes this table (see the
  // header of lib/mcp/registry.ts). `args` and `env` are JSON TEXT, matching how
  // the rest of the schema stores structured columns; `enabled` is 0/1 like every
  // other boolean here. `env` may hold third-party tokens the user pasted, so it
  // is owner-scoped on every read — there is no lookup without a user_id.
  statements.push(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'stdio',
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]',
      env TEXT NOT NULL DEFAULT '{}',
      enabled ${bool} NOT NULL DEFAULT 1,
      created_at ${ts} NOT NULL ${nowDefault},
      updated_at ${ts} NOT NULL ${nowDefault}
    )
  `);

  // Indexes for the hot lookups.
  statements.push(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_mcp_servers_user ON mcp_servers(user_id, enabled, created_at)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_profiles_user ON agent_profiles(user_id, enabled, updated_at)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_skills_user ON agent_skills(user_id, enabled, updated_at)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id, seq)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id, id)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(user_id)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth_sessions(user_id)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_uploads_task ON uploads(task_id, created_at)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_agent_instructions_user ON agent_instructions(user_id, scope, enabled, priority)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_agent_instructions_task ON agent_instructions(task_id, enabled, priority)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_agent_memories_user ON agent_memories(user_id, scope, status, updated_at)`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_agent_memories_task ON agent_memories(task_id, status, updated_at)`);

  return statements;
}

/**
 * The dual-mode columns added to `tasks` after the table's original shape.
 * Applied as ALTERs so databases created before the feature pick them up.
 * (The CREATE TABLE above already includes them for fresh databases.)
 */
const TASK_MODE_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'mode', ddl: `ADD COLUMN mode TEXT NOT NULL DEFAULT 'build'` },
  { name: 'project_path', ddl: `ADD COLUMN project_path TEXT` },
  { name: 'intent_kind', ddl: `ADD COLUMN intent_kind TEXT` },
  { name: 'decision_state', ddl: `ADD COLUMN decision_state TEXT` },
  { name: 'decision_expires_at', ddl: `ADD COLUMN decision_expires_at TEXT` },
  { name: 'approved_plan', ddl: `ADD COLUMN approved_plan TEXT` },
  { name: 'plan_version', ddl: `ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 0` },
  { name: 'profile_id', ddl: `ADD COLUMN profile_id TEXT` },
  { name: 'skill_id', ddl: `ADD COLUMN skill_id TEXT` },
  { name: 'provider_id', ddl: `ADD COLUMN provider_id TEXT` },
  { name: 'provider_model_id', ddl: `ADD COLUMN provider_model_id TEXT` },
  {
    name: 'autonomy_level',
    ddl: `ADD COLUMN autonomy_level TEXT NOT NULL DEFAULT 'execute'`,
  },
];

const SKILL_HUB_COLUMNS: Array<{ table: string; name: string; ddl: string }> = [
  { table: 'agent_skills', name: 'source_type', ddl: `ADD COLUMN source_type TEXT NOT NULL DEFAULT 'local'` },
  { table: 'agent_skills', name: 'source_id', ddl: `ADD COLUMN source_id TEXT` },
  { table: 'agent_skills', name: 'source_url', ddl: `ADD COLUMN source_url TEXT` },
  { table: 'agent_skills', name: 'source_path', ddl: `ADD COLUMN source_path TEXT` },
  { table: 'agent_skills', name: 'source_ref', ddl: `ADD COLUMN source_ref TEXT` },
  { table: 'agent_skills', name: 'source_hash', ddl: `ADD COLUMN source_hash TEXT` },
  { table: 'agent_skills', name: 'files_json', ddl: `ADD COLUMN files_json TEXT NOT NULL DEFAULT '[]'` },
  { table: 'agent_skills', name: 'imported_at', ddl: `ADD COLUMN imported_at TEXT` },
];

/**
 * Context-management columns added after the original table shapes.
 * - model_settings: the admin-configurable context window + auto-compact
 *   threshold (single global config row, no new config subsystem).
 * - messages: `active` flag distinguishing live-context rows from archived
 *   rows that compaction has summarized away.
 * Applied as ALTERs so databases created before the feature pick them up.
 */
const CONTEXT_COLUMNS: Array<{ table: string; name: string; ddl: string }> = [
  {
    table: 'model_settings',
    name: 'context_window',
    ddl: `ADD COLUMN context_window INTEGER NOT NULL DEFAULT 128000`,
  },
  {
    table: 'model_settings',
    name: 'auto_compact_threshold',
    ddl: `ADD COLUMN auto_compact_threshold INTEGER NOT NULL DEFAULT 80`,
  },
  {
    table: 'messages',
    name: 'active',
    ddl: `ADD COLUMN active INTEGER NOT NULL DEFAULT 1`,
  },
];

/** Existing column names for a table, per-dialect. */
async function columnsOf(table: string): Promise<Set<string>> {
  if (db.kind === 'pg') {
    const rows = await db
      .prepare<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = ? AND table_schema = ANY (current_schemas(false))`,
      )
      .all(table);
    return new Set(rows.map((r) => r.column_name));
  }
  const rows = await db.prepare<{ name: string }>(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map((r) => r.name));
}

/**
 * Add columns to existing tables, idempotently and per-dialect. SQLite does NOT
 * support `ADD COLUMN IF NOT EXISTS`, so we inspect existing columns first.
 * These are real, present migrations (not future scaffolding) — the live
 * database predates these columns.
 */
async function migrateColumns(): Promise<void> {
  // Dual-mode columns on tasks.
  const taskCols = await columnsOf('tasks');
  for (const col of TASK_MODE_COLUMNS) {
    if (taskCols.has(col.name)) continue;
    await db.exec(`ALTER TABLE tasks ${col.ddl}`);
  }

  // Context-management columns, grouped by table so we inspect each once.
  const seen = new Map<string, Set<string>>();
  for (const col of CONTEXT_COLUMNS) {
    let existing = seen.get(col.table);
    if (!existing) {
      existing = await columnsOf(col.table);
      seen.set(col.table, existing);
    }
    if (existing.has(col.name)) continue;
    await db.exec(`ALTER TABLE ${col.table} ${col.ddl}`);
    existing.add(col.name);
  }

  // Selected model marker (one per user) — persists the picker choice across
  // restarts. v1.19.2: without it the catalog recomputed 'active' as the first
  // enabled row, which read to users like their model configuration was lost.
  const pmCols = await columnsOf('provider_models');
  if (!pmCols.has('selected')) {
    await db.exec(`ALTER TABLE provider_models ADD COLUMN selected INTEGER NOT NULL DEFAULT 0`);
    // Backfill: honor the model configured before this column existed, so an
    // upgrade does not visually reset the pick to the first enabled row.
    await db.exec(`UPDATE provider_models SET selected = 1
      WHERE model_id = (SELECT model_id FROM model_settings WHERE id = 1)
        AND EXISTS (SELECT 1 FROM model_settings WHERE id = 1);`);
  }
  // Reasoning-effort control (user-facing toggle + levels). NULL/'default' =
  // do not send the parameter; the provider uses its own default.
  const msCols = await columnsOf('model_settings');
  if (!msCols.has('reasoning_effort')) {
    await db.exec(`ALTER TABLE model_settings ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'default'`);
  }
  // Skill Hub source metadata on the existing user-owned skill table.
  const skillCols = await columnsOf('agent_skills');
  for (const col of SKILL_HUB_COLUMNS) {
    if (skillCols.has(col.name)) continue;
    await db.exec(`ALTER TABLE ${col.table} ${col.ddl}`);
    skillCols.add(col.name);
  }
}

async function removeAutoSeededProviders(): Promise<void> {
  // Older builds materialized legacy model_settings/ENV as a fake provider.
  // Remove only that exact generated identity; explicitly named user providers
  // remain untouched, and resolveModel() still supports legacy fallback.
  await db.exec(`DELETE FROM provider_models WHERE provider_id IN (SELECT id FROM model_providers WHERE slug = 'default' AND name = 'Default provider')`);
  await db.exec(`DELETE FROM model_providers WHERE slug = 'default' AND name = 'Default provider'`);
}

export async function initSchema(): Promise<void> {
  const statements = ddl(db.kind);
  for (const sql of statements) {
    await db.exec(sql);
  }
  await migrateColumns();
  await removeAutoSeededProviders();
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_model_providers_user ON model_providers(user_id, enabled, updated_at)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id, enabled, updated_at)`);
}
