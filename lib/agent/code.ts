/**
 * Code execution tool — runs bash/python on the host with the task workspace
 * as the working directory.
 *
 * This is NOT a sandbox (AGENTS.md §16). There is no OS-level containment: no
 * namespace, no cgroup, no seccomp filter, no separate user. What exists is a
 * set of restrictions on top of ordinary host execution:
 *  - buildSafeEnv: strict env whitelist + HOME=workspace so platform secrets
 *    (MODEL_API_KEY, DATABASE_URL, etc.) never leak to child processes.
 *  - boundary checks: reject `cd`, `..`, and absolute paths outside the
 *    workspace (a small allowlist of device files is permitted).
 *  - dangerous-command denylist: rm -rf /, sudo, mkfs, dd, fork bombs,
 *    piping remote scripts to a shell, cloud metadata endpoint, etc.
 *  - execAsync with a hard timeout and bounded output buffer.
 *
 * Describe this to users and to the model as "restricted host execution",
 * never as a sandbox. See assertBoundaries for the specific bypass this
 * design cannot close.
 */

import { exec } from 'node:child_process';
import { evaluatePermission, type PermissionRule } from './permissions';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceFor } from './files';
import { dockerWrapCommand, type SandboxMode } from './sandbox';

const execAsync = promisify(exec);

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 4 * 1024 * 1024;

/**
 * Environment whitelist for every child process the agent starts.
 *
 * EXPORTED because there must be exactly ONE environment policy. `code_execute`
 * uses it here; the PTY terminal in ./terminal.ts imports it rather than
 * declaring a second list. If a second whitelist appears, the two will drift and
 * one of them will eventually leak MODEL_API_KEY or DATABASE_URL into a child.
 * buildSafeEnv() below is the only intended way to consume it.
 */
export const SAFE_ENV_KEYS = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TERM', 'TMPDIR'];

/**
 * Windows platform variables that are NOT optional.
 *
 * MEASURED, not assumed: spawning `powershell.exe` with only SAFE_ENV_KEYS
 * produces "Internal Windows PowerShell error. Loading managed Windows PowerShell
 * failed with error 8009001d" and an immediate exit, because the CLR cannot
 * locate the framework without SystemRoot. `cmd.exe` survives but resolves
 * nothing. These are locations of the OS itself, not credentials — the reason
 * this whitelist exists is to keep MODEL_API_KEY, DATABASE_URL and friends out of
 * children, and none of these carry secrets.
 *
 * USERPROFILE/TEMP/TMP are deliberately NOT read from the parent: they are
 * pointed at the workspace by buildSafeEnv, mirroring what HOME does on POSIX, so
 * a child writes scratch files inside the task rather than into the real profile.
 */
const WINDOWS_PLATFORM_KEYS = ['SystemRoot', 'SystemDrive', 'windir', 'PATHEXT', 'COMSPEC', 'PSModulePath', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'];

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

/**
 * Build the child-process environment: the whitelist plus HOME pointed at the
 * workspace. EXPORTED for the same reason SAFE_ENV_KEYS is — the terminal needs
 * the identical environment, and reimplementing it would be a second policy.
 *
 * The Windows branch adds OS-location variables (see WINDOWS_PLATFORM_KEYS) and
 * redirects the profile/temp variables into the workspace. Both branches keep the
 * same guarantee: a variable not named in a list here does not reach the child,
 * so platform secrets stay in the server process.
 */
export function buildSafeEnv(workDir: string): Record<string, string> {
  const env: Record<string, string> = { HOME: workDir };
  for (const key of SAFE_ENV_KEYS) {
    const val = process.env[key];
    if (val) env[key] = val;
  }
  if (process.platform === 'win32') {
    for (const key of WINDOWS_PLATFORM_KEYS) {
      const val = process.env[key];
      if (val) env[key] = val;
    }
    // Point the profile and scratch variables at the workspace, the way HOME is
    // pointed there on POSIX. A child that writes to %TEMP% writes inside the task.
    env.USERPROFILE = workDir;
    env.TEMP = workDir;
    env.TMP = workDir;
  }
  if (!env.PATH) env.PATH = '/usr/local/bin:/usr/bin:/bin';
  return env;
}

/**
 * Reject a command that trips the denylist or leaves the workspace.
 *
 * KNOWN AND UNCLOSEABLE AT THIS LAYER: every check below inspects the command
 * *string*. It cannot see what a program does once it starts. `python3 s.py`
 * is nine harmless characters, so a script written by file_write can import
 * socket, shell out via os.system, read /etc/passwd, or reach the metadata
 * endpoint — none of which the patterns above will ever match. The same holds
 * for `make`, `npm run <script>`, `bash s.sh`, and any interpreter given a
 * file. This is string-level discouragement of obviously destructive
 * one-liners, not a capability boundary. Closing it requires OS-level
 * isolation, which this project deliberately does not claim to have.
 */
function assertBoundaries(command: string, rules?: readonly PermissionRule[]): void {
  /*
   * v1.20: the declarative rule set is consulted FIRST when the caller
   * supplies one, so a shell decision made here is the same decision the UI
   * showed and the audit trail recorded. The regex denylist below still runs
   * as a floor for callers that pass no rules (older internal paths).
   */
  if (rules && rules.length) {
    const decision = evaluatePermission(rules, 'shell', command);
    if (decision.effect === 'deny') {
      throw new CommandBlockedError(
        `Command denied by permission rule ${decision.ruleIndex} (${decision.matched?.note ?? decision.matched?.resource ?? 'policy'}): ${command.slice(0, 80)}`,
      );
    }
  }
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

async function run(
  command: string,
  workDir: string,
  rules?: readonly PermissionRule[],
): Promise<ExecResult> {
  assertBoundaries(command, rules);
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
  /**
   * Declarative permission rules for the run that owns this tool (v1.20).
   * Optional so older internal callers keep working on the regex floor;
   * when present, a shell decision here is the SAME decision the UI showed.
   */
  private rules?: readonly PermissionRule[];
  /** v1.23 sandbox tier: docker wraps execution commands; standard/strict pass through. */
  private sandbox: { mode: SandboxMode; dockerAvailable: boolean };

  constructor(
    taskId: string,
    projectPath?: string | null,
    rules?: readonly PermissionRule[],
    /** v1.23 sandbox tier — see lib/agent/sandbox.ts. */
    sandbox?: { mode: SandboxMode; dockerAvailable: boolean },
  ) {
    this.workDir = workspaceFor(taskId, projectPath);
    this.rules = rules;
    this.sandbox = sandbox ?? { mode: 'standard', dockerAvailable: false };
  }

  /**
   * v1.23: the docker tier wraps EVERY execution command in an ephemeral
   * container (workspace mounted, CPU/memory capped, network off). The
   * payload stays INSIDE the wrapped string, so every deny rule still sees
   * the inner command text — the wrap cannot smuggle anything past the
   * blocklist. Docker-unavailable fails CLOSED with an honest message;
   * it never silently falls back to host execution.
   */
  private commandFor(command: string): string {
    if (this.sandbox.mode !== 'docker') return command;
    if (!this.sandbox.dockerAvailable) {
      throw new CommandBlockedError(
        'Sandbox tier "docker" is active for this task, but Docker is not reachable on this machine. ' +
          'Start Docker (or switch the task to strict/standard in Settings). Xeo Forge refuses to run this command on the host while docker isolation is selected — that is the fail-closed contract.',
      );
    }
    return dockerWrapCommand(command, this.workDir);
  }

  async bash(command: string): Promise<ExecResult> {
    return run(this.commandFor(command), this.workDir, this.rules);
  }

  /**
   * Run a Python snippet: the code is written to an in-workspace file with
   * fs.writeFileSync and executed directly — NO shell quoting of user code.
   *
   * v1.18 fix: the previous implementation piped the snippet through
   * `printf '%s' '<escaped>'` shell syntax, which (a) never works on Windows
   * where exec() runs cmd.exe, and (b) broke on any snippet containing a
   * single quote. Writing the file from Node removes the entire quoting
   * layer. The boundary check still runs on the CODE text itself before it
   * is written.
   */
  async python(code: string): Promise<ExecResult> {
    assertBoundaries(code, this.rules);
    const file = `._snippet_${Date.now()}.py`;
    const abs = path.join(this.workDir, file);
    fs.writeFileSync(abs, code, 'utf8');
    // Interpreter resolution: `python3` on POSIX; on Windows, `py` (the
    // launcher ships with python.org installs) then `python` — the bare
    // `python3` name resolves to the Microsoft Store stub there.
    const runner = process.platform === 'win32' ? 'py -3 || python' : 'python3';
    // v1.23 fix (audit #9): the second chained command (`del`) ran OUTSIDE
    // the rules gate — the snippet path never passed assertBoundaries — and
    // `del` does not exist on POSIX, so temp files lingered forever. The
    // interpreter runs through the SAME gated run(); cleanup is unconditional
    // and in-process, so no shell command can escape the policy.
    try {
      return await run(this.commandFor(`${runner} ${file}`), this.workDir, this.rules);
    } finally {
      try { fs.unlinkSync(abs); } catch { /* best effort */ }
    }
  }
}
