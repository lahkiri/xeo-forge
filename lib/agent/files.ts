/**
 * File tool — workspace-confined file operations.
 *
 * All paths are resolved with realpath and checked to stay within the task
 * workspace root (AGENTS.md §7). Path-traversal attempts (.., symlinks,
 * absolute paths outside the root) are rejected. This confinement is real for
 * the file tools; it is not an OS sandbox, and code_execute is a separate,
 * weaker boundary — see lib/agent/code.ts.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import {
  WriteConflictError,
  WriteLedger,
  refusalMessage,
  type FileMutationEvent,
  type MutationDigests,
  type MutationOp,
} from './write-ledger';

/** sha256 first-16-hex of a buffer — the file_mutation replay anchor (§4.4). */
function sha16(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/**
 * Current on-disk state of a path, for the mutation event's before-digest.
 * A missing file is the generation-0 baseline (bytes 0, sha null); any OTHER
 * read failure is rethrown — silently treating EACCES as "absent" would lie
 * in the audit trail.
 */
async function digestOf(abs: string): Promise<{ bytes: number; sha: string | null }> {
  try {
    const buf = await fsp.readFile(abs);
    return { bytes: buf.byteLength, sha: sha16(buf) };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { bytes: 0, sha: null };
    throw err;
  }
}

// os.tmpdir() rather than a hardcoded '/tmp' so the default is correct on
// Windows (%TEMP%) as well as POSIX. TASK_WORK_DIR still overrides.
const WORK_ROOT = process.env.TASK_WORK_DIR || path.join(os.tmpdir(), 'xeo-tasks');
const MAX_READ_BYTES = 1024 * 1024; // 1 MB
const MAX_WRITE_BYTES = 5 * 1024 * 1024; // 5 MB per write

const IGNORE = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.cache']);

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

export function workspaceFor(taskId: string, projectPath?: string | null): string {
  const selected = typeof projectPath === 'string' ? projectPath.trim() : '';
  if (selected && process.env.XEO_DESKTOP_LOCAL === '1' && path.isAbsolute(selected)) {
    const root = path.resolve(selected);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new AccessDeniedError('Selected project folder does not exist or is not a directory.');
    }
    return root;
  }
  return path.join(WORK_ROOT, taskId);
}

/**
 * Resolve `rel` inside `root`, rejecting escapes via realpath checks.
 * This is THE single path-safety primitive — reused by FileTool and by the
 * archive extractor so there is exactly one boundary-enforcement implementation.
 */
export function resolveWithin(root: string, rel: string): string {
  const target = path.resolve(root, rel);
  // Resolve realpath of the closest existing ancestor to defeat symlink escapes.
  let probe = target;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realProbe = fs.existsSync(probe) ? fs.realpathSync(probe) : probe;
  const realRoot = fs.realpathSync(root);
  const candidate = probe === target ? realProbe : path.join(realProbe, path.relative(probe, target));
  if (candidate !== realRoot && !candidate.startsWith(realRoot + path.sep)) {
    throw new AccessDeniedError(`Path escapes workspace: ${rel}`);
  }
  return candidate;
}

export class FileTool {
  readonly root: string;
  /**
   * v1.25 Commit A: the task's WriteLedger when one is attached (the agent
   * loop's createToolContext always attaches one). Absent → byte-identical
   * legacy behavior: the single-writer no-op invariant of design §4.1.
   */
  private readonly ledger?: WriteLedger;
  /**
   * Audit sink for file_mutation events (§4.4) — set by the agent loop to
   * the run's persisted-event channel right after ctx.emit is wired. Emission
   * belongs to THIS boundary (applied and ledger-refused alike; the owner's
   * Q4 ruling keeps policy refusals on the governance path). An emission
   * failure propagates: for a refusal the write never landed anyway, and for
   * an applied write the ledger has already stamped the writer, so an
   * honest retry stays safe.
   */
  onMutation?: (event: FileMutationEvent) => Promise<void>;

  constructor(taskId: string, projectPath?: string | null, ledger?: WriteLedger) {
    this.root = workspaceFor(taskId, projectPath);
    fs.mkdirSync(this.root, { recursive: true });
    this.ledger = ledger;
  }

  /** Resolve a user-supplied path inside the workspace, rejecting escapes. */
  private resolve(rel: string): string {
    return resolveWithin(this.root, rel);
  }

  /** Run one mutation through the ledger (when attached), emit, and refuse honestly. */
  private async guardedMutation(
    agentId: string,
    rel: string,
    op: MutationOp,
    perform: () => Promise<MutationDigests>,
  ): Promise<void> {
    if (!this.ledger) {
      await perform();
      return;
    }
    const event = await this.ledger.run(agentId, rel, op, perform);
    if (this.onMutation) await this.onMutation(event);
    if (event.outcome !== 'applied') {
      throw new WriteConflictError(refusalMessage(event), event);
    }
  }

  async read(rel: string, agentId = 'parent'): Promise<string> {
    const abs = this.resolve(rel);
    const stat = await fsp.stat(abs);
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(`File too large (${stat.size} bytes, max ${MAX_READ_BYTES})`);
    }
    const text = await fsp.readFile(abs, 'utf8');
    // §4.1: every read records the generation the caller observed — the
    // basis of stale-write detection. No ledger → nothing to record.
    this.ledger?.stampRead(agentId, rel);
    return text;
  }

  async write(rel: string, content: string, agentId = 'parent'): Promise<void> {
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
      throw new Error(`File content too large (${Buffer.byteLength(content, 'utf8')} bytes, max ${MAX_WRITE_BYTES})`);
    }
    const abs = this.resolve(rel);
    await this.guardedMutation(agentId, rel, 'write', async () => {
      const before = await digestOf(abs);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, content, 'utf8');
      const body = Buffer.from(content, 'utf8');
      return {
        bytesBefore: before.bytes,
        shaBefore: before.sha,
        bytesAfter: body.byteLength,
        shaAfter: sha16(body),
      };
    });
  }

  /** Replace the first occurrence of oldString with newString. */
  async edit(rel: string, oldString: string, newString: string, agentId = 'parent'): Promise<void> {
    const abs = this.resolve(rel);
    await this.guardedMutation(agentId, rel, 'edit', async () => {
      // Anchor checks run INSIDE the lease: with a second writer (Commit B)
      // no one can slip between the uniqueness check and the write.
      const current = await fsp.readFile(abs, 'utf8');
      const idx = current.indexOf(oldString);
      if (idx === -1) {
        throw new Error(`edit: oldString not found in ${rel}`);
      }
      if (current.indexOf(oldString, idx + oldString.length) !== -1) {
        throw new Error(`edit: oldString is not unique in ${rel}`);
      }
      const next = current.slice(0, idx) + newString + current.slice(idx + oldString.length);
      await fsp.writeFile(abs, next, 'utf8');
      return {
        bytesBefore: Buffer.byteLength(current, 'utf8'),
        shaBefore: sha16(Buffer.from(current, 'utf8')),
        bytesAfter: Buffer.byteLength(next, 'utf8'),
        shaAfter: sha16(Buffer.from(next, 'utf8')),
      };
    });
  }

  async list(rel = '.'): Promise<string[]> {
    const abs = this.resolve(rel);
    const out: string[] = [];
    const walk = async (dir: string, prefix: string) => {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (IGNORE.has(e.name)) continue;
        const childRel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) {
          out.push(childRel + '/');
          await walk(path.join(dir, e.name), childRel);
        } else {
          out.push(childRel);
        }
      }
    };
    await walk(abs, rel === '.' ? '' : rel);
    return out;
  }
}
