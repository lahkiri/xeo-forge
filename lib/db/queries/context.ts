/**
 * context domain queries (moved verbatim from queries.ts).
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../index';
import { nowIso, normalizeMemoryContent } from './shared';
import type {
  AgentInstruction,
  AgentInstructionScope,
  AgentMemory,
  AgentMemoryKind,
  AgentMemoryScope,
  AgentMemoryStatus,
} from '../../types';

/* ------------------------------------------------------------------ */
/* Agent instructions and persistent memory                           */
/* ------------------------------------------------------------------ */

export async function listAgentInstructions(input: {
  userId: string;
  taskId?: string | null;
  includeDisabled?: boolean;
}): Promise<AgentInstruction[]> {
  const includeDisabled = input.includeDisabled ? '' : ' AND enabled = 1';
  if (input.taskId) {
    return db
      .prepare<AgentInstruction>(
        `SELECT * FROM agent_instructions
         WHERE user_id = ? AND (scope = 'global' OR (scope = 'task' AND task_id = ?))${includeDisabled}
         ORDER BY CASE WHEN scope = 'global' THEN 0 ELSE 1 END, priority ASC, updated_at ASC`,
      )
      .all(input.userId, input.taskId);
  }
  return db
    .prepare<AgentInstruction>(
      `SELECT * FROM agent_instructions
       WHERE user_id = ? AND scope = 'global'${includeDisabled}
       ORDER BY priority ASC, updated_at ASC`,
    )
    .all(input.userId);
}

export async function createAgentInstruction(input: {
  userId: string;
  taskId?: string | null;
  scope: AgentInstructionScope;
  name: string;
  content: string;
  priority?: number;
}): Promise<AgentInstruction> {
  const id = uuidv4();
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO agent_instructions
       (id, user_id, task_id, scope, name, content, priority, enabled, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    )
    .run(
      id,
      input.userId,
      input.taskId ?? null,
      input.scope,
      input.name.trim(),
      input.content.trim(),
      Math.max(0, Math.min(1000, Math.round(input.priority ?? 100))),
      ts,
      ts,
    );
  const row = await db.prepare<AgentInstruction>(`SELECT * FROM agent_instructions WHERE id = ?`).get(id);
  if (!row) throw new Error('createAgentInstruction: row not found after insert');
  return row;
}

export async function updateAgentInstruction(
  id: string,
  userId: string,
  input: Partial<Pick<AgentInstruction, 'name' | 'content' | 'priority' | 'enabled'>>,
): Promise<AgentInstruction | undefined> {
  const existing = await db
    .prepare<AgentInstruction>(`SELECT * FROM agent_instructions WHERE id = ? AND user_id = ?`)
    .get(id, userId);
  if (!existing) return undefined;
  const ts = nowIso();
  await db
    .prepare(
      `UPDATE agent_instructions
       SET name = ?, content = ?, priority = ?, enabled = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      input.name?.trim() || existing.name,
      input.content?.trim() || existing.content,
      input.priority == null ? existing.priority : Math.max(0, Math.min(1000, Math.round(input.priority))),
      input.enabled == null ? existing.enabled : input.enabled ? 1 : 0,
      ts,
      id,
      userId,
    );
  return db.prepare<AgentInstruction>(`SELECT * FROM agent_instructions WHERE id = ?`).get(id);
}

export async function deleteAgentInstruction(id: string, userId: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM agent_instructions WHERE id = ? AND user_id = ?`).run(id, userId);
  return res.changes > 0;
}

export async function listAgentMemories(input: {
  userId: string;
  taskId?: string | null;
  includeArchived?: boolean;
}): Promise<AgentMemory[]> {
  const statusFilter = input.includeArchived ? '' : " AND status <> 'archived'";
  if (input.taskId) {
    return db
      .prepare<AgentMemory>(
        `SELECT * FROM agent_memories
         WHERE user_id = ? AND (scope = 'global' OR (scope = 'task' AND task_id = ?))${statusFilter}
         ORDER BY CASE WHEN status = 'proposed' THEN 1 ELSE 0 END, pinned DESC, updated_at DESC`,
      )
      .all(input.userId, input.taskId);
  }
  return db
    .prepare<AgentMemory>(
      `SELECT * FROM agent_memories
       WHERE user_id = ? AND scope = 'global'${statusFilter}
       ORDER BY CASE WHEN status = 'proposed' THEN 1 ELSE 0 END, pinned DESC, updated_at DESC`,
    )
    .all(input.userId);
}

export async function getActiveAgentMemories(input: {
  userId: string;
  taskId?: string | null;
  limit?: number;
}): Promise<AgentMemory[]> {
  const limit = Math.max(1, Math.min(100, Math.round(input.limit ?? 40)));
  const now = nowIso();
  if (input.taskId) {
    return db
      .prepare<AgentMemory>(
        `SELECT * FROM agent_memories
         WHERE user_id = ? AND status = 'active'
           AND (expires_at IS NULL OR expires_at > ?)
           AND (scope = 'global' OR (scope = 'task' AND task_id = ?))
         ORDER BY pinned DESC, confidence DESC, updated_at DESC LIMIT ?`,
      )
      .all(input.userId, now, input.taskId, limit);
  }
  return db
    .prepare<AgentMemory>(
      `SELECT * FROM agent_memories
       WHERE user_id = ? AND status = 'active'
         AND (expires_at IS NULL OR expires_at > ?)
         AND scope = 'global'
       ORDER BY pinned DESC, confidence DESC, updated_at DESC LIMIT ?`,
    )
    .all(input.userId, now, limit);
}

export async function createAgentMemory(input: {
  userId: string;
  taskId?: string | null;
  scope: AgentMemoryScope;
  kind: AgentMemoryKind;
  content: string;
  status?: AgentMemoryStatus;
  confidence?: number;
  sourceTaskId?: string | null;
  sourceMessageId?: string | null;
  pinned?: boolean;
  expiresAt?: string | null;
}): Promise<AgentMemory> {
  const content = input.content.trim().replace(/\s+/g, ' ');
  if (!content) throw new Error('Memory content cannot be empty');
  const normalized = normalizeMemoryContent(content);
  const existing = await db
    .prepare<AgentMemory>(
      `SELECT * FROM agent_memories
       WHERE user_id = ? AND scope = ?
         AND ((task_id = ?) OR (task_id IS NULL AND ? IS NULL))
         AND lower(trim(content)) = ?
       LIMIT 1`,
    )
    .get(input.userId, input.scope, input.taskId ?? null, input.taskId ?? null, normalized);
  if (existing) {
    await db
      .prepare(
        `UPDATE agent_memories
         SET confidence = CASE WHEN confidence > ? THEN confidence ELSE ? END,
             pinned = CASE WHEN pinned > ? THEN pinned ELSE ? END,
             status = CASE WHEN ? = 1 THEN 'active' ELSE status END, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        Math.max(0, Math.min(1, input.confidence ?? 0.5)),
        Math.max(0, Math.min(1, input.confidence ?? 0.5)),
        input.pinned ? 1 : 0,
        input.pinned ? 1 : 0,
        input.pinned ? 1 : 0,
        nowIso(),
        existing.id,
        input.userId,
      );
    const refreshed = await db.prepare<AgentMemory>(`SELECT * FROM agent_memories WHERE id = ?`).get(existing.id);
    if (!refreshed) throw new Error('createAgentMemory: duplicate row disappeared');
    return refreshed;
  }

  const id = uuidv4();
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO agent_memories
       (id, user_id, task_id, scope, kind, content, status, confidence, source_task_id, source_message_id, pinned, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.userId,
      input.taskId ?? null,
      input.scope,
      input.kind,
      content,
      input.status ?? 'proposed',
      Math.max(0, Math.min(1, input.confidence ?? 0.5)),
      input.sourceTaskId ?? null,
      input.sourceMessageId ?? null,
      input.pinned ? 1 : 0,
      input.expiresAt ?? null,
      ts,
      ts,
    );
  const row = await db.prepare<AgentMemory>(`SELECT * FROM agent_memories WHERE id = ?`).get(id);
  if (!row) throw new Error('createAgentMemory: row not found after insert');
  return row;
}

export async function updateAgentMemory(
  id: string,
  userId: string,
  input: Partial<Pick<AgentMemory, 'content' | 'kind' | 'status' | 'confidence' | 'pinned' | 'expires_at'>>,
): Promise<AgentMemory | undefined> {
  const existing = await db
    .prepare<AgentMemory>(`SELECT * FROM agent_memories WHERE id = ? AND user_id = ?`)
    .get(id, userId);
  if (!existing) return undefined;
  const ts = nowIso();
  await db
    .prepare(
      `UPDATE agent_memories
       SET content = ?, kind = ?, status = ?, confidence = ?, pinned = ?, expires_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      input.content?.trim().replace(/\s+/g, ' ') || existing.content,
      input.kind ?? existing.kind,
      input.status ?? existing.status,
      input.confidence == null ? existing.confidence : Math.max(0, Math.min(1, input.confidence)),
      input.pinned == null ? existing.pinned : input.pinned ? 1 : 0,
      input.expires_at === undefined ? existing.expires_at : input.expires_at,
      ts,
      id,
      userId,
    );
  return db.prepare<AgentMemory>(`SELECT * FROM agent_memories WHERE id = ?`).get(id);
}

export async function deleteAgentMemory(id: string, userId: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM agent_memories WHERE id = ? AND user_id = ?`).run(id, userId);
  return res.changes > 0;
}
