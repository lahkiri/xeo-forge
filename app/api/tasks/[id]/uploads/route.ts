import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { promises as fsp } from 'fs';
import { requireUser, assertOwnerOrAdmin } from '@/lib/auth/guard';
import {
  getTaskById,
  createUpload,
  getUploadsByTask,
  updateUploadStatus,
  setUploadRelPath,
} from '@/lib/db/queries';
import { emitTaskEvent } from '@/lib/sse/emitter';
import { workspaceFor, resolveWithin } from '@/lib/agent/files';
import {
  classifyUpload,
  archiveSuffix,
  isArchive,
  sanitizeEntryPath,
  UploadRejectedError,
  MAX_UPLOAD_BYTES,
} from '@/lib/agent/uploads';
import { extractArchive } from '@/lib/agent/archive';
import { errorResponse } from '../../../_lib/respond';
import type { Upload } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Secure file ingestion for a task.
 *
 * Pipeline (single, native — no parallel system): UPLOAD → QUARANTINE →
 * VALIDATE → EXTRACT/INDEX → READY. Files are stored under the task workspace
 * at `_uploads/<uploadId>/` so they are confined by the SAME realpath boundary
 * (resolveWithin) the agent's FileTool already enforces, and are readable by
 * the existing file_read / file_list tools — no new tool, no new pipeline.
 *
 * Uploaded content is INERT DATA. It is never executed here, and the agent is
 * instructed (prompts.ts) to treat it as untrusted data, not instructions.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let uploadId: string | null = null;
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);

    // ── Per-task upload count limit ──
    const MAX_UPLOADS_PER_TASK = 50;
    const existingUploads = await getUploadsByTask(params.id);
    if (existingUploads.length >= MAX_UPLOADS_PER_TASK) {
      return NextResponse.json(
        { error: `Upload limit reached (${MAX_UPLOADS_PER_TASK} per task).` },
        { status: 400 },
      );
    }

    // ── Parse multipart form ──
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    const filename = (file as File).name || 'upload';
    const byteSize = (file as File).size;

    // ── Size gate (before reading bytes into memory) ──
    if (byteSize <= 0) {
      return NextResponse.json({ error: 'Empty file.' }, { status: 400 });
    }
    if (byteSize > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File exceeds maximum size of ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` },
        { status: 413 },
      );
    }

    // ── Whitelist classification (reject unknown types up front) ──
    const kind = classifyUpload(filename);
    if (!kind) {
      return NextResponse.json(
        {
          error:
            'Unsupported file type. Allowed: text, code, markdown, JSON, CSV, ' +
            'and .zip/.tar/.tar.gz/.tgz archives.',
        },
        { status: 415 },
      );
    }

    // ── Create the quarantined upload record (single writer) ──
    const upload = await createUpload({
      taskId: params.id,
      userId: task.user_id,
      filename,
      kind,
      byteSize,
      relPath: '', // set after we know the id
    });
    uploadId = upload.id;

    const relDir = path.posix.join('_uploads', upload.id);
    const destRoot = path.join(workspaceFor(params.id), '_uploads', upload.id);

    const buf = Buffer.from(await (file as File).arrayBuffer());

    // ── Validate / extract ──
    await updateUploadStatus(upload.id, 'validating');

    let fileCount = 0;
    let extractedBytes = 0;
    let relPath = relDir;

    if (isArchive(kind)) {
      const suffix = archiveSuffix(filename);
      if (!suffix) {
        throw new UploadRejectedError('Unrecognized archive format.');
      }
      await updateUploadStatus(upload.id, 'extracting');
      // resolveWithin is the authoritative per-entry boundary check inside.
      await fsp.mkdir(destRoot, { recursive: true });
      const result = await extractArchive(buf, suffix, destRoot);
      fileCount = result.fileCount;
      extractedBytes = result.extractedBytes;
    } else {
      // Single file: write the raw bytes within the workspace boundary.
      const safeName = sanitizeEntryPath(filename);
      const abs = resolveWithin(workspaceFor(params.id), path.posix.join(relDir, safeName));
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, buf, { flag: 'w' });
      fileCount = 1;
      extractedBytes = byteSize;
      relPath = path.posix.join(relDir, safeName);
    }

    const ready = await updateUploadStatus(upload.id, 'ready', { fileCount, extractedBytes });

    // Record relPath now that extraction succeeded (single source of truth).
    await setUploadRelPath(upload.id, relPath);

    await emitTaskEvent(params.id, 'upload', {
      upload_id: upload.id,
      filename,
      kind,
      status: 'ready',
      file_count: fileCount,
      extracted_bytes: extractedBytes,
    });

    return NextResponse.json({ upload: { ...(ready as Upload), rel_path: relPath } }, { status: 201 });
  } catch (err) {
    // No silent failures, no partial recovery: mark rejected + clean up + report.
    const message =
      err instanceof UploadRejectedError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Upload failed.';

    if (uploadId) {
      await updateUploadStatus(uploadId, 'rejected', { error: message }).catch((e) =>
        console.error('[uploads] failed to mark rejected', e),
      );
      // Remove any partially written files — uploads must not leave unsafe state.
      const destRoot = path.join(workspaceFor(params.id), '_uploads', uploadId);
      await fsp.rm(destRoot, { recursive: true, force: true }).catch((e) =>
        console.error('[uploads] cleanup failed', e),
      );
      await emitTaskEvent(params.id, 'upload', {
        upload_id: uploadId,
        status: 'rejected',
        error: message,
      }).catch((e) => console.error('[uploads] failed to emit rejection', e));
    }

    if (err instanceof UploadRejectedError) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    return errorResponse('tasks/upload', err);
  }
}

/** List all uploads for a task (any status) — for UI rendering. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await getTaskById(params.id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    assertOwnerOrAdmin(user, task.user_id);
    const uploads = await getUploadsByTask(params.id);
    return NextResponse.json({ uploads }, { status: 200 });
  } catch (err) {
    return errorResponse('tasks/uploads-list', err);
  }
}
