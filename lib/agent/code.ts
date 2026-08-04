/**
 * Code execution tool — runs bash/python in the task workspace.
 *
 * Security layers (adapted from V1, kept minimal):
 *  - buildSafeEnv: strict env whitelist + HOME=workspace so platform secrets
 *    (MODEL_API_KEY, DATABASE_URL, etc.) never leak to child processes.
 *  - boundary checks: reject `cd`, `..`, and absolute paths outside the
 *    workspace (a small allowlist of device files is permitted).
 *  - dangerous-command blocklist: rm -rf /, sudo, mkfs, dd, fork bombs,
 *    piping remote scripts to a shell, cloud metadata endpoint, etc.
 *  - execAsync with a hard timeout and bounded output buffer.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { workspaceFor } from './files';

const execAsync = promisify(exec);

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 4 * 1024 * 1024;

const SAFE_ENV_KEYS = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TERM', 'TMPDIR'];
const ALLOWED_ABS = ['/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr', '/dev/zero', '/dev/urandom'];

const DANGEROUS: RegExp[] = [
  /\brm\s+-rf?\s+\//i, // rm -rf on any path (removed /tmp exception)
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\s*\{/, // fork bomb
  /\b(curl|wget)\b[^|]*\|\s*(sh|bash|python)/i,
  /169\.254\.169\.254/, // cloud metadata
  /\bnc\b.*-e/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\/etc\/(passwd|shadow)/i,
  /\b(bash)\s+-i\b[^&]*>&\s*\/dev\/tcp/i, // reverse shell
  /\/proc\/(self|1)\/(environ|cmdline|status|mounts|maps|fd)/i, // /proc sensitive paths
  /\bos\.system\b/i, // Python os.system
  /\bsubprocess\b/i, // Python subprocess
  /\bimport\s+(socket|ctypes)\b/i, // network/socket access in scripts
  /\b(curl|wget)\b.*localhost/i, // curl/wget to localhost
  /\b(curl|wget)\b.*127\.0\.0/i, // curl/wget to loopback
  /\bbase64\s+(-d|--decode)\b.*\|.*(sh|bash|python)/i, // base64 decode to shell
  /\bnohup\b/i, // persistent background processes
  /\bdocker\b/i, // docker escape vector
  /\bchroot\b/i, // chroot escape
  /\bunshare\b/i, // namespace escape
];

export class CommandBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandBlockedError';
  }
}

function buildSafeEnv(workDir: string): Record<string, string> {
  const env: Record<string, string> = { HOME: workDir };
  for (const key of SAFE_ENV_KEYS) {
    const val = process.env[key];
    if (val) env[key] = val;
  }
  if (!env.PATH) env.PATH = '/usr/local/bin:/usr/bin:/bin';
  return env;
}

function assertBoundaries(command: string): void {
  for (const re of DANGEROUS) {
    if (re.test(command)) {
      throw new CommandBlockedError(`Command blocked by safety policy: ${command.slice(0, 80)}`);
    }
  }
  if (/(^|\s|;|&&|\|\|)\s*cd\s+/.test(command)) {
    throw new CommandBlockedError('Changing directories is not allowed; stay in the workspace.');
  }
  if (/\.\.(\/|\\|\s|$)/.test(command)) {
    throw new CommandBlockedError('Parent-directory references (..) are not allowed.');
  }
  // Reject absolute paths except the small device allowlist.
  const absMatches = command.match(/(?:^|\s)(\/[^\s'";|&]+)/g) || [];
  for (const raw of absMatches) {
    const p = raw.trim();
    if (!ALLOWED_ABS.includes(p) && !ALLOWED_ABS.some((a) => p.startsWith(a))) {
      throw new CommandBlockedError(`Absolute path outside workspace is not allowed: ${p}`);
    }
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function run(command: string, workDir: string): Promise<ExecResult> {
  assertBoundaries(command);
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      env: buildSafeEnv(workDir) as NodeJS.ProcessEnv,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    // Non-zero exit or timeout: surface output, do not throw (agent reads it).
    if (err && (typeof err.code === 'number' || typeof err.code === 'string')) {
      return {
        stdout: err.stdout ?? '',
        stderr: (err.stderr ?? '') + (err.killed ? `\n[killed: timeout after ${TIMEOUT_MS}ms]` : ''),
        exitCode: typeof err.code === 'number' ? err.code : 1,
      };
    }
    throw err;
  }
}

export class CodeTool {
  private workDir: string;

  constructor(taskId: string) {
    this.workDir = workspaceFor(taskId);
  }

  async bash(command: string): Promise<ExecResult> {
    return run(command, this.workDir);
  }

  async python(code: string): Promise<ExecResult> {
    assertBoundaries(code);
    // Write to a temp file in-workspace and run it, avoiding shell-quoting issues.
    const file = `._snippet_${Date.now()}.py`;
    const escaped = code.replace(/'/g, `'\\''`);
    const command = `printf '%s' '${escaped}' > ${file} && python3 ${file}; rm -f ${file}`;
    return run(command, this.workDir);
  }
}
