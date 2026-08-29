/**
 * uploads domain queries (moved verbatim from queries.ts).
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../index';
import { nowIso } from './shared';
import type {
  Upload,
  UploadKind,
  UploadStatus,
} from '../../types';

/* ------------------------------------------------------------------ */
/* Uploads (single writer for the uploads table)                      */
/* ------------------------------------------------------------------ */

/**
 * Create an upload row in the initial 'quarantined' state. The file bytes are
 * written to the task workspace by the route handler BEFORE the agent can ever
 * see them (status gates exposure). `relPath` is workspace-relative (_uploads/<id>).
 */
export async function createUpload(input: {
  taskId: string;
  userId: string;
  filename: string;
  kind: UploadKind;
  byteSize: number;
  relPath: string;
}): Promise<Upload> {
  const id = uuidv4();
  const ts = nowIso();
  if (db.kind === 'pg') {
    // PostgreSQL: RETURNING * avoids race with concurrent writes.
    const row = await db
      .prepare<Upload>(
        `INSERT INTO uploads
         (id, task_id, user_id, filename, kind, status, byte_size, rel_path,
          file_count, extracted_bytes, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'quarantined', ?, ?, 0, 0, NULL, ?, ?) RETURNING *`,
      )
      .get(id, input.taskId, input.userId, input.filename, input.kind, input.byteSize, input.relPath, ts, ts);
    if (!row) throw new Error('createUpload: row not found after insert');
    return row;
  }
  // SQLite: single-writer so re-SELECT by PK is safe.
  await db
    .prepare(
      `INSERT INTO uploads
       (id, task_id, user_id, filename, kind, status, byte_size, rel_path,
        file_count, extracted_bytes, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'quarantined', ?, ?, 0, 0, NULL, ?, ?)`,
    )
    .run(id, input.taskId, input.userId, input.filename, input.kind, input.byteSize, input.relPath, ts, ts);
  const row = await getUploadById(id);
  if (!row) throw new Error('createUpload: row not found after insert');
  return row;
}

export async function getUploadById(id: string): Promise<Upload | undefined> {
  return db.prepare<Upload>(`SELECT * FROM uploads WHERE id = ?`).get(id);
}

/** All uploads for a task in chronological order — for UI + agent manifest. */
export async function getUploadsByTask(taskId: string): Promise<Upload[]> {
  return db
    .prepare<Upload>(`SELECT * FROM uploads WHERE task_id = ? ORDER BY created_at ASC, id ASC`)
    .all(taskId);
}

/** Only uploads the agent is allowed to reference (validated + extracted). */
export async function getReadyUploadsByTask(taskId: string): Promise<Upload[]> {
  return db
    .prepare<Upload>(
      `SELECT * FROM uploads WHERE task_id = ? AND status = 'ready' ORDER BY created_at ASC, id ASC`,
    )
    .all(taskId);
}

/**
 * Advance an upload through its lifecycle. Persisting a terminal state
 * ('ready' | 'rejected') with counts/error is how the pipeline records its
 * verdict — failures are NEVER silent (AGENTS.md rule 3).
 */
export async function updateUploadStatus(
  id: string,
  status: UploadStatus,
  fields: { fileCount?: number; extractedBytes?: number; error?: string | null } = {},
): Promise<Upload | undefined> {
  await db
    .prepare(
      `UPDATE uploads
       SET status = ?,
           file_count = COALESCE(?, file_count),
           extracted_bytes = COALESCE(?, extracted_bytes),
           error = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      status,
      fields.fileCount ?? null,
      fields.extractedBytes ?? null,
      fields.error ?? null,
      nowIso(),
      id,
    );
  return getUploadById(id);
}

/**
 * Record the resolved workspace-relative path of an upload once extraction
 * succeeds. rel_path is written exactly once here (single writer) — the agent
 * manifest and UI read it to reference the inert, validated files.
 */
export async function setUploadRelPath(id: string, relPath: string): Promise<Upload | undefined> {
  await db
    .prepare(`UPDATE uploads SET rel_path = ?, updated_at = ? WHERE id = ?`)
    .run(relPath, nowIso(), id);
  return getUploadById(id);
}
