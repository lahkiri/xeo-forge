/**
 * profiles domain queries (moved verbatim from queries.ts).
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../index';
import { nowIso } from './shared';
import type {
  AgentProfile,
  AgentProfileKind,
  AgentSkill,
  AgentSkillKind,
} from '../../types';

/* ------------------------------------------------------------------ */
/* Agent profiles                                                     */
/* ------------------------------------------------------------------ */

export async function listAgentProfiles(userId: string, includeDisabled = false): Promise<AgentProfile[]> {
  const enabledFilter = includeDisabled ? '' : ' AND enabled = 1';
  return db
    .prepare<AgentProfile>(
      `SELECT * FROM agent_profiles WHERE user_id = ?${enabledFilter} ORDER BY enabled DESC, updated_at DESC`,
    )
    .all(userId);
}

export async function getAgentProfileById(id: string, userId: string): Promise<AgentProfile | undefined> {
  return db.prepare<AgentProfile>(`SELECT * FROM agent_profiles WHERE id = ? AND user_id = ?`).get(id, userId);
}

export async function createAgentProfile(input: {
  userId: string;
  name: string;
  kind: AgentProfileKind;
  description?: string;
  instructions: string;
}): Promise<AgentProfile> {
  const id = uuidv4();
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO agent_profiles (id, user_id, name, kind, description, instructions, enabled, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    )
    .run(id, input.userId, input.name.trim(), input.kind, (input.description ?? '').trim(), input.instructions.trim(), ts, ts);
  const row = await getAgentProfileById(id, input.userId);
  if (!row) throw new Error('createAgentProfile: row not found after insert');
  return row;
}

export async function updateAgentProfile(
  id: string,
  userId: string,
  input: Partial<Pick<AgentProfile, 'name' | 'kind' | 'description' | 'instructions' | 'enabled'>>,
): Promise<AgentProfile | undefined> {
  const existing = await getAgentProfileById(id, userId);
  if (!existing) return undefined;
  await db
    .prepare(
      `UPDATE agent_profiles
       SET name = ?, kind = ?, description = ?, instructions = ?, enabled = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      input.name?.trim() || existing.name,
      input.kind || existing.kind,
      input.description === undefined ? existing.description : input.description.trim(),
      input.instructions?.trim() || existing.instructions,
      input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
      nowIso(),
      id,
      userId,
    );
  return getAgentProfileById(id, userId);
}

export async function deleteAgentProfile(id: string, userId: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM agent_profiles WHERE id = ? AND user_id = ?`).run(id, userId);
  return result.changes > 0;
}


/* ------------------------------------------------------------------ */
/* Agent skills                                                       */
/* ------------------------------------------------------------------ */

export async function listAgentSkills(userId: string, includeDisabled = false): Promise<AgentSkill[]> {
  const enabledFilter = includeDisabled ? '' : ' AND enabled = 1';
  return db
    .prepare<AgentSkill>(
      `SELECT * FROM agent_skills WHERE user_id = ?${enabledFilter} ORDER BY enabled DESC, updated_at DESC`,
    )
    .all(userId);
}

export async function getAgentSkillById(id: string, userId: string): Promise<AgentSkill | undefined> {
  return db.prepare<AgentSkill>(`SELECT * FROM agent_skills WHERE id = ? AND user_id = ?`).get(id, userId);
}

export async function createAgentSkill(input: {
  userId: string;
  name: string;
  kind: AgentSkillKind;
  description?: string;
  instructions: string;
  profileId?: string | null;
  sourceType?: AgentSkill['source_type'];
  sourceId?: string | null;
  sourceUrl?: string | null;
  sourcePath?: string | null;
  sourceRef?: string | null;
  sourceHash?: string | null;
  filesJson?: string;
  importedAt?: string | null;
}): Promise<AgentSkill> {
  const id = uuidv4();
  const ts = nowIso();
  let profileId: string | null = null;
  if (input.profileId) {
    const profile = await getAgentProfileById(input.profileId, input.userId);
    if (!profile || !profile.enabled) throw new Error('Skill profile is not available.');
    profileId = profile.id;
  }
  await db
    .prepare(
      `INSERT INTO agent_skills (id, user_id, name, kind, description, instructions, profile_id, source_type, source_id, source_url, source_path, source_ref, source_hash, files_json, imported_at, enabled, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    )
    .run(id, input.userId, input.name.trim(), input.kind, (input.description ?? '').trim(), input.instructions.trim(), profileId, input.sourceType ?? 'local', input.sourceId ?? null, input.sourceUrl ?? null, input.sourcePath ?? null, input.sourceRef ?? null, input.sourceHash ?? null, input.filesJson ?? '[]', input.importedAt ?? null, ts, ts);
  const row = await getAgentSkillById(id, input.userId);
  if (!row) throw new Error('createAgentSkill: row not found after insert');
  return row;
}

export async function updateAgentSkill(
  id: string,
  userId: string,
  input: Partial<Pick<AgentSkill, 'name' | 'kind' | 'description' | 'instructions' | 'profile_id'>> & { enabled?: number },
): Promise<AgentSkill | undefined> {
  const existing = await getAgentSkillById(id, userId);
  if (!existing) return undefined;
  const profileId = input.profile_id === undefined ? existing.profile_id : input.profile_id;
  if (profileId) {
    const profile = await getAgentProfileById(profileId, userId);
    if (!profile || !profile.enabled) throw new Error('Skill profile is not available.');
  }
  await db
    .prepare(
      `UPDATE agent_skills
       SET name = ?, kind = ?, description = ?, instructions = ?, profile_id = ?, enabled = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      input.name?.trim() || existing.name,
      input.kind || existing.kind,
      input.description === undefined ? existing.description : input.description.trim(),
      input.instructions?.trim() || existing.instructions,
      profileId,
      input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
      nowIso(),
      id,
      userId,
    );
  return getAgentSkillById(id, userId);
}

export async function deleteAgentSkill(id: string, userId: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM agent_skills WHERE id = ? AND user_id = ?`).run(id, userId);
  return result.changes > 0;
}
