/**
 * Git integration — a fixed, closed set of git operations on a task workspace.
 *
 * NOT A SANDBOX (AGENTS.md §16). `git` runs as an ordinary host process with the
 * task workspace as its cwd. What this module provides is not containment; it is
 * a narrow, auditable surface over the git binary:
 *
 * WHY execFile WITH AN ARGUMENT ARRAY, NOT A SHELL STRING, AND NOT `simple-git`:
 *  - `execFile('git', argv)` hands argv straight to CreateProcess/execvp. There is
 *    no shell, so `;`, `|`, `$(...)`, backticks and quoting are inert bytes. A
 *    commit message of `x; rm -rf /` is a commit message. Shell-injection is not
 *    mitigated here, it is structurally absent.
 *  - No new dependency: a wrapper library would add a transitive tree to the one
 *    code path allowed to mutate a user's repository, and would still need every
 *    check below written on top of it.
 *
 * WHAT IS ENFORCED (each is a real check, not advice to the model):
 *  1. cwd is always `workspaceFor(taskId, projectPath)`. Model-supplied paths go
 *     through `resolveWithin` — the one path-safety primitive — and reach git as
 *     workspace-relative pathspecs after a `--` separator.
 *  2. The workspace must BE the repository root. `git rev-parse --show-toplevel`
 *     must equal the workspace realpath. Git's normal behaviour is to walk up
 *     until it finds a `.git`; a workspace nested inside the user's real project
 *     would therefore operate on the parent's history. That is refused.
 *  3. argv is assembled from fixed literals plus typed value slots. Every literal
 *     is checked against ALLOWED_LITERALS, so `push`, `fetch`, `pull`, `reset`,
 *     `clean`, `gc`, `filter-branch`, `--force` and remote mutation are
 *     unreachable by construction — there is no passthrough for extra args.
 *  4. A ref can never be read as a flag: refs are validated before any spawn and
 *     rejected if they begin with `-`, contain `..`, `@{`, whitespace, etc.
 *  5. Identity is injected per-invocation (`-c user.name=… -c user.email=…`) so a
 *     fresh workspace repo with no configured identity still commits.
 *  6. Bounded: per-command timeout, bounded stdio buffer, capped output, capped
 *     `log` count, `--no-color` everywhere so output stays machine-parseable.
 *
 * `revert` is the safe kind only — `revert --no-commit <ref>` or
 * `checkout -- <path>`. `reset --hard` is not implemented and cannot be reached.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import type { TaskMode } from '../types';
import { workspaceFor, resolveWithin } from './files';
import { buildSafeEnv } from './code';

const execFileAsync = promisify(execFile);

/** Per-invocation ceiling. A hung `git` must not hold a task iteration open. */
const TIMEOUT_MS = 20_000;
/** Bounded stdio buffer; a pathological diff cannot exhaust the heap. */
const MAX_BUFFER = 8 * 1024 * 1024;
/** Output cap. The tool layer clamps further; this stops the string existing. */
const MAX_OUTPUT_CHARS = 40_000;

const DEFAULT_LOG_LIMIT = 20;
const MAX_LOG_LIMIT = 100;

/**
 * Identity injected per invocation with `-c`, never written to the repo config.
 *
 * A fresh workspace repo usually has no `user.name`/`user.email`, and `git commit`
 * then fails with "Please tell me who you are" — which reads to the model as a
 * broken tool rather than a missing setting. Passing identity on the command line
 * makes a commit always possible and makes agent authorship visible in the log.
 */
export const GIT_AUTHOR_NAME = 'Xeo Forge Agent';
export const GIT_AUTHOR_EMAIL = 'agent@xeo.forge.local';

/** A refusal by policy: outside the repo, wrong mode, forbidden shape. */
export class GitBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitBlockedError';
  }
}

/** git ran (or failed to run) and the operation could not be completed. */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

export type GitOp = 'status' | 'diff' | 'log' | 'branch' | 'checkout' | 'add' | 'commit' | 'revert';

/** The complete op vocabulary. Anything absent here is unreachable. */
export const GIT_OPS: readonly GitOp[] = ['status', 'diff', 'log', 'branch', 'checkout', 'add', 'commit', 'revert'];

/** Inspection only — allowed in every mode, including read-only Chat/Planning. */
export const GIT_READ_OPS: ReadonlySet<GitOp> = new Set<GitOp>(['status', 'diff', 'log', 'branch']);

/** Mutating — allowed only in build mode, enforced in runGitOp. */
export const GIT_WRITE_OPS: ReadonlySet<GitOp> = new Set<GitOp>(['checkout', 'add', 'commit', 'revert']);

export function isGitOp(value: unknown): value is GitOp {
  return typeof value === 'string' && (GIT_OPS as readonly string[]).includes(value);
}

export interface GitOpArgs {
  op: GitOp;
  paths?: string[];
  message?: string;
  ref?: string;
  staged?: boolean;
  limit?: number;
}

/* ------------------------------------------------------------------ */
/*  argv construction                                                  */
/*                                                                     */
/*  argv is built as TAGGED TOKENS, never by string concatenation. A     */
/*  `lit` token is a fixed part of a command template and must appear    */
/*  in ALLOWED_LITERALS. A `val` token is a typed slot filled from       */
/*  model input. assertArgv() then re-checks the whole array before a    */
/*  process is spawned, so a template mistake fails loudly here rather   */
/*  than silently becoming a new git capability.                        */
/* ------------------------------------------------------------------ */

/** A value slot. Each has its own validator; see assertArgv. */
type ValueSlot = 'ref' | 'path' | 'message' | 'count';

type Token = { lit: string } | { val: string; slot: ValueSlot };

const lit = (s: string): Token => ({ lit: s });
const val = (s: string, slot: ValueSlot): Token => ({ val: s, slot });

/**
 * The complete set of fixed argv literals this module may emit.
 *
 * THIS IS THE FORBIDDEN-OPERATION ENFORCEMENT. `push`, `fetch`, `pull`, `remote`,
 * `reset`, `clean`, `gc`, `filter-branch`, `--force`, `-f`, `--hard` and every
 * other dangerous verb or flag is absent, and there is no code path that puts a
 * model-supplied string into a literal position. Denying by absence rather than by
 * matching a denylist of strings means a new git verb cannot leak in by being
 * unlisted — it has to be added here deliberately.
 */
const ALLOWED_LITERALS: ReadonlySet<string> = new Set([
  // global config prefix
  '-c',
  'color.ui=false',
  'core.pager=cat',
  'core.quotepath=false',
  'advice.detachedHead=false',
  `user.name=${GIT_AUTHOR_NAME}`,
  `user.email=${GIT_AUTHOR_EMAIL}`,
  '--no-pager',
  // verbs
  'rev-parse',
  'check-ref-format',
  'status',
  'diff',
  'log',
  'branch',
  'checkout',
  'add',
  'commit',
  'revert',
  // flags
  '--show-toplevel',
  '--allow-onelevel',
  '--porcelain=v2',
  '--branch',
  '-z',
  '--no-color',
  '--staged',
  '--list',
  '--no-guess',
  '--no-commit',
  '--no-verify',
  '-n',
  '-m',
  '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s',
  '--date=iso-strict',
  '--',
]);

/** Hard ceilings on value slots, so a slot cannot become a memory attack. */
const MAX_MESSAGE_CHARS = 4000;
const MAX_REF_CHARS = 200;
const MAX_PATHS = 100;

/**
 * Conservative ref grammar, applied BEFORE any process is spawned.
 *
 * Only `[A-Za-z0-9._/-]` plus the `HEAD~n` / `name^n` forms. Rejected outright:
 *  - a leading `-`, so `--force`, `-f` and `--upload-pack=evil` can never occupy
 *    a ref slot even in a command where git would accept a flag there;
 *  - `..` and `...`, which are range/traversal syntax, not a single commit;
 *  - `@{`, which is reflog syntax and can name commits the caller never saw;
 *  - whitespace, control characters, `:` (refspec separator), `?*[` (glob),
 *    `\` and a trailing `/` or `.lock`.
 *
 * `git check-ref-format` is then consulted as a second opinion for full refnames
 * (see assertRefAcceptedByGit). The regex is the load-bearing check because it
 * runs with no process at all; check-ref-format cannot validate `HEAD` shorthands
 * consistently (`HEAD~1` fails it), so it is used only where it is meaningful.
 */
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*(?:[~^]\d*)*$/;

export function isValidRef(ref: string): boolean {
  if (!ref || ref.length > MAX_REF_CHARS) return false;
  if (ref.startsWith('-')) return false;
  if (ref.includes('..')) return false;
  if (ref.includes('@{')) return false;
  if (ref.includes(':') || ref.includes('\\') || ref.includes('?') || ref.includes('*') || ref.includes('[')) return false;
  if (/[\s\x00-\x1f\x7f]/.test(ref)) return false;
  if (ref.endsWith('/') || ref.endsWith('.') || ref.endsWith('.lock')) return false;
  if (ref.includes('//')) return false;
  return REF_RE.test(ref);
}

/**
 * Final gate before spawn. Re-validates the ENTIRE argv independently of how it
 * was built, so a mistake in a command template is caught here.
 *
 * The `-`-prefix rule is the anti-smuggling rule: a ref, path or count slot may
 * never begin with `-`, so model text cannot become a flag. A message slot is
 * exempt by design — `git commit -m <msg>` consumes the next argv as the message
 * even when it looks like an option, so a message of `--author=x` is recorded as
 * the subject line `--author=x` and changes no authorship. That behaviour is
 * asserted in test/git.test.ts rather than assumed.
 */
function assertArgv(tokens: Token[]): string[] {
  const argv: string[] = [];
  for (const token of tokens) {
    if ('lit' in token) {
      if (!ALLOWED_LITERALS.has(token.lit)) {
        throw new GitBlockedError(`git: refusing unlisted argument "${token.lit}" (not in the allowed template set).`);
      }
      argv.push(token.lit);
      continue;
    }
    const { val: value, slot } = token;
    if (value.includes('\0')) {
      throw new GitBlockedError('git: NUL byte in argument.');
    }
    switch (slot) {
      case 'ref':
        if (!isValidRef(value)) {
          throw new GitBlockedError(
            `git: rejected ref "${value.slice(0, 60)}". Refs may contain only letters, digits, ".", "_", "/", "-" and HEAD~n forms, and may not start with "-".`,
          );
        }
        break;
      case 'path':
        if (value.startsWith('-')) {
          throw new GitBlockedError(`git: rejected path "${value.slice(0, 60)}" because it would be read as an option.`);
        }
        if (value.includes('..')) {
          throw new GitBlockedError(`git: rejected path "${value.slice(0, 60)}" (parent traversal).`);
        }
        break;
      case 'count':
        if (!/^\d+$/.test(value)) {
          throw new GitBlockedError(`git: rejected count "${value.slice(0, 60)}".`);
        }
        break;
      case 'message':
        if (value.length === 0) throw new GitBlockedError('git: commit message is empty.');
        if (value.length > MAX_MESSAGE_CHARS) {
          throw new GitBlockedError(`git: commit message exceeds ${MAX_MESSAGE_CHARS} characters.`);
        }
        break;
    }
    argv.push(value);
  }
  return argv;
}

/* ------------------------------------------------------------------ */
/*  spawn                                                              */
/* ------------------------------------------------------------------ */

/**
 * Config prefix applied to every invocation.
 *
 * `color.ui=false` and `core.pager=cat` keep output machine-parseable regardless
 * of the user's global gitconfig; `core.quotepath=false` stops non-ASCII paths
 * arriving as octal escapes; `advice.detachedHead` suppresses a paragraph of
 * human advice the model would have to read past.
 */
const CONFIG_PREFIX: Token[] = [
  lit('-c'), lit('color.ui=false'),
  lit('-c'), lit('core.pager=cat'),
  lit('-c'), lit('core.quotepath=false'),
  lit('-c'), lit('advice.detachedHead=false'),
  lit('--no-pager'),
];

/** Identity, appended only for the commands that create an object. */
const IDENTITY_PREFIX: Token[] = [
  lit('-c'), lit(`user.name=${GIT_AUTHOR_NAME}`),
  lit('-c'), lit(`user.email=${GIT_AUTHOR_EMAIL}`),
];

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawn git once. No shell: `execFile` passes argv to the OS directly.
 *
 * A missing binary (ENOENT) is turned into an actionable GitError rather than an
 * unhandled rejection — this is the single place where "git is not installed" is
 * detected, so every op reports it identically.
 */
async function spawnGit(tokens: Token[], cwd: string): Promise<RunResult> {
  const argv = assertArgv(tokens);
  try {
    const { stdout, stderr } = await execFileAsync('git', argv, {
      cwd,
      env: buildSafeEnv(cwd) as NodeJS.ProcessEnv,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      // Never inherit a shell. execFile does not use one; this is explicit.
      shell: false,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
    if (e.code === 'ENOENT') {
      throw new GitError(
        'git is not available on PATH. Install git and restart Xeo Forge, or use file tools instead of version control for this task.',
      );
    }
    if (e.killed) {
      throw new GitError(`git timed out after ${TIMEOUT_MS}ms and was terminated.`);
    }
    if (typeof e.stdout === 'string' || typeof e.stderr === 'string') {
      const exitCode = typeof e.code === 'number' ? e.code : 1;
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode };
    }
    throw new GitError(`git failed to start: ${e.message}`);
  }
}

/** Run git and throw on a non-zero exit, with git's own stderr as the reason. */
async function gitOrThrow(tokens: Token[], cwd: string, what: string): Promise<string> {
  const result = await spawnGit(tokens, cwd);
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(0, 600);
    throw new GitError(`git ${what} failed (exit ${result.exitCode}): ${detail || 'no output'}`);
  }
  return result.stdout;
}

/* ------------------------------------------------------------------ */
/*  repository boundary                                                */
/* ------------------------------------------------------------------ */

/** Compare two filesystem paths for identity, tolerating platform spelling. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    // git prints POSIX separators even on Windows; normalise both sides and drop
    // any trailing separator before comparing.
    let out = path.resolve(p.replace(/\//g, path.sep));
    if (out.length > 1 && out.endsWith(path.sep)) out = out.slice(0, -1);
    return process.platform === 'win32' ? out.toLowerCase() : out;
  };
  return norm(a) === norm(b);
}

export interface RepoRoot {
  /** Workspace directory, realpath-resolved. Always the cwd for git. */
  workspace: string;
  /** True when the workspace itself is the repository root. */
  isRepoRoot: boolean;
  /** What git reported as the toplevel, when it found one at all. */
  toplevel: string | null;
}

/**
 * Establish whether the workspace is itself a git repository root.
 *
 * WHY THE EQUALITY CHECK MATTERS MORE THAN THE `.git` CHECK: git resolves a
 * repository by walking UP from cwd until it finds `.git`. In desktop-local mode
 * the workspace can be any folder the user picked — including a subdirectory of
 * their real project. Without this check, `git_op commit` from
 * `~/project/packages/api` would write to `~/project`'s history, and `revert`
 * would discard work the task never touched. So a discovered toplevel that is not
 * the workspace is treated as "not a repo here" and refused, rather than used.
 *
 * The `.git` presence test alone would not catch it: `~/project/packages/api` has
 * no `.git`, yet git would happily operate there.
 */
export async function resolveRepoRoot(taskId: string, projectPath: string | null): Promise<RepoRoot> {
  const raw = workspaceFor(taskId, projectPath);
  if (!fs.existsSync(raw)) {
    return { workspace: path.resolve(raw), isRepoRoot: false, toplevel: null };
  }
  const workspace = fs.realpathSync(raw);

  // Fast structural check first: no .git entry here means the workspace is not a
  // repository root, whatever an ancestor may contain.
  if (!fs.existsSync(path.join(workspace, '.git'))) {
    return { workspace, isRepoRoot: false, toplevel: null };
  }

  const result = await spawnGit([...CONFIG_PREFIX, lit('rev-parse'), lit('--show-toplevel')], workspace);
  if (result.exitCode !== 0) {
    return { workspace, isRepoRoot: false, toplevel: null };
  }
  const reported = result.stdout.trim();
  if (!reported) return { workspace, isRepoRoot: false, toplevel: null };

  // git's toplevel may itself be a symlinked spelling; realpath both sides.
  let resolvedTop = reported;
  try {
    resolvedTop = fs.realpathSync(reported.replace(/\//g, path.sep));
  } catch {
    /* keep git's spelling; samePath still normalises it */
  }
  return { workspace, isRepoRoot: samePath(resolvedTop, workspace), toplevel: reported };
}

const NOT_A_REPO_HINT =
  'This workspace is not a git repository root. Nothing was run. Initialize one here with code_execute (`git init`) if version control is wanted. Note: a repository in a PARENT directory is deliberately ignored — operating on it would modify history outside this task.';

/** Require a repo root, or refuse with the actionable message above. */
async function requireRepoRoot(taskId: string, projectPath: string | null): Promise<string> {
  const info = await resolveRepoRoot(taskId, projectPath);
  if (!info.isRepoRoot) {
    throw new GitBlockedError(
      info.toplevel && !samePath(info.toplevel, info.workspace)
        ? `${NOT_A_REPO_HINT} (git found a repository at ${info.toplevel}, which is not this workspace.)`
        : NOT_A_REPO_HINT,
    );
  }
  return info.workspace;
}

/* ------------------------------------------------------------------ */
/*  pathspec resolution                                                */
/* ------------------------------------------------------------------ */

/**
 * Turn model-supplied paths into workspace-relative pathspecs.
 *
 * Each path goes through `resolveWithin` — the same primitive FileTool and the
 * archive extractor use, so there is exactly one boundary implementation in the
 * codebase. It realpaths the nearest existing ancestor, which is what defeats a
 * symlink pointing out of the workspace; an escape throws AccessDeniedError and
 * that propagates to the caller unchanged.
 *
 * The absolute result is then made relative to the workspace before it reaches
 * git, so the argv never contains a host absolute path. Separators are normalised
 * to `/` because git accepts POSIX pathspecs on every platform.
 */
function resolvePathspecs(workspace: string, paths: string[]): string[] {
  if (paths.length === 0) return [];
  if (paths.length > MAX_PATHS) {
    throw new GitBlockedError(`git: too many paths (${paths.length}, max ${MAX_PATHS}).`);
  }
  return paths.map((raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new GitBlockedError('git: empty path in paths[].');
    }
    const abs = resolveWithin(workspace, raw);
    const rel = path.relative(workspace, abs);
    // '' means the workspace root itself, which is a legitimate pathspec ('.').
    const spec = rel === '' ? '.' : rel.split(path.sep).join('/');
    if (spec.startsWith('..') || path.posix.isAbsolute(spec)) {
      // resolveWithin should already have thrown; belt and braces.
      throw new GitBlockedError(`git: path escapes the workspace: ${raw}`);
    }
    return spec;
  });
}

function pathTokens(specs: string[]): Token[] {
  if (specs.length === 0) return [];
  // `--` terminates option parsing, so a file literally named `-x` is still a path.
  return [lit('--'), ...specs.map((s) => val(s, 'path'))];
}

/* ------------------------------------------------------------------ */
/*  status parsing                                                     */
/* ------------------------------------------------------------------ */

export interface GitStatusSummary {
  branch: string | null;
  dirtyCount: number;
  staged: number;
  unstaged: number;
  untracked: number;
  lastCommit: { hash: string; subject: string } | null;
  detached: boolean;
}

/**
 * Parse `git status --porcelain=v2 --branch -z`.
 *
 * WHY PORCELAIN v2 AND NOT THE HUMAN OUTPUT: the human format is localised and
 * explicitly unstable across versions; v2 is a documented, version-stable
 * contract. `-z` makes records NUL-delimited, so a filename containing a space,
 * a newline or a quote cannot shift the fields — which the `2 ` (rename) records
 * make load-bearing, since they carry two paths in one record.
 *
 * Record shapes used here:
 *   `# branch.head <name|(detached)>`
 *   `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`          ordinary change
 *   `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <score> <path>` rename/copy,
 *        followed by a SEPARATE NUL-terminated record holding the original path
 *   `? <path>`   untracked
 *   `u <XY> …`   unmerged
 *
 * X is the staged status, Y the unstaged one; `.` means unchanged on that side.
 */
export function parsePorcelainV2(output: string): Omit<GitStatusSummary, 'lastCommit'> {
  const records = output.split('\0');
  let branch: string | null = null;
  let detached = false;
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let tracked = 0;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec) continue;
    if (rec.startsWith('# branch.head ')) {
      const head = rec.slice('# branch.head '.length).trim();
      if (head === '(detached)') {
        detached = true;
        branch = null;
      } else {
        branch = head;
      }
      continue;
    }
    if (rec.startsWith('# ')) continue;

    if (rec.startsWith('1 ') || rec.startsWith('2 ')) {
      const xy = rec.slice(2, 4);
      if (xy[0] && xy[0] !== '.') staged++;
      if (xy[1] && xy[1] !== '.') unstaged++;
      tracked++;
      // A rename record is followed by one extra record: the original path.
      // Consuming it here keeps it from being counted as a second change.
      if (rec.startsWith('2 ')) i++;
      continue;
    }
    if (rec.startsWith('? ')) {
      untracked++;
      continue;
    }
    if (rec.startsWith('u ')) {
      // Unmerged paths are dirty on both sides; count once each so the rail
      // shows a conflict as needing attention rather than as clean.
      staged++;
      unstaged++;
      tracked++;
      continue;
    }
  }

  return { branch, detached, staged, unstaged, untracked, dirtyCount: tracked + untracked };
}

/**
 * Status for the UI rail. Returns null when the workspace is not a repo root, so
 * a caller renders nothing rather than inventing a "clean repository" state for a
 * directory that has no history at all.
 *
 * A missing `git` binary also yields null: the rail is decorative, and failing a
 * page render because the host lacks git would be worse than omitting the rail.
 */
export async function gitStatusSummary(taskId: string, projectPath: string | null): Promise<GitStatusSummary | null> {
  let workspace: string;
  try {
    const info = await resolveRepoRoot(taskId, projectPath);
    if (!info.isRepoRoot) return null;
    workspace = info.workspace;
  } catch {
    return null;
  }

  try {
    const statusOut = await gitOrThrow(
      [...CONFIG_PREFIX, lit('status'), lit('--porcelain=v2'), lit('--branch'), lit('-z')],
      workspace,
      'status',
    );
    const parsed = parsePorcelainV2(statusOut);

    // An unborn HEAD (fresh `git init`) has no commit; `log -1` exits non-zero.
    // That is a normal state, not an error, so lastCommit stays null.
    let lastCommit: { hash: string; subject: string } | null = null;
    const logResult = await spawnGit(
      [...CONFIG_PREFIX, lit('log'), lit('-n'), val('1', 'count'), lit('--no-color'), lit('--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s'), lit('--date=iso-strict')],
      workspace,
    );
    if (logResult.exitCode === 0 && logResult.stdout.trim()) {
      const fields = logResult.stdout.split('\n')[0].split('\x1f');
      if (fields.length >= 5) lastCommit = { hash: fields[1], subject: fields[4] };
    }
    return { ...parsed, lastCommit };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  entry point                                                        */
/* ------------------------------------------------------------------ */

function clampOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return text.slice(0, MAX_OUTPUT_CHARS) + `\n…[truncated ${text.length - MAX_OUTPUT_CHARS} chars]`;
}

/**
 * Second opinion on a ref from git itself, for refs that are full refnames.
 *
 * `check-ref-format` rejects `HEAD` shorthands like `HEAD~1`, so it is consulted
 * only for slash-bearing refnames (`refs/heads/x`, `feature/y`) where its grammar
 * applies. `isValidRef` has already run; this catches the residue (a name ending
 * in `.lock`, a component starting with a dot, etc.) using git's own rules.
 */
async function assertRefAcceptedByGit(ref: string, workspace: string): Promise<void> {
  if (/^HEAD([~^]\d*)*$/.test(ref)) return;
  if (/[~^]/.test(ref)) return; // revision expression, not a refname
  const result = await spawnGit(
    [...CONFIG_PREFIX, lit('check-ref-format'), lit('--allow-onelevel'), val(ref, 'ref')],
    workspace,
  );
  if (result.exitCode !== 0) {
    throw new GitBlockedError(`git: "${ref.slice(0, 60)}" is not a valid ref name.`);
  }
}

/**
 * Run one git operation in the task workspace.
 *
 * `mode` is REQUIRED, not optional, and is the read-only enforcement point. A
 * single tool name cannot be simultaneously listed in WRITE_TOOLS (hard-locked in
 * planning/chat by executeTool) and advertised to planning mode, so the split is
 * made here instead: `git_op` is offered in every mode, and this function refuses
 * a mutating op unless mode === 'build'. Making the parameter required means a new
 * call site cannot silently default to permissive.
 *
 * HONEST SCOPE: this is not a sandbox. git runs as a host process with the
 * workspace as cwd. The guarantees are (a) no shell, (b) a closed argv template
 * set, (c) paths confined by resolveWithin, (d) the workspace must be the repo
 * root. Nothing here prevents the git binary itself from reading the host
 * filesystem, and `code_execute` remains a separate, weaker boundary.
 */
export async function runGitOp(
  taskId: string,
  projectPath: string | null,
  mode: TaskMode,
  args: GitOpArgs,
): Promise<string> {
  if (!isGitOp(args?.op)) {
    throw new GitBlockedError(
      `git: unsupported operation "${String(args?.op)}". Supported: ${GIT_OPS.join(', ')}. Network and history-rewriting operations (push, fetch, pull, reset, clean) are not implemented.`,
    );
  }
  const op = args.op;

  if (GIT_WRITE_OPS.has(op) && mode !== 'build') {
    throw new GitBlockedError(
      `git ${op} mutates the repository and is locked in ${mode} mode. This surface is read-only; the user must enter Work and accept an execution decision first. Read operations (${[...GIT_READ_OPS].join(', ')}) are available.`,
    );
  }

  const workspace = await requireRepoRoot(taskId, projectPath);
  const specs = resolvePathspecs(workspace, Array.isArray(args.paths) ? args.paths : []);

  if (typeof args.ref === 'string' && args.ref.length > 0) {
    if (!isValidRef(args.ref)) {
      throw new GitBlockedError(
        `git: rejected ref "${args.ref.slice(0, 60)}". Refs may contain only letters, digits, ".", "_", "/", "-" and HEAD~n forms, and may not start with "-".`,
      );
    }
    await assertRefAcceptedByGit(args.ref, workspace);
  }

  switch (op) {
    case 'status': {
      const summary = await gitStatusSummary(taskId, projectPath);
      if (!summary) throw new GitError('git status produced no parseable output.');
      const head = summary.detached ? 'HEAD detached' : `branch ${summary.branch ?? '(unborn)'}`;
      const last = summary.lastCommit ? `${summary.lastCommit.hash} ${summary.lastCommit.subject}` : '(no commits yet)';
      const porcelain = await gitOrThrow(
        [...CONFIG_PREFIX, lit('status'), lit('--porcelain=v2'), lit('--branch'), ...pathTokens(specs)],
        workspace,
        'status',
      );
      return clampOutput(
        `${head}\nlast commit: ${last}\nstaged: ${summary.staged}  unstaged: ${summary.unstaged}  untracked: ${summary.untracked}\n\n${porcelain.trim() || '(clean)'}`,
      );
    }

    case 'diff': {
      // Unified diff text, so lib/diff.ts parseUnifiedDiff() renders it. Three
      // context lines and `a/`,`b/` prefixes are git's defaults and are exactly
      // what that parser expects, so no reformatting happens here.
      const tokens: Token[] = [...CONFIG_PREFIX, lit('diff'), lit('--no-color')];
      if (args.staged === true) tokens.push(lit('--staged'));
      if (typeof args.ref === 'string' && args.ref.length > 0) tokens.push(val(args.ref, 'ref'));
      tokens.push(...pathTokens(specs));
      const out = await gitOrThrow(tokens, workspace, 'diff');
      return clampOutput(out.trim() ? out : '(no differences)');
    }

    case 'log': {
      const requested = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : DEFAULT_LOG_LIMIT;
      const limit = Math.min(Math.max(requested, 1), MAX_LOG_LIMIT);
      const tokens: Token[] = [
        ...CONFIG_PREFIX,
        lit('log'),
        lit('--no-color'),
        lit('-n'),
        val(String(limit), 'count'),
        lit('--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s'),
        lit('--date=iso-strict'),
      ];
      if (typeof args.ref === 'string' && args.ref.length > 0) tokens.push(val(args.ref, 'ref'));
      tokens.push(...pathTokens(specs));
      const result = await spawnGit(tokens, workspace);
      if (result.exitCode !== 0) {
        const detail = (result.stderr || '').trim();
        // An unborn HEAD is a normal state for a fresh repo, not a failure.
        if (/does not have any commits yet|unknown revision|bad revision/i.test(detail)) {
          return 'No commits yet.';
        }
        throw new GitError(`git log failed (exit ${result.exitCode}): ${detail.slice(0, 600) || 'no output'}`);
      }
      const lines = result.stdout.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 0) return 'No commits yet.';
      const rendered = lines.map((line) => {
        const [, short, author, date, subject] = line.split('\x1f');
        return `${short}  ${date}  ${author}  ${subject}`;
      });
      return clampOutput(rendered.join('\n'));
    }

    case 'branch': {
      // LIST ONLY. There is no create/delete/rename path: `--list` is the only
      // branch flag in ALLOWED_LITERALS, and no ref is passed, so `git branch`
      // cannot be turned into `git branch -D <x>` from here.
      const out = await gitOrThrow(
        [...CONFIG_PREFIX, lit('branch'), lit('--list'), lit('--no-color')],
        workspace,
        'branch',
      );
      return clampOutput(out.trim() || '(no branches yet)');
    }

    case 'add': {
      if (specs.length === 0) {
        throw new GitBlockedError('git add requires paths[]. Staging everything implicitly is not supported — name the files.');
      }
      await gitOrThrow([...CONFIG_PREFIX, lit('add'), ...pathTokens(specs)], workspace, 'add');
      return `Staged ${specs.length} path${specs.length === 1 ? '' : 's'}: ${specs.join(', ')}`;
    }

    case 'commit': {
      const message = typeof args.message === 'string' ? args.message.trim() : '';
      if (!message) throw new GitBlockedError('git commit requires a message.');
      // `-m <message>` consumes the next argv as the message even if it begins
      // with `-`, so a message of `--author=x` becomes the subject line, not a
      // flag. Identity is supplied with -c so an unconfigured repo still commits.
      // `--no-verify` is deliberate: a repo hook is arbitrary host code the user
      // did not approve for this run, and a failing hook would look like a broken
      // tool. Committing does not run the project's hooks.
      const tokens: Token[] = [
        ...CONFIG_PREFIX,
        ...IDENTITY_PREFIX,
        lit('commit'),
        lit('--no-verify'),
        lit('-m'),
        val(message, 'message'),
        ...pathTokens(specs),
      ];
      const result = await spawnGit(tokens, workspace);
      if (result.exitCode !== 0) {
        const detail = (result.stdout + '\n' + result.stderr).trim();
        if (/nothing to commit|no changes added to commit/i.test(detail)) {
          return 'Nothing to commit — the working tree is clean or nothing is staged. Stage files with the add op first.';
        }
        throw new GitError(`git commit failed (exit ${result.exitCode}): ${detail.slice(0, 600) || 'no output'}`);
      }
      return clampOutput(result.stdout.trim() || 'Commit created.');
    }

    case 'checkout': {
      // Two distinct, both non-destructive-to-history forms:
      //  - with paths: `checkout -- <paths>` restores those files from the index.
      //    It DISCARDS uncommitted changes to exactly those files.
      //  - with a ref and no paths: switch to an existing branch or commit.
      //    `--no-guess` stops git inventing a branch from a remote-tracking name.
      // There is no `-b`, no `-B`, no `--force`: those literals do not exist here.
      if (specs.length > 0) {
        await gitOrThrow([...CONFIG_PREFIX, lit('checkout'), ...pathTokens(specs)], workspace, 'checkout');
        return `Restored ${specs.length} path${specs.length === 1 ? '' : 's'} from the index (uncommitted changes to ${specs.join(', ')} were discarded).`;
      }
      const ref = typeof args.ref === 'string' ? args.ref : '';
      if (!ref) throw new GitBlockedError('git checkout requires either paths[] to restore or a ref to switch to.');
      const result = await spawnGit([...CONFIG_PREFIX, lit('checkout'), lit('--no-guess'), val(ref, 'ref'), lit('--')], workspace);
      if (result.exitCode !== 0) {
        throw new GitError(`git checkout failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).trim().slice(0, 600)}`);
      }
      return clampOutput(`Switched to ${ref}.\n${(result.stderr || result.stdout).trim()}`.trim());
    }

    case 'revert': {
      // THE SAFE KIND ONLY, and precisely two behaviours:
      //  - paths[] given: `git checkout -- <paths>` — restore those files from the
      //    index, discarding uncommitted working-tree edits to them. History is
      //    untouched; other files are untouched.
      //  - ref given: `git revert --no-commit <ref>` — apply the inverse of that
      //    commit into the working tree and index, leaving it UNCOMMITTED for
      //    review. The original commit stays in history.
      // `reset --hard` is not implemented: it would silently destroy every
      // uncommitted change in the workspace, including work the task never made.
      if (specs.length > 0) {
        await gitOrThrow([...CONFIG_PREFIX, lit('checkout'), ...pathTokens(specs)], workspace, 'revert (path restore)');
        return `Discarded uncommitted changes to ${specs.length} path${specs.length === 1 ? '' : 's'} (${specs.join(', ')}) by restoring from the index. History unchanged.`;
      }
      const ref = typeof args.ref === 'string' ? args.ref : '';
      if (!ref) {
        throw new GitBlockedError(
          'git revert requires either paths[] (discard uncommitted changes to those files) or a ref (stage the inverse of that commit, uncommitted).',
        );
      }
      const result = await spawnGit(
        [...CONFIG_PREFIX, ...IDENTITY_PREFIX, lit('revert'), lit('--no-commit'), val(ref, 'ref')],
        workspace,
      );
      if (result.exitCode !== 0) {
        throw new GitError(
          `git revert --no-commit ${ref} failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).trim().slice(0, 600)}`,
        );
      }
      return clampOutput(
        `Reverted ${ref} into the working tree and index WITHOUT committing. Review with the diff op, then commit. The original commit remains in history.\n${(result.stdout || '').trim()}`.trim(),
      );
    }
  }
}

