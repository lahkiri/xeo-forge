/**
 * Git integration tests — real git, real temporary repositories.
 *
 * Nothing here is mocked. Every assertion runs the actual `git` binary against a
 * throwaway repo created under os.tmpdir(), because the properties being tested
 * (argv is not a shell, a parent repo is refused, `-m` swallows a flag-shaped
 * message) are properties of git's real behaviour. A mock would assert this
 * module's assumptions rather than git's semantics.
 *
 * Paths use os.tmpdir() + path.join throughout: the suite runs on Windows.
 *
 * The whole file skips — never fails — when git is absent from PATH. Detection
 * happens once in beforeAll.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  runGitOp,
  gitStatusSummary,
  resolveRepoRoot,
  parsePorcelainV2,
  isValidRef,
  isGitOp,
  GIT_OPS,
  GIT_READ_OPS,
  GIT_WRITE_OPS,
  GitBlockedError,
  GIT_AUTHOR_NAME,
  GIT_AUTHOR_EMAIL,
  type GitOp,
} from '../lib/agent/git';
import { AccessDeniedError } from '../lib/agent/files';
import { parseUnifiedDiff } from '../lib/diff';

const execFileAsync = promisify(execFile);

/** Detected once. `false` skips every git-dependent test rather than failing. */
let gitAvailable = false;

beforeAll(async () => {
  try {
    await execFileAsync('git', ['--version'], { timeout: 10_000 });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
});

/* ───────────────────────── temp workspace plumbing ───────────────────────── */

/**
 * runGitOp derives its cwd from workspaceFor(taskId), i.e. TASK_WORK_DIR/<taskId>
 * (vitest.config.ts pins TASK_WORK_DIR). So a "workspace" here is a directory
 * created at exactly that path, and taskId is what the tests vary.
 */
const WORK_ROOT = process.env.TASK_WORK_DIR || path.join(os.tmpdir(), 'xeo-tasks');

const created: string[] = [];

function makeTaskId(label: string): string {
  return `git-test-${label}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

function workspacePath(taskId: string): string {
  return path.join(WORK_ROOT, taskId);
}

function makeWorkspace(label: string): { taskId: string; dir: string } {
  const taskId = makeTaskId(label);
  const dir = workspacePath(taskId);
  fs.mkdirSync(dir, { recursive: true });
  created.push(dir);
  return { taskId, dir };
}

/** Independent temp dir (used for the parent-repo case, which needs a wrapper). */
function makeTempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xeo-git-${label}-`));
  created.push(dir);
  return dir;
}

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: dir,
    timeout: 20_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout;
}

/**
 * git init + local identity + one commit, so HEAD exists.
 *
 * `core.autocrlf=false` is pinned deliberately. Git for Windows ships
 * `core.autocrlf=true` in its SYSTEM config, so a checkout would rewrite the LF
 * bytes in the index to CRLF in the working tree — real, correct git behaviour
 * that lib/agent/git.ts must not override, since overriding a user's line-ending
 * policy would corrupt their files. Pinning it here makes the fixture's own bytes
 * deterministic so the assertions can stay exact on both platforms.
 */
async function initRepo(dir: string, firstFile = 'a.txt', content = 'v1\n'): Promise<void> {
  await git(dir, ['init', '--initial-branch=main']);
  await git(dir, ['config', 'user.name', 'Test Fixture']);
  await git(dir, ['config', 'user.email', 'fixture@test.local']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await git(dir, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(dir, firstFile), content, 'utf8');
  await git(dir, ['add', '--', firstFile]);
  await git(dir, ['commit', '-m', 'initial commit']);
}

afterEach(async () => {
  while (created.length) {
    const dir = created.pop()!;
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
});

/* ───────────────────────── op surface (no git needed) ───────────────────────── */

describe('op vocabulary is closed', () => {
  it('exposes exactly the eight documented ops', () => {
    expect([...GIT_OPS].sort()).toEqual(
      ['add', 'branch', 'checkout', 'commit', 'diff', 'log', 'revert', 'status'].sort(),
    );
  });

  it('partitions ops into read and write with no overlap and no gaps', () => {
    for (const op of GIT_OPS) {
      expect(GIT_READ_OPS.has(op) !== GIT_WRITE_OPS.has(op)).toBe(true);
    }
    expect([...GIT_READ_OPS].sort()).toEqual(['branch', 'diff', 'log', 'status']);
    expect([...GIT_WRITE_OPS].sort()).toEqual(['add', 'checkout', 'commit', 'revert']);
  });

  it('does not contain push, fetch, pull, reset, clean, gc, or remote', () => {
    for (const forbidden of ['push', 'fetch', 'pull', 'reset', 'clean', 'gc', 'filter-branch', 'remote', 'stash']) {
      expect(isGitOp(forbidden)).toBe(false);
      expect((GIT_OPS as readonly string[]).includes(forbidden)).toBe(false);
    }
  });

  it('rejects an unknown op at the entry point rather than passing it to git', async () => {
    const { taskId } = makeWorkspace('unknown-op');
    for (const forbidden of ['push', 'fetch', 'pull', 'reset', 'clean']) {
      await expect(
        runGitOp(taskId, null, 'build', { op: forbidden as GitOp }),
      ).rejects.toThrow(GitBlockedError);
    }
    await expect(runGitOp(taskId, null, 'build', { op: undefined as unknown as GitOp })).rejects.toThrow(GitBlockedError);
  });
});

describe('isValidRef', () => {
  it('accepts ordinary refs and HEAD forms', () => {
    for (const ref of ['HEAD', 'HEAD~1', 'HEAD~10', 'main', 'feature/x', 'v1.2.3', 'refs/heads/main', 'abc123def', 'HEAD^']) {
      expect(isValidRef(ref)).toBe(true);
    }
  });

  it('rejects flag-shaped refs — the argv smuggling case', () => {
    for (const ref of ['--force', '-f', '--upload-pack=evil', '--exec=whoami', '-']) {
      expect(isValidRef(ref)).toBe(false);
    }
  });

  it('rejects range, reflog, refspec, glob and traversal syntax', () => {
    for (const ref of ['a..b', 'a...b', '../etc', 'HEAD@{1}', 'origin:main', 'refs/*', 'a?b', 'a[b', 'a\\b', 'main/', 'main.lock', 'a//b', '']) {
      expect(isValidRef(ref)).toBe(false);
    }
  });

  it('rejects whitespace and control characters', () => {
    for (const ref of ['main branch', 'main\nx', 'main\tx', 'main\x00x']) {
      expect(isValidRef(ref)).toBe(false);
    }
  });
});

describe('parsePorcelainV2', () => {
  it('counts staged, unstaged and untracked from NUL-delimited records', () => {
    const out = [
      '# branch.oid abc123',
      '# branch.head main',
      '1 .M N... 100644 100644 100644 aaa bbb modified.txt',
      '1 A. N... 000000 100644 100644 000 ccc staged.txt',
      '1 MM N... 100644 100644 100644 ddd eee both.txt',
      '? untracked.txt',
      '',
    ].join('\0');
    const parsed = parsePorcelainV2(out);
    expect(parsed.branch).toBe('main');
    expect(parsed.detached).toBe(false);
    expect(parsed.staged).toBe(2); // staged.txt + both.txt
    expect(parsed.unstaged).toBe(2); // modified.txt + both.txt
    expect(parsed.untracked).toBe(1);
    expect(parsed.dirtyCount).toBe(4);
  });

  it('treats a rename record and its trailing original-path record as ONE change', () => {
    const out = [
      '# branch.head main',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.txt',
      'old.txt',
      '',
    ].join('\0');
    const parsed = parsePorcelainV2(out);
    expect(parsed.staged).toBe(1);
    expect(parsed.unstaged).toBe(0);
    expect(parsed.dirtyCount).toBe(1);
  });

  it('reports a detached HEAD with a null branch', () => {
    const parsed = parsePorcelainV2(['# branch.oid abc', '# branch.head (detached)', ''].join('\0'));
    expect(parsed.detached).toBe(true);
    expect(parsed.branch).toBeNull();
  });

  it('counts an unmerged path as dirty on both sides', () => {
    const parsed = parsePorcelainV2(['# branch.head main', 'u UU N... 100644 100644 100644 100644 a b c conflict.txt', ''].join('\0'));
    expect(parsed.staged).toBe(1);
    expect(parsed.unstaged).toBe(1);
    expect(parsed.dirtyCount).toBe(1);
  });
});

/* ───────────────────────── repository boundary ───────────────────────── */

/** Normalise a path for comparison the way lib/agent/git.ts does internally. */
function normPath(p: string): string {
  const out = path.resolve(p.replace(/\//g, path.sep));
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

describe('repository boundary', () => {
  it('refuses every op when the workspace is not a repository root', async () => {
    if (!gitAvailable) return;
    // NOTE: WORK_ROOT lives inside the xeo-forge checkout, so this bare directory
    // genuinely has a git repository above it. The refusal below is therefore not
    // theoretical — it is the parent-capture case in its mildest form.
    const { taskId } = makeWorkspace('no-repo');
    const info = await resolveRepoRoot(taskId, null);
    expect(info.isRepoRoot).toBe(false);
    expect(info.toplevel).toBeNull(); // short-circuited on the missing .git

    await expect(runGitOp(taskId, null, 'build', { op: 'status' })).rejects.toThrow(GitBlockedError);
    await expect(runGitOp(taskId, null, 'build', { op: 'log' })).rejects.toThrow(GitBlockedError);
    expect(await gitStatusSummary(taskId, null)).toBeNull();
  });

  it('refuses to act on a repository owned by a PARENT directory', async () => {
    if (!gitAvailable) return;
    // root/ is a real repo with real history; root/sub/ is the task workspace and
    // has no .git of its own. Plain git walks UP and would happily commit to, or
    // revert, root's history. That is what must be refused.
    const parentId = makeTaskId('parent-repo');
    const root = workspacePath(parentId);
    fs.mkdirSync(root, { recursive: true });
    created.push(root);
    await initRepo(root, 'parent-file.txt', 'parent v1\n');

    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'child.txt'), 'child\n', 'utf8');
    const subTaskId = `${parentId}/sub`;

    // Prove the parent repo IS reachable from the workspace, so the assertions
    // below refuse something real rather than something already impossible.
    const seen = (await git(sub, ['rev-parse', '--show-toplevel'])).trim();
    expect(normPath(fs.realpathSync(seen))).toBe(normPath(fs.realpathSync(root)));

    expect((await resolveRepoRoot(subTaskId, null)).isRepoRoot).toBe(false);
    expect(await gitStatusSummary(subTaskId, null)).toBeNull();
    for (const args of [
      { op: 'status' as GitOp },
      { op: 'log' as GitOp },
      { op: 'diff' as GitOp },
      { op: 'branch' as GitOp },
      { op: 'add' as GitOp, paths: ['child.txt'] },
      { op: 'commit' as GitOp, message: 'should never happen' },
      { op: 'revert' as GitOp, ref: 'HEAD' },
      { op: 'checkout' as GitOp, ref: 'main' },
    ]) {
      await expect(runGitOp(subTaskId, null, 'build', args)).rejects.toThrow(GitBlockedError);
    }

    // The parent's history and working tree are untouched: still exactly one
    // commit, and nothing staged.
    const log = await git(root, ['log', '--oneline']);
    expect(log.trim().split('\n')).toHaveLength(1);
    expect(log).toContain('initial commit');
    const staged = await git(root, ['diff', '--cached', '--name-only']);
    expect(staged.trim()).toBe('');
    expect(fs.readFileSync(path.join(root, 'parent-file.txt'), 'utf8')).toBe('parent v1\n');
  });
});

/* ───────────────────────── read ops, real repo ───────────────────────── */

describe('read ops against a real repository', () => {
  let taskId = '';
  let dir = '';

  beforeEach(async () => {
    if (!gitAvailable) return;
    const ws = makeWorkspace('read-ops');
    taskId = ws.taskId;
    dir = ws.dir;
    await initRepo(dir);
    // One tracked modification and one untracked file, so every counter is
    // exercised with a non-zero value.
    fs.writeFileSync(path.join(dir, 'a.txt'), 'v1\nv2\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'new.txt'), 'brand new\n', 'utf8');
  });

  it('reports branch, counts and the last commit through gitStatusSummary', async () => {
    if (!gitAvailable) return;
    const summary = await gitStatusSummary(taskId, null);
    expect(summary).not.toBeNull();
    expect(summary!.branch).toBe('main');
    expect(summary!.detached).toBe(false);
    expect(summary!.unstaged).toBe(1);
    expect(summary!.staged).toBe(0);
    expect(summary!.untracked).toBe(1);
    expect(summary!.dirtyCount).toBe(2);
    expect(summary!.lastCommit).not.toBeNull();
    expect(summary!.lastCommit!.subject).toBe('initial commit');
    expect(summary!.lastCommit!.hash).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('status op renders the branch, the counters and porcelain records', async () => {
    if (!gitAvailable) return;
    const out = await runGitOp(taskId, null, 'build', { op: 'status' });
    expect(out).toContain('branch main');
    expect(out).toContain('unstaged: 1');
    expect(out).toContain('untracked: 1');
    expect(out).toContain('a.txt');
  });

  it('diff op returns real unified diff text that lib/diff.ts can parse', async () => {
    if (!gitAvailable) return;
    const out = await runGitOp(taskId, null, 'build', { op: 'diff' });
    // The exact markers parseUnifiedDiff() keys on.
    expect(out).toContain('diff --git');
    expect(out).toMatch(/^--- a\/a\.txt$/m);
    expect(out).toMatch(/^\+\+\+ b\/a\.txt$/m);
    expect(out).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m);
    expect(out).toMatch(/^\+v2$/m);
    // No ANSI escapes: --no-color is in the template.
    expect(out).not.toMatch(/\x1b\[/);

    const parsed = parseUnifiedDiff(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].newPath).toBe('a.txt');
    expect(parsed[0].additions).toBe(1);
    expect(parsed[0].deletions).toBe(0);
  });

  it('diff --staged sees the index, not the working tree', async () => {
    if (!gitAvailable) return;
    await git(dir, ['add', '--', 'a.txt']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'v1\nv2\nv3\n', 'utf8');

    const stagedOut = await runGitOp(taskId, null, 'build', { op: 'diff', staged: true });
    expect(stagedOut).toMatch(/^\+v2$/m);
    expect(stagedOut).not.toMatch(/^\+v3$/m);

    const worktreeOut = await runGitOp(taskId, null, 'build', { op: 'diff' });
    expect(worktreeOut).toMatch(/^\+v3$/m);
    expect(worktreeOut).not.toMatch(/^\+v2$/m);
  });

  it('diff narrowed by paths ignores other files', async () => {
    if (!gitAvailable) return;
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n', 'utf8');
    await git(dir, ['add', '--', 'b.txt']);
    await git(dir, ['commit', '-m', 'add b']);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\nb2\n', 'utf8');

    const out = await runGitOp(taskId, null, 'build', { op: 'diff', paths: ['b.txt'] });
    expect(out).toContain('b.txt');
    expect(out).not.toContain('a.txt');
  });

  it('log op renders one line per commit and honours limit clamping', async () => {
    if (!gitAvailable) return;
    for (let i = 2; i <= 4; i++) {
      fs.writeFileSync(path.join(dir, `f${i}.txt`), `f${i}\n`, 'utf8');
      await git(dir, ['add', '--', `f${i}.txt`]);
      await git(dir, ['commit', '-m', `commit ${i}`]);
    }
    const all = await runGitOp(taskId, null, 'build', { op: 'log' });
    expect(all.split('\n')).toHaveLength(4); // default limit 20 > 4 commits
    expect(all).toContain('commit 4');
    expect(all).toContain('initial commit');

    const two = await runGitOp(taskId, null, 'build', { op: 'log', limit: 2 });
    expect(two.split('\n')).toHaveLength(2);
    expect(two).toContain('commit 4');
    expect(two).not.toContain('initial commit');

    // Out-of-range limits clamp instead of erroring or passing through.
    expect((await runGitOp(taskId, null, 'build', { op: 'log', limit: 0 })).split('\n')).toHaveLength(1);
    expect((await runGitOp(taskId, null, 'build', { op: 'log', limit: 9999 })).split('\n')).toHaveLength(4);
    expect((await runGitOp(taskId, null, 'build', { op: 'log', limit: -5 })).split('\n')).toHaveLength(1);
  });

  it('branch op lists branches and cannot delete one', async () => {
    if (!gitAvailable) return;
    await git(dir, ['branch', 'other']);
    const out = await runGitOp(taskId, null, 'build', { op: 'branch' });
    expect(out).toContain('main');
    expect(out).toContain('other');
    // A ref is accepted by the arg shape but ignored by the branch template, so
    // `branch` can never become `branch -D <x>`.
    const withRef = await runGitOp(taskId, null, 'build', { op: 'branch', ref: 'other' });
    expect(withRef).toContain('other');
    expect((await git(dir, ['branch', '--list'])).trim()).toContain('other');
  });

  it('reports an unborn HEAD as a normal state, not a failure', async () => {
    if (!gitAvailable) return;
    const fresh = makeWorkspace('unborn');
    await git(fresh.dir, ['init', '--initial-branch=main']);
    const summary = await gitStatusSummary(fresh.taskId, null);
    expect(summary).not.toBeNull();
    expect(summary!.lastCommit).toBeNull();
    expect(await runGitOp(fresh.taskId, null, 'build', { op: 'log' })).toBe('No commits yet.');
  });
});

/* ───────────────────────── write ops, real repo ───────────────────────── */

describe('write ops against a real repository', () => {
  let taskId = '';
  let dir = '';

  beforeEach(async () => {
    if (!gitAvailable) return;
    const ws = makeWorkspace('write-ops');
    taskId = ws.taskId;
    dir = ws.dir;
    await initRepo(dir);
  });

  it('add stages exactly the named paths and nothing else', async () => {
    if (!gitAvailable) return;
    fs.writeFileSync(path.join(dir, 'wanted.txt'), 'wanted\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'ignored.txt'), 'ignored\n', 'utf8');

    const out = await runGitOp(taskId, null, 'build', { op: 'add', paths: ['wanted.txt'] });
    expect(out).toContain('wanted.txt');

    const staged = (await git(dir, ['diff', '--cached', '--name-only'])).trim().split('\n');
    expect(staged).toEqual(['wanted.txt']);
  });

  it('add refuses an empty paths[] rather than staging everything', async () => {
    if (!gitAvailable) return;
    fs.writeFileSync(path.join(dir, 'sneaky.txt'), 'sneaky\n', 'utf8');
    await expect(runGitOp(taskId, null, 'build', { op: 'add' })).rejects.toThrow(GitBlockedError);
    await expect(runGitOp(taskId, null, 'build', { op: 'add', paths: [] })).rejects.toThrow(GitBlockedError);
    expect((await git(dir, ['diff', '--cached', '--name-only'])).trim()).toBe('');
  });

  it('commit records the agent identity supplied with -c, not repo config', async () => {
    if (!gitAvailable) return;
    // The fixture configured a different identity; the -c flags must win, and the
    // repo config must be left alone.
    fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n', 'utf8');
    await runGitOp(taskId, null, 'build', { op: 'add', paths: ['c.txt'] });
    await runGitOp(taskId, null, 'build', { op: 'commit', message: 'agent commit' });

    const meta = (await git(dir, ['log', '-1', '--pretty=format:%an%x1f%ae%x1f%s'])).split('\x1f');
    expect(meta[0]).toBe(GIT_AUTHOR_NAME);
    expect(meta[1]).toBe(GIT_AUTHOR_EMAIL);
    expect(meta[2]).toBe('agent commit');
    expect((await git(dir, ['config', 'user.name'])).trim()).toBe('Test Fixture');
  });

  it('commit reports "nothing to commit" instead of throwing on a clean tree', async () => {
    if (!gitAvailable) return;
    const out = await runGitOp(taskId, null, 'build', { op: 'commit', message: 'empty' });
    expect(out).toMatch(/nothing to commit/i);
    expect((await git(dir, ['log', '--oneline'])).trim().split('\n')).toHaveLength(1);
  });

  it('commit requires a non-empty message', async () => {
    if (!gitAvailable) return;
    for (const message of ['', '   ', undefined]) {
      await expect(
        runGitOp(taskId, null, 'build', { op: 'commit', message: message as string | undefined }),
      ).rejects.toThrow(GitBlockedError);
    }
  });

  it('revert with paths[] restores those files from the index and leaves history alone', async () => {
    if (!gitAvailable) return;
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep v1\n', 'utf8');
    await git(dir, ['add', '--', 'keep.txt']);
    await git(dir, ['commit', '-m', 'add keep']);

    fs.writeFileSync(path.join(dir, 'a.txt'), 'CLOBBERED\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep v2\n', 'utf8');

    const out = await runGitOp(taskId, null, 'build', { op: 'revert', paths: ['a.txt'] });
    expect(out).toMatch(/History unchanged/i);
    // Only the named file is restored; the other edit survives.
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('v1\n');
    expect(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8')).toBe('keep v2\n');
    expect((await git(dir, ['log', '--oneline'])).trim().split('\n')).toHaveLength(2);
  });

  it('revert with a ref stages the inverse UNCOMMITTED and keeps the original commit', async () => {
    if (!gitAvailable) return;
    fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature\n', 'utf8');
    await git(dir, ['add', '--', 'feature.txt']);
    await git(dir, ['commit', '-m', 'add feature']);
    const headBefore = (await git(dir, ['rev-parse', 'HEAD'])).trim();

    const out = await runGitOp(taskId, null, 'build', { op: 'revert', ref: 'HEAD' });
    expect(out).toMatch(/WITHOUT committing/);

    // The file is gone from the tree, but HEAD has NOT moved and no new commit
    // exists — this is the --no-commit contract.
    expect(fs.existsSync(path.join(dir, 'feature.txt'))).toBe(false);
    expect((await git(dir, ['rev-parse', 'HEAD'])).trim()).toBe(headBefore);
    expect((await git(dir, ['log', '--oneline'])).trim().split('\n')).toHaveLength(2);
    expect((await git(dir, ['diff', '--cached', '--name-only'])).trim()).toBe('feature.txt');
  });

  it('revert requires either paths[] or a ref', async () => {
    if (!gitAvailable) return;
    await expect(runGitOp(taskId, null, 'build', { op: 'revert' })).rejects.toThrow(GitBlockedError);
  });

  it('checkout with paths[] restores from the index; with a ref it switches', async () => {
    if (!gitAvailable) return;
    fs.writeFileSync(path.join(dir, 'a.txt'), 'dirty\n', 'utf8');
    await runGitOp(taskId, null, 'build', { op: 'checkout', paths: ['a.txt'] });
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('v1\n');

    await git(dir, ['branch', 'side']);
    const out = await runGitOp(taskId, null, 'build', { op: 'checkout', ref: 'side' });
    expect(out).toContain('side');
    expect((await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('side');
  });

  it('checkout requires either paths[] or a ref', async () => {
    if (!gitAvailable) return;
    await expect(runGitOp(taskId, null, 'build', { op: 'checkout' })).rejects.toThrow(GitBlockedError);
  });

  it('full add → commit → modify → diff → revert cycle behaves as documented', async () => {
    if (!gitAvailable) return;
    fs.writeFileSync(path.join(dir, 'cycle.txt'), 'one\n', 'utf8');
    await runGitOp(taskId, null, 'build', { op: 'add', paths: ['cycle.txt'] });
    await runGitOp(taskId, null, 'build', { op: 'commit', message: 'cycle: add' });

    fs.writeFileSync(path.join(dir, 'cycle.txt'), 'one\ntwo\n', 'utf8');
    const diff = await runGitOp(taskId, null, 'build', { op: 'diff' });
    expect(diff).toMatch(/^\+two$/m);

    await runGitOp(taskId, null, 'build', { op: 'revert', paths: ['cycle.txt'] });
    expect(fs.readFileSync(path.join(dir, 'cycle.txt'), 'utf8')).toBe('one\n');
    expect(await runGitOp(taskId, null, 'build', { op: 'diff' })).toBe('(no differences)');

    const log = await runGitOp(taskId, null, 'build', { op: 'log' });
    expect(log).toContain('cycle: add');
    expect(log).toContain(GIT_AUTHOR_NAME);
  });
});

/* ───────────────────────── adversarial input ───────────────────────── */

describe('adversarial input against a real repository', () => {
  let taskId = '';
  let dir = '';

  beforeEach(async () => {
    if (!gitAvailable) return;
    const ws = makeWorkspace('adversarial');
    taskId = ws.taskId;
    dir = ws.dir;
    await initRepo(dir);
  });

  it('rejects a traversal pathspec (../../etc/passwd)', async () => {
    if (!gitAvailable) return;
    for (const bad of ['../../etc/passwd', '../outside.txt', 'sub/../../escape.txt', '..']) {
      await expect(runGitOp(taskId, null, 'build', { op: 'add', paths: [bad] })).rejects.toThrow(
        /AccessDenied|escapes|traversal|outside/i,
      );
    }
    // Rejected before git ran: nothing staged.
    expect((await git(dir, ['diff', '--cached', '--name-only'])).trim()).toBe('');
  });

  it('rejects an absolute path outside the workspace', async () => {
    if (!gitAvailable) return;
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/passwd';
    await expect(runGitOp(taskId, null, 'build', { op: 'add', paths: [outside] })).rejects.toThrow(AccessDeniedError);
    await expect(runGitOp(taskId, null, 'build', { op: 'diff', paths: [outside] })).rejects.toThrow(AccessDeniedError);
    await expect(runGitOp(taskId, null, 'build', { op: 'revert', paths: [outside] })).rejects.toThrow(AccessDeniedError);
  });

  it('rejects a flag-shaped ref on every op that takes one', async () => {
    if (!gitAvailable) return;
    const hostile = ['--force', '-f', '--upload-pack=evil', '--exec=whoami', '--hard', '-'];
    for (const ref of hostile) {
      for (const op of ['diff', 'log', 'checkout', 'revert'] as GitOp[]) {
        await expect(runGitOp(taskId, null, 'build', { op, ref })).rejects.toThrow(GitBlockedError);
      }
    }
    // History intact, HEAD unmoved.
    expect((await git(dir, ['log', '--oneline'])).trim().split('\n')).toHaveLength(1);
  });

  it('rejects range, reflog and refspec syntax in a ref', async () => {
    if (!gitAvailable) return;
    for (const ref of ['HEAD..HEAD', 'main...side', 'HEAD@{1}', 'origin:main', '../etc', 'refs/*']) {
      await expect(runGitOp(taskId, null, 'build', { op: 'log', ref })).rejects.toThrow(GitBlockedError);
    }
  });

  it('treats a flag-shaped commit message as a message, not an argument', async () => {
    if (!gitAvailable) return;
    // `-m <msg>` consumes the next argv verbatim. The subject must be the literal
    // text and the author must remain the agent identity — no --author injection.
    fs.writeFileSync(path.join(dir, 'm.txt'), 'm\n', 'utf8');
    await runGitOp(taskId, null, 'build', { op: 'add', paths: ['m.txt'] });
    await runGitOp(taskId, null, 'build', { op: 'commit', message: '--author=attacker <evil@example.com>' });

    const meta = (await git(dir, ['log', '-1', '--pretty=format:%an%x1f%ae%x1f%s'])).split('\x1f');
    expect(meta[0]).toBe(GIT_AUTHOR_NAME);
    expect(meta[1]).toBe(GIT_AUTHOR_EMAIL);
    expect(meta[2]).toBe('--author=attacker <evil@example.com>');
  });

  it('treats shell metacharacters in a message as literal text', async () => {
    if (!gitAvailable) return;
    // There is no shell, so this is a subject line and not a command.
    const nasty = 'fix: $(touch pwned) `touch pwned2` ; rm -rf / && echo x | tee y';
    fs.writeFileSync(path.join(dir, 's.txt'), 's\n', 'utf8');
    await runGitOp(taskId, null, 'build', { op: 'add', paths: ['s.txt'] });
    await runGitOp(taskId, null, 'build', { op: 'commit', message: nasty });

    expect((await git(dir, ['log', '-1', '--pretty=format:%s'])).trim()).toBe(nasty);
    expect(fs.existsSync(path.join(dir, 'pwned'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'pwned2'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'y'))).toBe(false);
  });

  it('cannot reach push, fetch, pull, reset or clean through any argument', async () => {
    if (!gitAvailable) return;
    // Every plausible injection vector for a forbidden verb: the op slot, the ref
    // slot, and the paths slot. None reaches git as a verb.
    const forbidden = ['push', 'fetch', 'pull', 'reset', 'clean', 'gc', 'filter-branch', 'remote', 'stash'];
    for (const verb of forbidden) {
      await expect(runGitOp(taskId, null, 'build', { op: verb as GitOp })).rejects.toThrow(GitBlockedError);
      await expect(runGitOp(taskId, null, 'build', { op: 'log', ref: `--${verb}` })).rejects.toThrow(GitBlockedError);
    }
    // A remote was never configured and cannot be: no `remote` literal exists.
    expect((await git(dir, ['remote'])).trim()).toBe('');
    // Still exactly the fixture commit — nothing mutated history along the way.
    expect((await git(dir, ['log', '--oneline'])).trim().split('\n')).toHaveLength(1);
  });

  it('locks every write op in chat and planning mode, and allows every read op', async () => {
    if (!gitAvailable) return;
    fs.writeFileSync(path.join(dir, 'locked.txt'), 'locked\n', 'utf8');
    for (const mode of ['chat', 'planning'] as const) {
      await expect(runGitOp(taskId, null, mode, { op: 'add', paths: ['locked.txt'] })).rejects.toThrow(GitBlockedError);
      await expect(runGitOp(taskId, null, mode, { op: 'commit', message: 'nope' })).rejects.toThrow(GitBlockedError);
      await expect(runGitOp(taskId, null, mode, { op: 'revert', ref: 'HEAD' })).rejects.toThrow(GitBlockedError);
      await expect(runGitOp(taskId, null, mode, { op: 'checkout', ref: 'main' })).rejects.toThrow(GitBlockedError);

      // Reads still work, so inspection is never blocked by the write lock.
      await expect(runGitOp(taskId, null, mode, { op: 'status' })).resolves.toContain('branch main');
      await expect(runGitOp(taskId, null, mode, { op: 'log' })).resolves.toContain('initial commit');
      await expect(runGitOp(taskId, null, mode, { op: 'diff' })).resolves.toBeTypeOf('string');
      await expect(runGitOp(taskId, null, mode, { op: 'branch' })).resolves.toContain('main');
    }
    // Nothing was staged or committed by any of the refused calls.
    expect((await git(dir, ['diff', '--cached', '--name-only'])).trim()).toBe('');
    expect((await git(dir, ['log', '--oneline'])).trim().split('\n')).toHaveLength(1);
  });

  it('rejects a NUL byte and an over-long message', async () => {
    if (!gitAvailable) return;
    await expect(runGitOp(taskId, null, 'build', { op: 'commit', message: 'a\0b' })).rejects.toThrow(GitBlockedError);
    await expect(runGitOp(taskId, null, 'build', { op: 'commit', message: 'x'.repeat(4001) })).rejects.toThrow(
      GitBlockedError,
    );
  });

  it('rejects an oversized paths[] and an empty path entry', async () => {
    if (!gitAvailable) return;
    await expect(
      runGitOp(taskId, null, 'build', { op: 'add', paths: Array.from({ length: 101 }, (_, i) => `f${i}.txt`) }),
    ).rejects.toThrow(GitBlockedError);
    await expect(runGitOp(taskId, null, 'build', { op: 'add', paths: ['   '] })).rejects.toThrow(GitBlockedError);
  });

  it('treats a file whose name looks like a flag as a path, thanks to --', async () => {
    if (!gitAvailable) return;
    // A path slot rejects a leading `-` outright, so the flag-shaped name is
    // refused rather than being handed to git as an option.
    await expect(runGitOp(taskId, null, 'build', { op: 'add', paths: ['-rf'] })).rejects.toThrow();
    // A legitimate nested path still works, proving the rejection is targeted.
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nested', 'ok.txt'), 'ok\n', 'utf8');
    const out = await runGitOp(taskId, null, 'build', { op: 'add', paths: ['nested/ok.txt'] });
    expect(out).toContain('nested/ok.txt');
    expect((await git(dir, ['diff', '--cached', '--name-only'])).trim()).toBe('nested/ok.txt');
  });
});

/* ───────────────────────── environment ───────────────────────── */

describe('child environment', () => {
  it('does not leak platform secrets into the git child process', async () => {
    if (!gitAvailable) return;
    // buildSafeEnv is shared with code_execute; this asserts the reuse holds for
    // git too. MODEL_API_KEY is set here and must not survive into the child.
    const { taskId, dir } = makeWorkspace('env');
    await initRepo(dir);
    const previous = process.env.MODEL_API_KEY;
    process.env.MODEL_API_KEY = 'sk-should-not-leak';
    try {
      const out = await runGitOp(taskId, null, 'build', { op: 'status' });
      expect(out).not.toContain('sk-should-not-leak');
    } finally {
      if (previous === undefined) delete process.env.MODEL_API_KEY;
      else process.env.MODEL_API_KEY = previous;
    }
  });
});

/* ───────────────────────── structured events ───────────────────────── */

import { readGitStatus, readGitCommit } from '../lib/agent/events';
import type { GitEventSink } from '../lib/agent/git';

describe('structured git events (injected sink)', () => {
  it('status op emits a git_status payload the events reader understands', async () => {
    if (!gitAvailable) return;
    const { taskId, dir } = makeWorkspace('emit-status');
    await initRepo(dir);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'new\n', 'utf8'); // untracked

    const emitted: Array<{ type: string; content: Record<string, unknown> }> = [];
    const sink: GitEventSink = async (type, content) => {
      emitted.push({ type, content });
    };
    await runGitOp(taskId, null, 'build', { op: 'status' }, sink);

    const statusEvents = emitted.filter((e) => e.type === 'git_status');
    expect(statusEvents).toHaveLength(1);
    // The payload must satisfy the typed reader from the event registry — the
    // reader is the contract between git.ts and every consumer of the event.
    const payload = readGitStatus(statusEvents[0].content);
    expect(payload.branch).toBe('main');
    expect(payload.detached).toBe(false);
    expect(payload.dirtyCount).toBe(1); // the untracked file
    expect(payload.untracked).toBe(1);
    expect(payload.lastCommitHash).toBeTruthy();
    expect(payload.lastCommitSubject).toBe('initial commit');
  });

  it('commit op emits a git_commit payload with the real post-commit hash', async () => {
    if (!gitAvailable) return;
    const { taskId, dir } = makeWorkspace('emit-commit');
    await initRepo(dir);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'v2\n', 'utf8');
    await runGitOp(taskId, null, 'build', { op: 'add', paths: ['a.txt'] });

    const emitted: Array<{ type: string; content: Record<string, unknown> }> = [];
    await runGitOp(taskId, null, 'build', { op: 'commit', message: 'second commit' }, async (type, content) => {
      emitted.push({ type, content });
    });

    const commitEvents = emitted.filter((e) => e.type === 'git_commit');
    expect(commitEvents).toHaveLength(1);
    const payload = readGitCommit(commitEvents[0].content);
    expect(payload.subject).toBe('second commit');
    // The hash must be HEAD after the commit — verified against git itself,
    // not against our own output.
    const realHead = (await git(dir, ['rev-parse', 'HEAD'])).trim();
    expect(payload.hash).toBe(realHead);

    // The op result is unchanged — the observation never altered the operation.
    const log = await runGitOp(taskId, null, 'build', { op: 'log' });
    expect(log).toContain('second commit');
  });

  it('a throwing sink is logged and never fails the git operation', async () => {
    if (!gitAvailable) return;
    const { taskId, dir } = makeWorkspace('emit-throw');
    await initRepo(dir);
    const boom: GitEventSink = async () => {
      throw new Error('event bus down');
    };
    // The status op must still succeed and still return its text result.
    await expect(runGitOp(taskId, null, 'build', { op: 'status' }, boom)).resolves.toContain('branch main');
  });

  it('read ops other than status do not emit git_status', async () => {
    if (!gitAvailable) return;
    const { taskId, dir } = makeWorkspace('emit-quiet');
    await initRepo(dir);
    const emitted: string[] = [];
    const sink: GitEventSink = async (type) => {
      emitted.push(type);
    };
    await runGitOp(taskId, null, 'build', { op: 'log' }, sink);
    await runGitOp(taskId, null, 'build', { op: 'diff' }, sink);
    await runGitOp(taskId, null, 'build', { op: 'branch' }, sink);
    expect(emitted).toEqual([]);
  });

  it('without a sink nothing is emitted and nothing breaks (unit-call shape)', async () => {
    if (!gitAvailable) return;
    const { taskId, dir } = makeWorkspace('emit-none');
    await initRepo(dir);
    await expect(runGitOp(taskId, null, 'build', { op: 'status' })).resolves.toContain('branch main');
    await expect(runGitOp(taskId, null, 'build', { op: 'log' })).resolves.toContain('initial commit');
  });

  it('status emission works in planning mode too (read op, observational)', async () => {
    if (!gitAvailable) return;
    const { taskId, dir } = makeWorkspace('emit-planning');
    await initRepo(dir);
    const emitted: Array<{ type: string; content: Record<string, unknown> }> = [];
    await runGitOp(taskId, null, 'planning', { op: 'status' }, async (type, content) => {
      emitted.push({ type, content });
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('git_status');
    expect(readGitStatus(emitted[0].content).branch).toBe('main');
  });
});
