/**
 * Real-PTY verification. NOT a unit test — it spawns actual processes.
 *
 * It exercises the SHIPPED environment policy: `buildSafeEnv` is imported from
 * lib/agent/code.ts (via tsx) rather than reimplemented, so a regression in the
 * real policy fails here. That is the point — an env this script builds itself
 * would prove nothing about what the terminal actually does.
 *
 * Writes to a file rather than stdout: on Windows, writing to stdout while a
 * ConPTY is alive throws "AttachConsole failed" under MinGW/Git-Bash.
 *
 * Run: npx tsx scripts/verify-pty.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node-pty';

// Dynamic import, not a static named import: tsx's ESM loader does not expose
// named exports of a .ts module to static analysis, so `import { x } from './y.ts'`
// throws "does not provide an export named". The namespace object is correct.
const { buildSafeEnv } = await import('../lib/agent/code.ts');
const { defaultShell, TERMINAL_LIMITS } = await import('../lib/agent/terminal.ts');

const LOG = path.join(process.cwd(), 'pty-verify.log');
const lines = [];
function log(msg) {
  lines.push(`${msg}`);
  fs.writeFileSync(LOG, lines.join('\n') + '\n');
}

const isWin = process.platform === 'win32';
const { file: shell, args: shellArgs } = defaultShell();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Strip ANSI so an assertion matches the text a user would actually see.
 *
 * NOT cosmetic, and not optional. `/\b120\b/` against the RAW stream fails:
 * PowerShell emits `ESC[m120`, and `m` is a word character, so there is no word
 * boundary before the digits. That single detail made the resize check report a
 * failure for a resize that was in fact working — measured directly:
 * `BUF=120 WIN=120 CON=120`. Any assertion about a number in terminal output
 * must run on stripped text, or an adjacent escape sequence silently decides
 * the result.
 */
function stripAnsi(s) {
  // ESC/BEL come from fromCharCode and the patterns from RegExp(), not from regex
  // literals: tsx's ESM pre-parser rejects an escaped control character inside a
  // regex literal in this file ("Parse error ... Unterminated group"), so the
  // control bytes stay out of the literal entirely.
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const B = String.fromCharCode(92);
  // OSC (e.g. the window-title sequence PowerShell emits), CSI, then the
  // two-character escapes.
  const osc = new RegExp(ESC + B + '][^' + BEL + ESC + ']*(?:' + BEL + '|' + ESC + B + B + ')', 'g');
  const csi = new RegExp(ESC + B + '[[0-9;?]*[ -/]*[@-~]', 'g');
  const two = new RegExp(ESC + '[@-Z' + B + B + '-_]', 'g');
  return s.replace(osc, '').replace(csi, '').replace(two, '');
}

/** Env exactly as the terminal builds it, including the TERM default. */
function ptyEnv(cwd) {
  const env = buildSafeEnv(cwd);
  if (!env.TERM) env.TERM = 'xterm-256color';
  return env;
}

/** Spawn a PTY, run a scripted interaction, resolve with everything it printed. */
function session(steps, { cols = 80, rows = 24, timeoutMs = 20000, cwd = os.tmpdir() } = {}) {
  return new Promise((resolve) => {
    const term = spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: ptyEnv(cwd),
    });

    let out = '';
    let exited = false;
    let exitCode = null;

    term.onData((d) => {
      out += d;
    });
    term.onExit(({ exitCode: code }) => {
      exited = true;
      exitCode = code;
    });

    const done = (reason) => resolve({ out, exited, exitCode, reason, term });

    (async () => {
      const timer = setTimeout(() => done('timeout'), timeoutMs);
      try {
        await steps({ term, read: () => out, sleep });
      } catch (err) {
        log(`  step error: ${err && err.message}`);
      }
      clearTimeout(timer);
      done('completed');
    })();
  });
}

let failures = 0;
function check(name, ok, detail = '') {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

log(`PTY verification on ${process.platform} using ${shell}`);
log(`node ${process.version}`);
log('');

/* 1. Basic bidirectional IO ---------------------------------------- */
{
  const marker = `XEO_${Date.now()}`;
  const r = await session(async ({ term, sleep }) => {
    await sleep(2000);
    term.write(`echo ${marker}\r`);
    await sleep(2500);
    term.write('exit\r');
    await sleep(1200);
  });
  check('shell echoes a command result back through the PTY', r.out.includes(marker), `${r.out.length} bytes captured`);
  try { r.term.kill(); } catch {}
}

/* 2. Interactive REPL: the definitive "is it a real PTY" test ------- */
{
  // A pipe-based child would not print the ">>>" prompt at all. Only a PTY does.
  const py = isWin ? 'python' : 'python3';
  const r = await session(async ({ term, sleep }) => {
    await sleep(2000);
    term.write(`${py} -i\r`);
    await sleep(3500);
    term.write('7*6\r');
    await sleep(2500);
    // Ctrl-C at an interactive prompt: a real PTY delivers SIGINT.
    term.write('\x03');
    await sleep(1200);
    term.write('exit()\r');
    await sleep(1000);
    term.write('exit\r');
    await sleep(1000);
  }, { timeoutMs: 25000 });

  const sawPrompt = r.out.includes('>>>');
  const sawResult = r.out.includes('42');
  check('interactive REPL prints its prompt (proves a TTY, not a pipe)', sawPrompt);
  check('REPL evaluates input typed into the PTY', sawResult);
  check('Ctrl-C is delivered as a signal, not as literal bytes', !r.out.includes('^C^C'), 'KeyboardInterrupt or clean prompt');
  try { r.term.kill(); } catch {}
}

/* 3. Resize ------------------------------------------------------- */
{
  // The probe prints a MARKER immediately followed by the width, so the assertion
  // cannot be satisfied by the echo of the typed command (which contains the
  // marker followed by a quote, never by a digit) or by an unrelated 120 in the
  // redraw traffic. Windows reads [console]::WindowWidth: it reflects the live
  // ConPTY, and unlike $Host.UI.RawUI it does not depend on the PowerShell host
  // having refreshed its own view. Measured on win32: after resize(120, 40),
  // BufferSize.Width, WindowSize.Width and [console]::WindowWidth all report 120.
  const r = await session(async ({ term, sleep }) => {
    await sleep(2000);
    term.resize(120, 40);
    await sleep(600);
    if (isWin) term.write('"XEOCOLS=" + [console]::WindowWidth\r');
    else term.write('echo "XEOCOLS=$(tput cols)"\r');
    await sleep(2500);
    term.write('exit\r');
    await sleep(1000);
  });
  check(
    'resize takes effect and the shell reports the new width',
    /XEOCOLS=120\b/.test(stripAnsi(r.out)),
    'expected 120 columns',
  );
  try { r.term.kill(); } catch {}
}

/* 3b. Resize negative control ------------------------------------- */
{
  // Without this, check 3 could pass for the wrong reason — e.g. if the shell
  // always reported 120 regardless of the PTY. Same probe, NO resize: it must
  // report the 80 it was spawned with. Together the two checks prove resize()
  // is what changed the width.
  const r = await session(async ({ term, sleep }) => {
    await sleep(2000);
    if (isWin) term.write('"XEOCOLS=" + [console]::WindowWidth\r');
    else term.write('echo "XEOCOLS=$(tput cols)"\r');
    await sleep(2500);
    term.write('exit\r');
    await sleep(1000);
  });
  const plain = stripAnsi(r.out);
  check(
    'an un-resized session reports its spawn width, not the resized one',
    /XEOCOLS=80\b/.test(plain) && !/XEOCOLS=120\b/.test(plain),
    'expected 80 columns',
  );
  try { r.term.kill(); } catch {}
}

/* 4. ANSI output -------------------------------------------------- */
{
  const r = await session(async ({ term, sleep }) => {
    await sleep(2000);
    if (isWin) term.write('Write-Host -ForegroundColor Red XEOCOLOR\r');
    else term.write('printf "\\033[31mXEOCOLOR\\033[0m\\n"\r');
    await sleep(2500);
    term.write('exit\r');
    await sleep(1000);
  });
  check('ANSI escape sequences reach the client unmangled', /\x1b\[/.test(r.out), 'found CSI bytes');
  try { r.term.kill(); } catch {}
}

/* 5. Exit code propagation ---------------------------------------- */
{
  const r = await session(async ({ term, sleep }) => {
    await sleep(2000);
    term.write('exit 3\r');
    await sleep(2500);
  });
  check('process exit is observed by onExit', r.exited, `exitCode=${r.exitCode}`);
  try { r.term.kill(); } catch {}
}

/* 6. cwd honored -------------------------------------------------- */
{
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-pty-'));
  const r = await session(async ({ term, sleep }) => {
    await sleep(2000);
    term.write(isWin ? '(Get-Location).Path\r' : 'pwd\r');
    await sleep(2500);
    term.write('exit\r');
    await sleep(800);
  }, { cwd: probe });
  const leaf = path.basename(probe);
  check('the PTY starts in the directory it was given', r.out.includes(leaf), `looking for ${leaf}`);
  try { r.term.kill(); } catch {}
  fs.rmSync(probe, { recursive: true, force: true });
}

/* 7. Env whitelist ------------------------------------------------ */
{
  // A secret in the parent must NOT appear in the child. This asserts the SHIPPED
  // buildSafeEnv, not a local copy of it.
  process.env.XEO_FAKE_SECRET = 'SHOULD_NOT_APPEAR_1234';
  const built = ptyEnv(os.tmpdir());
  check('buildSafeEnv omits a non-whitelisted var', built.XEO_FAKE_SECRET === undefined);
  check('buildSafeEnv points HOME at the workspace', built.HOME === os.tmpdir());

  const r = await session(async ({ term, sleep }) => {
    await sleep(2000);
    if (isWin) term.write('"[$env:XEO_FAKE_SECRET]"; echo DONEPROBE\r');
    else term.write('echo "[$XEO_FAKE_SECRET]"; echo DONEPROBE\r');
    await sleep(2500);
    term.write('exit\r');
    await sleep(800);
  });
  check('a non-whitelisted parent env var does not reach the child', !r.out.includes('SHOULD_NOT_APPEAR_1234'));
  check('the probe actually ran (so the check above is meaningful)', r.out.includes('DONEPROBE'));
  delete process.env.XEO_FAKE_SECRET;
  try { r.term.kill(); } catch {}
}

/* 8. Session limits are declared -------------------------------- */
{
  check('a per-task session cap exists', TERMINAL_LIMITS.maxSessionsPerTask > 0, `${TERMINAL_LIMITS.maxSessionsPerTask}`);
  check('a process-wide session cap exists', TERMINAL_LIMITS.maxSessionsTotal >= TERMINAL_LIMITS.maxSessionsPerTask);
  check('scrollback is bounded', TERMINAL_LIMITS.scrollbackBytes > 0);
  check('an idle TTL exists', TERMINAL_LIMITS.idleTtlMs > 0);
}

log('');
log(failures === 0 ? `ALL CHECKS PASSED` : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
