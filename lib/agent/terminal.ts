/**
 * PTY terminal sessions, keyed by task.
 *
 * WHAT THIS IS: a real pseudo-terminal on the host, with the task workspace as
 * its working directory and the SAME environment whitelist `code_execute` uses.
 * Interactive programs work because it is a real PTY — a Python REPL prompts, a
 * ^C interrupts, `top` redraws.
 *
 * WHAT THIS IS NOT: an isolation boundary. The shell runs as the server's own
 * user with the server's own permissions. `cd /` works. The workspace is the
 * starting directory, not a jail. Nothing here is a sandbox, and the UI must not
 * describe it as one — same honesty rule the rest of the runtime follows.
 *
 * WHY THE ENV IS SHARED: `SAFE_ENV_KEYS` / `buildSafeEnv` are imported from
 * ./code rather than redeclared. Two environment whitelists would drift, and the
 * drift would eventually leak MODEL_API_KEY or DATABASE_URL into a child the
 * user is typing into.
 *
 * AUTHORITY: this module holds no authorization logic. Sessions are created only
 * by API routes that have already run `requireUser()` + `assertOwnerOrAdmin()`
 * against the task's owner. `bindSession()` takes the resolved owner id and every
 * later operation re-checks it, so a session id leaking to another user is not
 * sufficient to reach the PTY.
 */

import type { IPty } from 'node-pty';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { workspaceFor } from './files';
import { buildSafeEnv } from './code';

/* ------------------------------------------------------------------ */
/*  Limits                                                             */
/* ------------------------------------------------------------------ */

export const TERMINAL_LIMITS = {
  /** Concurrent live sessions for one task. */
  maxSessionsPerTask: 3,
  /** Concurrent live sessions across the whole process. */
  maxSessionsTotal: 24,
  /** Bytes of scrollback retained per session for late-joining viewers. */
  scrollbackBytes: 256 * 1024,
  /** A single client write is capped — a paste bomb should not be forwarded whole. */
  maxWriteChars: 16 * 1024,
  /** Idle sessions are reaped. Resets on any input or output. */
  idleTtlMs: 30 * 60 * 1000,
  /** How long a killed process gets before SIGKILL. */
  killGraceMs: 2_000,
  /** Column/row clamps. A 1x1 or 100000x100000 PTY is a bug or an attack. */
  minCols: 2,
  maxCols: 1000,
  minRows: 1,
  maxRows: 400,
} as const;

/* ------------------------------------------------------------------ */
/*  Shell selection                                                    */
/* ------------------------------------------------------------------ */

/**
 * The shell to spawn. Deliberately NOT taken from `process.env.SHELL` or
 * `ComSpec` on a user-controlled path: those are host env values, and the whole
 * point of `buildSafeEnv` is that host env does not flow into the child
 * unfiltered. A fixed per-platform choice is auditable.
 */
export function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoLogo'] };
  }
  return { file: '/bin/bash', args: ['--login'] };
}

/* ------------------------------------------------------------------ */
/*  Session state                                                      */
/* ------------------------------------------------------------------ */

export type TerminalListener = (chunk: string) => void;
export type TerminalExitListener = (exitCode: number, signal?: number) => void;

export interface TerminalSession {
  id: string;
  taskId: string;
  /** Resolved task owner. Re-checked on every operation. */
  ownerId: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastActivityAt: number;
  /** Set once the process exits; a session is never reused after this. */
  exitCode?: number;
}

interface SessionEntry {
  session: TerminalSession;
  pty: IPty;
  scrollback: string[];
  scrollbackBytes: number;
  listeners: Set<TerminalListener>;
  exitListeners: Set<TerminalExitListener>;
  closed: boolean;
}

const sessions = new Map<string, SessionEntry>();

export class TerminalError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TerminalError';
    this.status = status;
  }
}

function clampCols(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 80;
  return Math.min(TERMINAL_LIMITS.maxCols, Math.max(TERMINAL_LIMITS.minCols, n));
}

function clampRows(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 24;
  return Math.min(TERMINAL_LIMITS.maxRows, Math.max(TERMINAL_LIMITS.minRows, n));
}

/** Live (not exited) sessions for a task. */
export function sessionsForTask(taskId: string): TerminalSession[] {
  const out: TerminalSession[] = [];
  for (const entry of sessions.values()) {
    if (entry.session.taskId === taskId && !entry.closed) out.push(entry.session);
  }
  return out;
}

export function liveSessionCount(): number {
  let n = 0;
  for (const entry of sessions.values()) if (!entry.closed) n += 1;
  return n;
}

/**
 * Look up a session, enforcing ownership.
 *
 * Ownership is re-checked here rather than trusted from the caller because this
 * is the function every route and the WebSocket handler go through. A session id
 * is a bearer token for a live shell; it must not be sufficient on its own.
 */
export function getSession(sessionId: string, ownerId: string): SessionEntry {
  const entry = sessions.get(sessionId);
  if (!entry) throw new TerminalError('Terminal session not found.', 404);
  if (entry.session.ownerId !== ownerId) {
    // Deliberately the same message and status as a missing session: a
    // different response would let one user probe for another's session ids.
    throw new TerminalError('Terminal session not found.', 404);
  }
  return entry;
}

/* ------------------------------------------------------------------ */
/*  Scrollback                                                         */
/* ------------------------------------------------------------------ */

/**
 * Append to the bounded scrollback ring.
 *
 * A long-running `yes` would otherwise grow this without limit until the process
 * dies. Chunks are dropped oldest-first, which means a late-joining viewer sees a
 * truncated history — correct, and preferable to an OOM.
 */
function pushScrollback(entry: SessionEntry, chunk: string): void {
  entry.scrollback.push(chunk);
  entry.scrollbackBytes += chunk.length;
  while (entry.scrollbackBytes > TERMINAL_LIMITS.scrollbackBytes && entry.scrollback.length > 1) {
    const dropped = entry.scrollback.shift();
    entry.scrollbackBytes -= dropped ? dropped.length : 0;
  }
}

/** Replay buffer for a client that just attached. */
export function scrollbackOf(sessionId: string, ownerId: string): string {
  return getSession(sessionId, ownerId).scrollback.join('');
}

/* ------------------------------------------------------------------ */
/*  Create                                                             */
/* ------------------------------------------------------------------ */

export interface CreateSessionArgs {
  taskId: string;
  /** Already-authorized owner of the task. */
  ownerId: string;
  projectPath?: string | null;
  cols?: number;
  rows?: number;
}

/**
 * Spawn a PTY for a task.
 *
 * `node-pty` is imported lazily. It is a native module; a static import would
 * make every route that merely *mentions* terminals fail to load on a machine
 * where the native binary is missing, and would drag it into the Next.js client
 * graph. Importing at spawn time keeps the failure local and legible.
 */
export async function createSession(args: CreateSessionArgs): Promise<TerminalSession> {
  const { taskId, ownerId, projectPath } = args;

  // Opportunistic reap. Without this the idle TTL is a number nobody checks:
  // a full-page browser reload runs NO React cleanup (the old session leaks),
  // and after 3 reloads the per-task cap would lock the user out of terminals
  // forever. Reaping HERE bounds the leak to one idle window and needs no
  // timer holding the process open.
  reapIdleSessions();

  if (sessionsForTask(taskId).length >= TERMINAL_LIMITS.maxSessionsPerTask) {
    throw new TerminalError(
      `This task already has ${TERMINAL_LIMITS.maxSessionsPerTask} live terminal sessions. Close one first.`,
      429,
    );
  }
  if (liveSessionCount() >= TERMINAL_LIMITS.maxSessionsTotal) {
    throw new TerminalError('The server is at its terminal-session limit. Try again shortly.', 503);
  }

  // Throws if the task has no resolvable workspace, which is the correct
  // failure: a terminal with no working directory has nothing to operate on.
  const cwd = workspaceFor(taskId, projectPath);

  // The workspace may not exist yet — a task that has had no file writes and
  // no selected project has never materialized its directory. CreateProcess
  // (error 267, ERROR_DIRECTORY) refuses a PTY whose cwd is missing, so the
  // directory is created here rather than surfacing that as a terminal error.
  fs.mkdirSync(cwd, { recursive: true });

  let ptyModule: typeof import('node-pty');
  try {
    ptyModule = await import('node-pty');
  } catch (err) {
    throw new TerminalError(
      'The terminal native module (node-pty) is unavailable in this build. Terminals are disabled.',
      501,
    );
  }

  const cols = clampCols(args.cols);
  const rows = clampRows(args.rows);
  const shell = defaultShell();

  // The identical environment policy code_execute uses. TERM is forced because a
  // PTY with no TERM makes full-screen programs (vim, top) misbehave, and TERM is
  // already in the whitelist so this is a default, not a new key.
  const env = buildSafeEnv(cwd);
  if (!env.TERM) env.TERM = 'xterm-256color';
  // HOME points at the workspace (buildSafeEnv policy), and bash therefore
  // writes .bash_history THERE — silently dirtying the task's git status and
  // file listing on every session. History belongs to the person typing, not
  // to the artifact under review, so it is turned off for the child shell.
  // POSIX-only: PowerShell's PSReadLine history lives under the user profile,
  // never in the working directory.
  if (process.platform !== 'win32') env.HISTFILE = '/dev/null';

  let child: IPty;
  try {
    child = ptyModule.spawn(shell.file, shell.args, {
      name: env.TERM,
      cols,
      rows,
      cwd,
      env,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new TerminalError(`Could not start a terminal: ${message}`.slice(0, 300), 500);
  }

  const session: TerminalSession = {
    id: randomUUID(),
    taskId,
    ownerId,
    cwd,
    cols,
    rows,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  const entry: SessionEntry = {
    session,
    pty: child,
    scrollback: [],
    scrollbackBytes: 0,
    listeners: new Set(),
    exitListeners: new Set(),
    closed: false,
  };
  sessions.set(session.id, entry);

  child.onData((chunk: string) => {
    entry.session.lastActivityAt = Date.now();
    pushScrollback(entry, chunk);
    for (const listener of entry.listeners) {
      // One listener throwing must not stop the others from receiving output.
      try {
        listener(chunk);
      } catch {
        /* ignore a broken consumer */
      }
    }
  });

  child.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    entry.closed = true;
    entry.session.exitCode = exitCode;
    entry.session.lastActivityAt = Date.now();
    for (const listener of entry.exitListeners) {
      try {
        listener(exitCode, signal);
      } catch {
        /* ignore */
      }
    }
    entry.listeners.clear();
    entry.exitListeners.clear();
    // The record is dropped so a dead id cannot be reattached. Callers learn
    // about the exit through the exit listener, which fires first.
    sessions.delete(entry.session.id);
  });

  return session;
}

/* ------------------------------------------------------------------ */
/*  IO                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Forward client keystrokes to the PTY.
 *
 * The input is NOT parsed, filtered, or denylisted. This is a terminal: the user
 * typing `rm -rf` into their own workspace is the feature, and a filter here
 * would be both bypassable and misleading about the boundary. What IS enforced is
 * ownership (via getSession) and a per-write size cap, so a multi-megabyte paste
 * cannot be used to exhaust memory in the forwarding path.
 */
export function writeToSession(sessionId: string, ownerId: string, data: string): void {
  const entry = getSession(sessionId, ownerId);
  if (entry.closed) throw new TerminalError('That terminal session has exited.', 409);
  const payload = data.length > TERMINAL_LIMITS.maxWriteChars ? data.slice(0, TERMINAL_LIMITS.maxWriteChars) : data;
  entry.session.lastActivityAt = Date.now();
  entry.pty.write(payload);
}

export function resizeSession(sessionId: string, ownerId: string, cols: number, rows: number): void {
  const entry = getSession(sessionId, ownerId);
  if (entry.closed) throw new TerminalError('That terminal session has exited.', 409);
  const nextCols = clampCols(cols);
  const nextRows = clampRows(rows);
  entry.session.cols = nextCols;
  entry.session.rows = nextRows;
  entry.session.lastActivityAt = Date.now();
  entry.pty.resize(nextCols, nextRows);
}

/** Subscribe to live output. Returns an unsubscribe function. */
export function attachSession(
  sessionId: string,
  ownerId: string,
  onData: TerminalListener,
  onExit?: TerminalExitListener,
): () => void {
  const entry = getSession(sessionId, ownerId);
  entry.listeners.add(onData);
  if (onExit) entry.exitListeners.add(onExit);
  return () => {
    entry.listeners.delete(onData);
    if (onExit) entry.exitListeners.delete(onExit);
  };
}

/* ------------------------------------------------------------------ */
/*  Teardown                                                           */
/* ------------------------------------------------------------------ */

function forceKill(entry: SessionEntry): void {
  try {
    entry.pty.kill();
  } catch {
    /* already gone */
  }
}

/**
 * Kill one session. Idempotent.
 *
 * A graceful kill is attempted first; if the process is still registered after
 * the grace period the PTY is killed again, which for node-pty means SIGKILL on
 * POSIX and TerminateProcess on Windows. The timer is unref'd so a pending
 * teardown never keeps the process alive.
 */
export function killSession(sessionId: string, ownerId: string): boolean {
  const entry = sessions.get(sessionId);
  if (!entry) return false;
  if (entry.session.ownerId !== ownerId) throw new TerminalError('Terminal session not found.', 404);
  forceKill(entry);
  const timer = setTimeout(() => {
    if (sessions.has(sessionId)) {
      forceKill(entry);
      sessions.delete(sessionId);
    }
  }, TERMINAL_LIMITS.killGraceMs);
  if (typeof timer.unref === 'function') timer.unref();
  return true;
}

/**
 * Kill every session for a task, regardless of owner.
 *
 * Called when a task reaches a terminal state. There is no owner parameter
 * because the caller is the runtime, not a user — a task that has finished must
 * not leave a live shell behind just because the request that ended it came from
 * an admin rather than the owner.
 */
export function killSessionsForTask(taskId: string): number {
  let killed = 0;
  for (const [id, entry] of [...sessions.entries()]) {
    if (entry.session.taskId !== taskId) continue;
    forceKill(entry);
    sessions.delete(id);
    killed += 1;
  }
  return killed;
}

/** Reap sessions idle past the TTL. Returns how many were killed. */
export function reapIdleSessions(now = Date.now()): number {
  let killed = 0;
  for (const [id, entry] of [...sessions.entries()]) {
    if (now - entry.session.lastActivityAt < TERMINAL_LIMITS.idleTtlMs) continue;
    forceKill(entry);
    sessions.delete(id);
    killed += 1;
  }
  return killed;
}


/** Serializable view for API responses. */
export function describeSession(session: TerminalSession): {
  id: string;
  taskId: string;
  cols: number;
  rows: number;
  createdAt: number;
  /** Home directory of the shell — the workspace, not a jail. */
  cwd: string;
} {
  return {
    id: session.id,
    taskId: session.taskId,
    cols: session.cols,
    rows: session.rows,
    createdAt: session.createdAt,
    cwd: session.cwd,
  };
}
