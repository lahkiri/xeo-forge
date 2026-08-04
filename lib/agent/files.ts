/**
 * File tool — sandboxed file operations confined to a task workspace.
 *
 * All paths are resolved with realpath and checked to stay within the task
 * workspace root (AGENTS.md §7). Path-traversal attempts (.., symlinks,
 * absolute paths outside the root) are rejected.
 */

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

const WORK_ROOT = process.env.TASK_WORK_DIR || '/tmp/xeo-tasks';
const MAX_READ_BYTES = 1024 * 1024; // 1 MB
const MAX_WRITE_BYTES = 5 * 1024 * 1024; // 5 MB per write

const IGNORE = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.cache']);

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

export function workspaceFor(taskId: string): string {
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

  constructor(taskId: string) {
    this.root = workspaceFor(taskId);
    fs.mkdirSync(this.root, { recursive: true });
  }

  /** Resolve a user-supplied path inside the workspace, rejecting escapes. */
  private resolve(rel: string): string {
    return resolveWithin(this.root, rel);
  }

  async read(rel: string): Promise<string> {
    const abs = this.resolve(rel);
    const stat = await fsp.stat(abs);
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(`File too large (${stat.size} bytes, max ${MAX_READ_BYTES})`);
    }
    return fsp.readFile(abs, 'utf8');
  }

  async write(rel: string, content: string): Promise<void> {
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
      throw new Error(`File content too large (${Buffer.byteLength(content, 'utf8')} bytes, max ${MAX_WRITE_BYTES})`);
    }
    const abs = this.resolve(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
  }

  /** Replace the first occurrence of oldString with newString. */
  async edit(rel: string, oldString: string, newString: string): Promise<void> {
    const abs = this.resolve(rel);
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
