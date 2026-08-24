/**
 * Task artifact export.
 *
 * An artifact is a deterministic, read-only snapshot of a single task's
 * workspace (the canonical execution state at $TASK_WORK_DIR/<taskId>) plus a
 * manifest derived from the task's DB row. There is NO separate artifact store
 * — the workspace IS the source of truth, so the export cannot drift from what
 * the agent actually produced (AGENTS.md rule 1).
 *
 * The ZIP is built in-process with Node's zlib (deflate) — no extra
 * dependency, no temp files, no child process. Output bytes are deterministic
 * for a given workspace + manifest (fixed DOS timestamp), so the same task
 * always exports to the same archive.
 */

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import zlib from 'node:zlib';
import type { Task } from '@/lib/types';
import { workspaceFor } from './files';

// Directories never included in an export (build noise, not deliverables).
const IGNORE = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.cache']);
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200 MB per archive

interface ArtifactFile {
  /** POSIX-style path relative to the workspace root. */
  name: string;
  data: Buffer;
}

/** Collect every workspace file for a task, confined to its realpath root. */
async function collectFiles(taskId: string): Promise<ArtifactFile[]> {
  const root = workspaceFor(taskId);
  if (!fs.existsSync(root)) return [];
  const realRoot = fs.realpathSync(root);

  const files: ArtifactFile[] = [];
  let total = 0;

  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name)); // deterministic order
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;

      if (e.isSymbolicLink()) continue; // never follow symlinks out of the box
      if (e.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!e.isFile()) continue;

      // Confinement: the resolved file must stay within the realpath root.
      const real = fs.realpathSync(abs);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) continue;

      const stat = await fsp.stat(abs);
      if (stat.size > MAX_FILE_BYTES) continue; // skip oversized blobs
      if (total + stat.size > MAX_TOTAL_BYTES) {
        throw new Error('Workspace exceeds maximum export size (200 MB)');
      }
      total += stat.size;
      files.push({ name: rel, data: await fsp.readFile(abs) });
    }
  };

  await walk(realRoot, '');
  return files;
}

/** Human-readable manifest of the task, derived from the DB row. */
function buildManifest(task: Task, fileNames: string[]): string {
  return JSON.stringify(
    {
      task_id: task.id,
      goal: task.goal,
      status: task.status,
      result_summary: task.result_summary ?? null,
      credits_spent: task.credits_spent,
      created_at: task.created_at,
      updated_at: task.updated_at,
      exported_at: new Date().toISOString(),
      files: fileNames,
    },
    null,
    2,
  );
}

// ----- Minimal ZIP writer (store/deflate) -----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Build a ZIP archive from in-memory entries. Uses a fixed DOS timestamp so a
 * given set of files always yields identical bytes (deterministic export).
 */
function buildZip(entries: ZipEntry[]): Buffer {
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = 0x0021; // 1980-01-01 (earliest representable)
  const enc = new TextEncoder();

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(enc.encode(entry.name));
    const crc = crc32(entry.data);
    const uncompressed = entry.data.length;

    // Deflate; fall back to store if compression doesn't help.
    const deflated = zlib.deflateRawSync(entry.data);
    const useDeflate = deflated.length < uncompressed;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : entry.data;
    const compressed = payload.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, nameBytes, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }

  const centralStart = offset;
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir start disk
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, ...centrals, eocd]);
}

export interface TaskExport {
  filename: string;
  zip: Buffer;
  fileCount: number;
}

/**
 * Build the downloadable artifact for a task: every workspace file plus a
 * manifest.json. Returns the ZIP bytes and a suggested filename.
 */
export async function buildTaskExport(task: Task): Promise<TaskExport> {
  const files = await collectFiles(task.id);
  const manifest = buildManifest(task, files.map((f) => f.name));

  const entries: ZipEntry[] = [
    { name: 'manifest.json', data: Buffer.from(manifest, 'utf8') },
    ...files.map((f) => ({ name: `workspace/${f.name}`, data: f.data })),
  ];

  const zip = buildZip(entries);
  return {
    filename: `task-${task.id}.zip`,
    zip,
    fileCount: files.length,
  };
}
