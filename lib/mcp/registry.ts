/**
 * MCP server registry — per-user server configuration plus the connection pool.
 *
 * SERVER CONFIG IS A USER DECISION, NEVER A MODEL DECISION. A stdio server config
 * is `command` + `args` + `env`: that is arbitrary code execution on the user's
 * own machine, by the user, which is inherent to MCP and acceptable — but ONLY as
 * an explicit, user-initiated configuration action from a UI or an authenticated
 * route. Nothing an agent can reach may create, edit, enable, or delete a server.
 *
 * That is enforced structurally, not by convention:
 *  - the mutating functions (createMcpServer / updateMcpServer / deleteMcpServer /
 *    setMcpServerEnabled) are NOT reachable from lib/agent/tools.ts. The only
 *    functions the tool layer imports are listMcpToolsForUser() and callMcpTool(),
 *    both of which are read/execute paths over already-stored config;
 *  - there is deliberately no `mcp_configure`-style tool schema anywhere in this
 *    module. Adding one would be the whole vulnerability.
 *
 * TENANCY: every function takes a userId and every statement filters on
 * `user_id = ?`. There is no "get by id" without the owner, because that is the
 * shape that leaks another user's server (and with it, their env tokens).
 *
 * MODE: MCP tools are WRITE-CAPABLE BY DEFAULT. A remote tool can do anything —
 * send mail, move money, delete a repo — and its description is attacker-supplied,
 * so there is no honest way to classify one as read-only. They are therefore
 * unavailable in chat and planning; see mcpToolsAllowedInMode().
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index';
import type { TaskMode } from '../types';
import {
  MCP_LIMITS,
  McpConnection,
  connectMcpServer,
  namespaceToolName,
  parseMcpToolName,
  sanitizeUntrustedText,
  slugifySegment,
} from './client';
import type {
  McpNamespacedTool,
  McpServerConfig,
  McpServerError,
  McpServerRow,
  McpToolCallResult,
} from './types';

/* ------------------------------------------------------------------ */
/*  Limits                                                             */
/* ------------------------------------------------------------------ */

export const MCP_REGISTRY_LIMITS = {
  /** Configured servers per user. */
  maxServersPerUser: 16,
  /** Simultaneously connected servers per user. Bounds child processes. */
  maxConcurrentConnections: 8,
  /** Namespaced tools exposed to one run, across all of a user's servers. */
  maxTotalTools: 256,
  maxNameChars: 64,
  maxCommandChars: 512,
  maxArgs: 32,
  maxArgChars: 1024,
  maxEnvVars: 32,
  maxEnvValueChars: 4096,
  /** Idle connections are reaped after this long. */
  idleTtlMs: 5 * 60_000,
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  Mode policy                                                        */
/* ------------------------------------------------------------------ */

/**
 * MCP tools are write-capable by default, so they are available in `build` only.
 *
 * The reasoning is worth stating plainly because the alternative is tempting: a
 * server can label a tool "read_file" or "search" and it would look read-only.
 * That label is attacker-controlled text. Trusting it would mean a hostile server
 * gets to opt itself into read-only mode, which is exactly backwards. Chat and
 * planning stay MCP-free.
 */
export function mcpToolsAllowedInMode(mode: TaskMode): boolean {
  return mode === 'build';
}

/* ------------------------------------------------------------------ */
/*  Row <-> config                                                     */
/* ------------------------------------------------------------------ */

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, MCP_REGISTRY_LIMITS.maxArgs);
  } catch {
    // A row we cannot decode is treated as "no args" rather than throwing: one
    // corrupt row must not break listing every other server the user owns.
    return [];
  }
}

function parseJsonRecord(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    let count = 0;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (count >= MCP_REGISTRY_LIMITS.maxEnvVars) break;
      if (typeof value !== 'string') continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      out[key] = value.slice(0, MCP_REGISTRY_LIMITS.maxEnvValueChars);
      count += 1;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Decode rows into configs, assigning each a unique namespace slug.
 *
 * Slugs are resolved ACROSS the user's whole server set, not per row: two servers
 * named "GitHub" and "github" both slugify to `github`, and if they shared a slug
 * the second one's tools would shadow the first's under identical namespaced
 * names. On a clash the loser's slug is derived from its id instead, which is
 * unique by construction. Ordering is stable (created_at, id) so a given server
 * keeps the same slug across calls.
 */
export function rowsToConfigs(rows: McpServerRow[]): McpServerConfig[] {
  const used = new Set<string>();
  const configs: McpServerConfig[] = [];

  for (const row of rows) {
    const label = sanitizeUntrustedText(row.name, MCP_REGISTRY_LIMITS.maxNameChars).text || 'server';
    let slug = slugifySegment(row.name);
    if (!slug || used.has(slug)) {
      slug = slugifySegment(`${row.name}-${row.id}`);
    }
    // Pathological last resort: derive purely from the id.
    let guard = 0;
    while (used.has(slug) && guard < 4) {
      slug = slugifySegment(`${row.id}-${guard}`);
      guard += 1;
    }
    if (used.has(slug)) continue; // give up on this row rather than collide
    used.add(slug);

    configs.push({
      id: row.id,
      userId: row.user_id,
      name: label,
      slug,
      transport: 'stdio',
      command: row.command,
      args: parseJsonArray(row.args),
      env: parseJsonRecord(row.env),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
  return configs;
}

/* ------------------------------------------------------------------ */
/*  CRUD — user-initiated only (see the file header)                   */
/* ------------------------------------------------------------------ */

export async function listMcpServers(userId: string, includeDisabled = true): Promise<McpServerConfig[]> {
  const filter = includeDisabled ? '' : ' AND enabled = 1';
  const rows = await db
    .prepare<McpServerRow>(
      `SELECT * FROM mcp_servers WHERE user_id = ?${filter} ORDER BY created_at ASC, id ASC`,
    )
    .all(userId);
  return rowsToConfigs(rows);
}

/** Owner-scoped by construction: there is no lookup without a userId. */
export async function getMcpServerById(id: string, userId: string): Promise<McpServerConfig | undefined> {
  const row = await db
    .prepare<McpServerRow>(`SELECT * FROM mcp_servers WHERE id = ? AND user_id = ?`)
    .get(id, userId);
  if (!row) return undefined;
  // Slug must be resolved against the full set, or it could differ from the slug
  // this same server gets in listMcpServers() and break name round-tripping.
  const all = await listMcpServers(userId);
  return all.find((config) => config.id === id);
}

export interface McpServerInput {
  userId: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: string;
}

/**
 * Validate a user-submitted config.
 *
 * This is not defense against the user — they are authorizing execution on their
 * own machine and are allowed to. It is defense against a config that would break
 * the client or the namespace: an empty command, an argv full of junk, an env map
 * large enough to blow the exec limit, a non-stdio transport we cannot speak.
 */
function validateInput(input: McpServerInput): { name: string; command: string; args: string[]; env: Record<string, string> } {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('mcp: server name is required');
  if (name.length > MCP_REGISTRY_LIMITS.maxNameChars) {
    throw new Error(`mcp: server name exceeds ${MCP_REGISTRY_LIMITS.maxNameChars} characters`);
  }
  const transport = input.transport ?? 'stdio';
  if (transport !== 'stdio') throw new Error(`mcp: unsupported transport "${transport}" (only stdio)`);

  const command = String(input.command ?? '').trim();
  if (!command) throw new Error('mcp: command is required');
  if (command.length > MCP_REGISTRY_LIMITS.maxCommandChars) {
    throw new Error(`mcp: command exceeds ${MCP_REGISTRY_LIMITS.maxCommandChars} characters`);
  }
  // A newline in argv or command would corrupt any log line that echoes it and
  // is never legitimate in an executable path.
  if (/[\r\n\0]/.test(command)) throw new Error('mcp: command contains control characters');

  const rawArgs = Array.isArray(input.args) ? input.args : [];
  if (rawArgs.length > MCP_REGISTRY_LIMITS.maxArgs) {
    throw new Error(`mcp: too many args (max ${MCP_REGISTRY_LIMITS.maxArgs})`);
  }
  const args = rawArgs.map((arg) => {
    const value = String(arg ?? '');
    if (value.length > MCP_REGISTRY_LIMITS.maxArgChars) throw new Error('mcp: argument too long');
    if (/[\r\n\0]/.test(value)) throw new Error('mcp: argument contains control characters');
    return value;
  });

  const rawEnv = input.env && typeof input.env === 'object' ? input.env : {};
  const envEntries = Object.entries(rawEnv);
  if (envEntries.length > MCP_REGISTRY_LIMITS.maxEnvVars) {
    throw new Error(`mcp: too many env vars (max ${MCP_REGISTRY_LIMITS.maxEnvVars})`);
  }
  const env: Record<string, string> = {};
  for (const [key, value] of envEntries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`mcp: invalid env var name "${key}"`);
    const str = String(value ?? '');
    if (str.length > MCP_REGISTRY_LIMITS.maxEnvValueChars) throw new Error(`mcp: env var ${key} value too long`);
    if (/[\r\n\0]/.test(str)) throw new Error(`mcp: env var ${key} contains control characters`);
    env[key] = str;
  }

  return { name, command, args, env };
}

/**
 * Create a server. CALLERS MUST BE USER-INITIATED (a UI action behind an
 * authenticated route). This function is not imported by the agent tool layer.
 */
export async function createMcpServer(input: McpServerInput): Promise<McpServerConfig> {
  const { name, command, args, env } = validateInput(input);

  const existing = await db
    .prepare<{ count: number }>(`SELECT COUNT(*) AS count FROM mcp_servers WHERE user_id = ?`)
    .get(input.userId);
  if ((existing?.count ?? 0) >= MCP_REGISTRY_LIMITS.maxServersPerUser) {
    throw new Error(`mcp: server limit reached (max ${MCP_REGISTRY_LIMITS.maxServersPerUser})`);
  }

  const id = uuidv4();
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO mcp_servers (id, user_id, name, transport, command, args, env, enabled, created_at, updated_at)
       VALUES (?, ?, ?, 'stdio', ?, ?, ?, 1, ?, ?)`,
    )
    .run(id, input.userId, name, command, JSON.stringify(args), JSON.stringify(env), ts, ts);

  const row = await getMcpServerById(id, input.userId);
  if (!row) throw new Error('createMcpServer: row not found after insert');
  return row;
}

/** Update a server. USER-INITIATED ONLY, same as createMcpServer. */
export async function updateMcpServer(
  id: string,
  userId: string,
  input: Partial<Pick<McpServerInput, 'name' | 'command' | 'args' | 'env'>> & { enabled?: boolean },
): Promise<McpServerConfig | undefined> {
  const existing = await getMcpServerById(id, userId);
  if (!existing) return undefined;

  const merged = validateInput({
    userId,
    name: input.name ?? existing.name,
    command: input.command ?? existing.command,
    args: input.args ?? existing.args,
    env: input.env ?? existing.env,
  });
  const enabled = input.enabled === undefined ? (existing.enabled ? 1 : 0) : input.enabled ? 1 : 0;

  await db
    .prepare(
      `UPDATE mcp_servers
       SET name = ?, command = ?, args = ?, env = ?, enabled = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(merged.name, merged.command, JSON.stringify(merged.args), JSON.stringify(merged.env), enabled, nowIso(), id, userId);

  // Config changed: any live connection is now stale.
  await disconnectMcpServer(id);
  return getMcpServerById(id, userId);
}

/** Enable/disable without touching the command. USER-INITIATED ONLY. */
export async function setMcpServerEnabled(id: string, userId: string, enabled: boolean): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(enabled ? 1 : 0, nowIso(), id, userId);
  if (result.changes > 0 && !enabled) await disconnectMcpServer(id);
  return result.changes > 0;
}

/** Delete a server and drop its connection. USER-INITIATED ONLY. */
export async function deleteMcpServer(id: string, userId: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM mcp_servers WHERE id = ? AND user_id = ?`).run(id, userId);
  if (result.changes > 0) await disconnectMcpServer(id);
  return result.changes > 0;
}

/* ------------------------------------------------------------------ */
/*  Connection pool                                                    */
/*                                                                     */
/*  Keyed by server id. Each entry owns one child process, so the pool  */
/*  size IS the process count — hence the hard cap. Module-level state   */
/*  matches how lib/agent/preview.ts holds its preview processes.        */
/* ------------------------------------------------------------------ */

interface PoolEntry {
  connection: McpConnection;
  userId: string;
  lastUsedAt: number;
}

const pool = new Map<string, PoolEntry>();
/** In-flight connects, so two concurrent calls cannot spawn two processes. */
const connecting = new Map<string, Promise<McpConnection>>();

function reapIdle(): void {
  const cutoff = Date.now() - MCP_REGISTRY_LIMITS.idleTtlMs;
  for (const [id, entry] of pool) {
    if (entry.connection.isClosed || entry.lastUsedAt < cutoff) {
      pool.delete(id);
      void entry.connection.close();
    }
  }
}

/**
 * Get or create the connection for one server.
 *
 * Concurrency: a second caller arriving mid-handshake awaits the SAME promise
 * rather than spawning a second child. Without this, a run that calls two tools
 * on one server in the same tick gets two processes and leaks one.
 */
export async function getMcpConnection(config: McpServerConfig): Promise<McpConnection> {
  reapIdle();

  const live = pool.get(config.id);
  if (live && !live.connection.isClosed) {
    live.lastUsedAt = Date.now();
    return live.connection;
  }
  if (live) pool.delete(config.id);

  const inFlight = connecting.get(config.id);
  if (inFlight) return inFlight;

  if (pool.size >= MCP_REGISTRY_LIMITS.maxConcurrentConnections) {
    throw new Error(`mcp: too many connected servers (max ${MCP_REGISTRY_LIMITS.maxConcurrentConnections})`);
  }

  const attempt = (async () => {
    const connection = await connectMcpServer({
      command: config.command,
      args: config.args,
      env: config.env,
    });
    pool.set(config.id, { connection, userId: config.userId, lastUsedAt: Date.now() });
    return connection;
  })();

  connecting.set(config.id, attempt);
  try {
    return await attempt;
  } finally {
    connecting.delete(config.id);
  }
}

/** Drop one server's connection, killing its process. */
export async function disconnectMcpServer(serverId: string): Promise<void> {
  const entry = pool.get(serverId);
  pool.delete(serverId);
  if (entry) await entry.connection.close();
}

/** Drop every connection. Called on shutdown and by tests in afterEach. */
export async function disconnectAllMcpServers(): Promise<void> {
  const entries = [...pool.values()];
  pool.clear();
  connecting.clear();
  await Promise.all(entries.map((entry) => entry.connection.close()));
}


/* ------------------------------------------------------------------ */
/*  The agent-facing surface                                           */
/*                                                                     */
/*  These two functions are the ONLY things lib/agent/tools.ts imports.  */
/*  Both are read/execute over stored config; neither can create it.     */
/* ------------------------------------------------------------------ */

export interface McpToolListing {
  tools: McpNamespacedTool[];
  /** Servers that failed. Surfaced, not swallowed — a silent MCP is a lie. */
  errors: McpServerError[];
}

/**
 * Namespaced tool descriptors for every enabled server this user owns.
 *
 * One failing server does not take down the others: its error is collected and
 * the rest still list. Total tools are capped so a server advertising thousands
 * cannot blow up the request the schemas are compiled into.
 */
export async function listMcpToolsForUser(userId: string): Promise<McpToolListing> {
  const configs = await listMcpServers(userId, false);
  const tools: McpNamespacedTool[] = [];
  const errors: McpServerError[] = [];

  for (const config of configs) {
    if (tools.length >= MCP_REGISTRY_LIMITS.maxTotalTools) break;
    try {
      const connection = await getMcpConnection(config);
      const descriptors = await connection.listTools();
      const label = connection.info?.name || config.name;

      const usedSlugs = new Set<string>();
      for (const descriptor of descriptors) {
        if (tools.length >= MCP_REGISTRY_LIMITS.maxTotalTools) break;
        // Two raw names folding to one slug within a server would produce
        // duplicate namespaced names; the second is dropped rather than shadowing.
        if (usedSlugs.has(descriptor.slug)) continue;
        usedSlugs.add(descriptor.slug);
        tools.push({
          ...descriptor,
          name: namespaceToolName(config.slug, descriptor.slug),
          serverId: config.id,
          serverSlug: config.slug,
          serverLabel: label,
        });
      }
    } catch (err) {
      errors.push({
        serverId: config.id,
        serverLabel: config.name,
        message: sanitizeUntrustedText(err instanceof Error ? err.message : String(err), 300).text,
      });
    }
  }

  return { tools, errors };
}

/**
 * Execute one namespaced MCP tool for one user.
 *
 * Deliberately takes NO mode parameter and performs NO mode check: mode
 * enforcement belongs at the single dispatch chokepoint in lib/agent/tools.ts,
 * alongside the identical check for file_write and code_execute. Duplicating it
 * here would create a second policy that can drift from the first, and the whole
 * point of routing MCP through executeTool is that there is exactly one gate.
 *
 * Resolution is by SLUG, not by id, and the slug set is rebuilt from this user's
 * rows — so a namespaced name from another user's server simply does not resolve.
 */
export async function callMcpTool(
  userId: string,
  namespacedName: string,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const parsed = parseMcpToolName(namespacedName);
  if (!parsed) throw new Error(`mcp: malformed tool name "${String(namespacedName).slice(0, 64)}"`);

  const configs = await listMcpServers(userId, false);
  const config = configs.find((entry) => entry.slug === parsed.server);
  if (!config) throw new Error(`mcp: no enabled server named "${parsed.server}"`);

  const connection = await getMcpConnection(config);
  const descriptors = await connection.listTools();
  const descriptor = descriptors.find((entry) => entry.slug === parsed.tool);
  if (!descriptor) throw new Error(`mcp: server "${parsed.server}" does not expose tool "${parsed.tool}"`);

  const entry = pool.get(config.id);
  if (entry) entry.lastUsedAt = Date.now();

  const label = connection.info?.name || config.name;
  return connection.callTool(descriptor.rawName, args ?? {}, label);
}

/** Re-exported so callers need one import for the whole MCP surface. */
export { MCP_LIMITS };
