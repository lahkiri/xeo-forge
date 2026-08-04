/**
 * Preview runtime — ephemeral, isolated, auto-expiring preview servers.
 *
 * All execution parameters are determined dynamically by the agent at runtime
 * based on actual project context. No hardcoded defaults for runtime type,
 * entry points, ports, or durations.
 *
 * Lifecycle: analyze → decide → allocate → start → readiness detect → confirm.
 *
 * Readiness detection is adaptive per runtime/framework — NOT timeout-based.
 * A process is considered unhealthy ONLY when evidence supports it:
 * unexpected exit, no progress for hardTimeout, or explicit crash.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceFor, resolveWithin } from './files';
import { detectEnvVars } from './env';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ProjectAnalysis {
  runtime: 'static' | 'node' | 'python' | 'custom';
  framework: string;
  entryFile: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  requiredEnvVars: string[];
  detectedFiles: string[];
  lockfile: string | null;
  packageManager: string | null;
  /** Which readiness strategy to use after build/spawn */
  readinessMode: ReadinessMode;
}

export interface PreviewStrategy {
  runtime: 'static' | 'node' | 'python' | 'custom';
  entryFile?: string;
  buildCommand?: string;
  startCommand?: string;
  port?: number;
  ttlMs?: number;
  serveRoot?: string;
}

export type ReadinessMode = 'http-probe' | 'log-signal' | 'immediate';

export type ReadinessSignal =
  | 'http-2xx'
  | 'http-3xx'
  | 'listening'
  | 'server-ready'
  | 'port-bound'
  | 'log-pattern'
  | 'process-exited'
  | 'crash-detected'
  | 'no-progress'
  | 'none';

export interface ReadinessResult {
  ok: boolean;
  method: ReadinessMode;
  signal: ReadinessSignal;
  reason: string;
  evidence: string[];
  elapsed: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const running = new Map<string, RunningPreview>();
const PORT_RANGE = { min: 31000, max: 31999 };
const MAX_LOG_LINES = 200;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const SIGKILL_DELAY_MS = 5000;
const MAX_PREVIEWS = 50;
const BUILD_TIMEOUT_MS = 120_000;

/** Adaptive readiness timing */
const SOFT_TIMEOUT_MS = 15_000;   // emit warning, keep trying
// Hard ceiling on a no-progress preview before it is declared failed. Overridable
// via env ONLY to keep the test suite fast — production uses the 45s default.
const HARD_TIMEOUT_MS = Number(process.env.PREVIEW_HARD_TIMEOUT_MS) || 45_000;   // kill only if zero progress
const PROGRESS_CHECK_MS = 500;    // poll interval for readiness probes
const PORT_BIND_CHECK_MS = 300;   // poll interval for port bind detection

/** Framework-specific readiness log patterns (case-insensitive) */
const FRAMEWORK_LOG_PATTERNS: Record<string, RegExp[]> = {
  nextjs:    [/ready on http/i, /compiled successfully/i, /started server/i],
  nuxt:      [/listening on/i, /ready on/i, /nitro/i],
  vite:      [/Local:\s*http/i, /ready in/i, /dev server running/i],
  gatsby:    [/success build/i, /built in/i, /gatsby develop/i],
  express:   [/listening on/i, /server started/i],
  'node-server': [/listening on/i, /server started/i, /port \d+/i],
  flask:     [/running on/i, /Debugger is/i],
  django:    [/started at/i, /listening on/i, /watching for file changes/i],
  fastapi:   [/application startup complete/i, /uvicorn running/i, /started server/i],
  'python-generic': [/running on/i, /started/i, /listening on/i],
};

/** HTTP routes to probe in order */
const HTTP_PROBE_ROUTES = ['/', '/health', '/api'];

/* ------------------------------------------------------------------ */
/*  Port allocation                                                    */
/* ------------------------------------------------------------------ */

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}

async function allocatePort(preferred?: number): Promise<number | null> {
  if (preferred && preferred >= 1024 && preferred <= 65535) {
    const available = await isPortAvailable(preferred);
    if (available) return preferred;
  }
  // Scan the range and verify each candidate is free at the OS level — not just
  // absent from the in-memory map. Another process (or a second app instance)
  // may hold a port we never registered; binding it would throw EADDRINUSE.
  const used = new Set(Array.from(running.values()).map((p) => p.port));
  for (let p = PORT_RANGE.min; p <= PORT_RANGE.max; p++) {
    if (used.has(p)) continue;
    if (await isPortAvailable(p)) return p;
  }
  return null;
}

function waitForPortBind(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (Date.now() > deadline) { resolve(false); return; }
      const tester = net.createConnection({ port, host: '127.0.0.1' }, () => {
        tester.destroy();
        resolve(true);
      });
      tester.on('error', () => {
        setTimeout(check, PORT_BIND_CHECK_MS);
      });
      tester.setTimeout(500, () => {
        tester.destroy();
        setTimeout(check, PORT_BIND_CHECK_MS);
      });
    };
    check();
  });
}

/* ------------------------------------------------------------------ */
/*  Project analysis — reads workspace, detects framework/entry/build   */
/* ------------------------------------------------------------------ */

function selectReadinessMode(runtime: string, framework: string): ReadinessMode {
  if (FRAMEWORK_LOG_PATTERNS[framework]) return 'log-signal';
  if (runtime === 'node' || runtime === 'python' || runtime === 'static') return 'http-probe';
  return 'immediate';
}

export async function analyzeProject(taskId: string): Promise<ProjectAnalysis> {
  const root = workspaceFor(taskId);
  const analysis: ProjectAnalysis = {
    runtime: 'static',
    framework: 'unknown',
    entryFile: null,
    buildCommand: null,
    startCommand: null,
    requiredEnvVars: [],
    detectedFiles: [],
    lockfile: null,
    packageManager: null,
    readinessMode: 'http-probe',
  };

  if (!fs.existsSync(root)) return analysis;

  // --- Node.js detection ---
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const raw = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(raw);
      analysis.runtime = 'node';
      analysis.detectedFiles.push('package.json');

      // Package manager detection
      if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) { analysis.lockfile = 'pnpm-lock.yaml'; analysis.packageManager = 'pnpm'; }
      else if (fs.existsSync(path.join(root, 'yarn.lock'))) { analysis.lockfile = 'yarn.lock'; analysis.packageManager = 'yarn'; }
      else if (fs.existsSync(path.join(root, 'package-lock.json'))) { analysis.lockfile = 'package-lock.json'; analysis.packageManager = 'npm'; }
      else if (fs.existsSync(path.join(root, 'bun.lockb'))) { analysis.lockfile = 'bun.lockb'; analysis.packageManager = 'bun'; }

      const allDeps: Record<string, string> = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      // Framework detection (order matters — most specific first)
      if (allDeps['next']) {
        analysis.framework = 'nextjs';
        analysis.buildCommand = 'npx next build';
        analysis.startCommand = 'npx next start';
        if (pkg.scripts?.build) analysis.buildCommand = 'npm run build';
        if (pkg.scripts?.start) analysis.startCommand = 'npm run start';
      } else if (allDeps['nuxt'] || allDeps['@nuxt/core']) {
        analysis.framework = 'nuxt';
        analysis.buildCommand = 'npx nuxt build';
        analysis.startCommand = 'npx nuxt preview';
      } else if (allDeps['gatsby']) {
        analysis.framework = 'gatsby';
        analysis.buildCommand = 'npx gatsby build';
        analysis.startCommand = 'npx gatsby serve';
      } else if (allDeps['vite'] || allDeps['@vitejs/plugin-react'] || allDeps['@vitejs/plugin-vue']) {
        analysis.framework = 'vite';
        if (pkg.scripts?.build) analysis.buildCommand = 'npm run build';
        else analysis.buildCommand = 'npx vite build';
        analysis.startCommand = 'npx vite preview';
      } else if (allDeps['react-scripts']) {
        analysis.framework = 'create-react-app';
        if (pkg.scripts?.build) analysis.buildCommand = 'npm run build';
        analysis.startCommand = 'npx serve -s build';
      } else if (allDeps['webpack'] && allDeps['webpack-dev-server']) {
        analysis.framework = 'webpack';
        if (pkg.scripts?.build) analysis.buildCommand = 'npm run build';
        analysis.startCommand = pkg.scripts?.start || 'npx webpack serve';
      } else if (allDeps['express'] || allDeps['fastify'] || allDeps['koa'] || allDeps['hapi']) {
        analysis.framework = 'node-server';
        analysis.startCommand = null;
      } else if (allDeps['socket.io']) {
        analysis.framework = 'node-server';
      } else {
        analysis.framework = 'node-generic';
      }

      // Entry file detection
      if (pkg.main) {
        analysis.entryFile = pkg.main;
      } else {
        const candidates = ['index.js', 'index.ts', 'src/index.js', 'src/index.ts', 'server.js', 'server.ts', 'app.js', 'app.ts', 'main.js', 'main.ts'];
        for (const c of candidates) {
          if (fs.existsSync(path.join(root, c))) { analysis.entryFile = c; break; }
        }
      }

      if (!analysis.startCommand && pkg.scripts?.start) {
        analysis.startCommand = 'npm run start';
      }
      if (!analysis.buildCommand && pkg.scripts?.build) {
        analysis.buildCommand = 'npm run build';
      }
    } catch {}
  }

  // --- Python detection ---
  const requirementsPath = path.join(root, 'requirements.txt');
  const pyprojectPath = path.join(root, 'pyproject.toml');
  const setupPyPath = path.join(root, 'setup.py');
  if (fs.existsSync(requirementsPath) || fs.existsSync(pyprojectPath) || fs.existsSync(setupPyPath)) {
    analysis.runtime = 'python';
    if (fs.existsSync(requirementsPath)) analysis.detectedFiles.push('requirements.txt');
    if (fs.existsSync(pyprojectPath)) analysis.detectedFiles.push('pyproject.toml');
    if (fs.existsSync(setupPyPath)) analysis.detectedFiles.push('setup.py');

    const deps = readRequirements(requirementsPath);
    if (deps.includes('django') || deps.includes('Django')) {
      analysis.framework = 'django';
      analysis.entryFile = 'manage.py';
      analysis.startCommand = 'python3 manage.py runserver 0.0.0.0:${PORT}';
    } else if (deps.includes('flask') || deps.includes('Flask')) {
      analysis.framework = 'flask';
      const candidates = ['app.py', 'main.py', 'wsgi.py', 'run.py'];
      for (const c of candidates) {
        if (fs.existsSync(path.join(root, c))) { analysis.entryFile = c; break; }
      }
      analysis.startCommand = analysis.entryFile ? `python3 ${analysis.entryFile}` : 'python3 app.py';
    } else if (deps.includes('fastapi') || deps.includes('uvicorn')) {
      analysis.framework = 'fastapi';
      const candidates = ['main.py', 'app.py'];
      for (const c of candidates) {
        if (fs.existsSync(path.join(root, c))) { analysis.entryFile = c; break; }
      }
      analysis.startCommand = analysis.entryFile ? `python3 -m uvicorn ${analysis.entryFile.replace('.py', '')}:app --host 0.0.0.0 --port ${'$' + 'PORT'}` : 'python3 main.py';
    } else {
      analysis.framework = 'python-generic';
      const candidates = ['app.py', 'main.py', 'server.py', 'run.py'];
      for (const c of candidates) {
        if (fs.existsSync(path.join(root, c))) { analysis.entryFile = c; break; }
      }
      analysis.startCommand = analysis.entryFile ? `python3 ${analysis.entryFile}` : 'python3 app.py';
    }
  }

  // --- Static detection ---
  if (analysis.runtime === 'static') {
    if (fs.existsSync(path.join(root, 'index.html'))) {
      analysis.entryFile = 'index.html';
      analysis.framework = 'static-html';
      analysis.detectedFiles.push('index.html');
    } else {
      try {
        const files = fs.readdirSync(root);
        const htmlFile = files.find((f) => f.endsWith('.html'));
        if (htmlFile) {
          analysis.entryFile = htmlFile;
          analysis.framework = 'static-html';
          analysis.detectedFiles.push(htmlFile);
        }
      } catch {}
    }
  }

  // Detect required env vars
  const envInfo = detectEnvVars(taskId);
  analysis.requiredEnvVars = envInfo.envVars;

  // Determine readiness mode from framework + runtime
  analysis.readinessMode = selectReadinessMode(analysis.runtime, analysis.framework);

  return analysis;
}

function readRequirements(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').map((l) => l.trim().split(/[>=<!\[]/)[0]).filter(Boolean);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  URL safety + static server                                         */
/* ------------------------------------------------------------------ */

function sanitizeUrlPath(urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch { return null; }
  const normalized = path.posix.normalize(decoded);
  if (normalized.startsWith('..') || normalized.includes('/../') || normalized.includes('/..\\') || normalized.includes('\\')) return null;
  return normalized;
}

function staticServer(root: string, port: number, serveRoot?: string): Promise<http.Server> {
  const serveDir = serveRoot || root;
  return new Promise((resolve, reject) => {
    const MIME: Record<string, string> = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
      '.map': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown',
    };
    const server = http.createServer((req, res) => {
      const rawUrl = req.url?.split('?')[0] || '/';
      const safeUrl = sanitizeUrlPath(rawUrl);
      if (!safeUrl) { res.writeHead(400); res.end('Bad request'); return; }
      const target = safeUrl === '/' ? 'index.html' : safeUrl;
      let filePath: string;
      try { filePath = resolveWithin(serveDir, target); } catch { filePath = path.join(serveDir, 'index.html'); }
      if (!fs.existsSync(filePath)) filePath = path.join(serveDir, 'index.html');
      // If even the index fallback is missing (e.g. wrong serveRoot), respond
      // 404 explicitly instead of hanging — readiness must then fail, not stall.
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => { if (!res.headersSent) { res.writeHead(500); } res.end(); });
      stream.pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/*  Env + process spawning                                             */
/* ------------------------------------------------------------------ */

function buildPreviewEnv(port: number, userEnv: Record<string, string>): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp',
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
  };
  for (const [k, v] of Object.entries(userEnv)) safe[k] = v;
  return safe;
}

function spawnStrategyProcess(
  root: string, port: number, envVars: Record<string, string>,
  runtime: string, startCommand: string,
): ChildProcess {
  const env = buildPreviewEnv(port, envVars);
  const resolvedCmd = startCommand.replace(/\$\{?PORT\}?/g, String(port));

  if (runtime === 'custom' || runtime === 'python') {
    return spawn('sh', ['-c', resolvedCmd], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 0,
    });
  }
  const parts = resolvedCmd.split(/\s+/);
  return spawn(parts[0], parts.slice(1), {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 0,
  });
}

/* ------------------------------------------------------------------ */
/*  Build command                                                      */
/* ------------------------------------------------------------------ */

async function runBuildCommand(
  root: string, buildCommand: string, envVars: Record<string, string>,
): Promise<{ ok: boolean; error?: string; output?: string }> {
  const env = buildPreviewEnv(0, envVars);
  const resolvedCmd = buildCommand.replace(/\$\{?PORT\}?/g, '0');
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', resolvedCmd], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: BUILD_TIMEOUT_MS,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('exit', (code) => {
      if (code === 0) resolve({ ok: true, output: stdout.slice(0, 4000) });
      else resolve({ ok: false, error: `Build failed (exit ${code}): ${(stderr || stdout).slice(0, 2000)}` });
    });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

/* ------------------------------------------------------------------ */
/*  Adaptive readiness detection                                       */
/* ------------------------------------------------------------------ */

/**
 * Core readiness detection — adaptive per runtime/framework.
 *
 * Monitors: process output, port bind, HTTP probe, process exit.
 * Uses progress signals to extend the deadline.
 * Only fails on: unexpected exit, no progress + no signal, explicit crash.
 */
function detectReadiness(
  child: ChildProcess | null,
  port: number,
  mode: ReadinessMode,
  framework: string,
  logs: string[],
): Promise<ReadinessResult> {
  return new Promise((resolve) => {
    const startMs = Date.now();
    let resolved = false;
    let crashed = false;
    let exitCode: number | null = null;
    let logLinesAtStart = logs.length;
    let lastProgressAt = Date.now();
    let lastLogCount = logs.length;
    let httpAttempted = false;

    const result = (ok: boolean, signal: ReadinessSignal, reason: string, evidence: string[]) => {
      if (resolved) return;
      resolved = true;
      resolve({ ok, method: mode, signal, reason, evidence, elapsed: Date.now() - startMs });
    };

    // --- Process exit listener ---
    if (child) {
      child.on('exit', (code) => {
        exitCode = code;
        crashed = true;
        if (!resolved) {
          result(false, 'process-exited', `Process exited with code ${code}`, logs.slice(-10));
        }
      });
    }

    // --- Log-signal detection ---
    const frameworkPatterns = FRAMEWORK_LOG_PATTERNS[framework] || [];

    // --- HTTP probe function ---
    // Readiness is TRUTH-BASED: the server must return a real 2xx/3xx status
    // with a non-empty body. 4xx, 5xx, empty body, and connection refusals all
    // fail. A completed build or a bound port is NOT readiness.
    const httpProbe = async (): Promise<boolean> => {
      for (const route of HTTP_PROBE_ROUTES) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}${route}`, {
            signal: AbortSignal.timeout(3000),
            redirect: 'manual',
          });

          // Only 2xx and 3xx count as a serving response.
          const is2xx = res.status >= 200 && res.status < 300;
          const is3xx = res.status >= 300 && res.status < 400;
          if (!is2xx && !is3xx) continue;

          // 3xx (redirect) is a live server responding — accept without body check.
          if (is3xx) {
            const loc = res.headers.get('location') || '';
            result(true, 'http-3xx', `HTTP probe got redirect at ${route} (status ${res.status})`, [
              `GET http://127.0.0.1:${port}${route} → ${res.status}${loc ? ` → ${loc}` : ''}`,
            ]);
            return true;
          }

          // 2xx must carry a non-empty body to count as a real preview.
          const body = await res.text();
          if (body.trim().length === 0) {
            // Live but empty — not a usable preview. Keep trying other routes.
            continue;
          }
          result(true, 'http-2xx', `HTTP probe succeeded at ${route} (status ${res.status}, ${body.length} bytes)`, [
            `GET http://127.0.0.1:${port}${route} → ${res.status} (${body.length} bytes)`,
          ]);
          return true;
        } catch {}
      }
      return false;
    };

    // --- Main polling loop ---
    const poll = async () => {
      if (resolved) return;

      const elapsed = Date.now() - startMs;
      const now = Date.now();

      // Check for new log output (progress signal)
      if (logs.length > lastLogCount) {
        const newLogs = logs.slice(lastLogCount);
        lastLogCount = logs.length;
        lastProgressAt = now;

        // Check if new logs match framework-specific patterns
        if (frameworkPatterns.length > 0) {
          for (const line of newLogs) {
            for (const pattern of frameworkPatterns) {
              if (pattern.test(line)) {
                result(true, 'log-pattern', `Framework readiness signal detected: "${line.trim().slice(0, 100)}"`, newLogs.slice(-5));
                return;
              }
            }
          }
        }
      }

      // Check for port bind (progress signal)
      if (!resolved && mode === 'log-signal' && elapsed > 2000) {
        try {
          const portOpen = await new Promise<boolean>((resolvePort) => {
            const tester = net.createConnection({ port, host: '127.0.0.1' }, () => {
              tester.destroy();
              resolvePort(true);
            });
            tester.on('error', () => resolvePort(false));
            tester.setTimeout(500, () => { tester.destroy(); resolvePort(false); });
          });
          if (portOpen) {
            lastProgressAt = now;
            // Port is open — try HTTP probe
            httpAttempted = true;
            const httpOk = await httpProbe();
            if (httpOk) return;
          }
        } catch {}
      }

      // HTTP probe for http-probe mode
      if (!resolved && mode === 'http-probe' && elapsed > 1500) {
        httpAttempted = true;
        const httpOk = await httpProbe();
        if (httpOk) return;
      }

      // Failure classification:
      // 1. If process crashed → already resolved via exit listener
      // 2. If no progress for HARD_TIMEOUT → fail
      // 3. If no progress for SOFT_TIMEOUT → keep trying (don't kill)
      const timeSinceProgress = now - lastProgressAt;
      if (timeSinceProgress > HARD_TIMEOUT_MS && !resolved) {
        const evidence = logs.slice(-15);
        result(false, 'no-progress', `No readiness signal for ${(timeSinceProgress / 1000).toFixed(0)}s — process shows no signs of starting`, evidence);
        return;
      }

      // If process is still running but we haven't resolved → keep polling
      if (!resolved && !crashed) {
        setTimeout(poll, PROGRESS_CHECK_MS);
      }
    };

    // Initial delay to let the process start
    setTimeout(poll, 1000);
  });
}

/* ------------------------------------------------------------------ */
/*  Start / stop / status                                              */
/* ------------------------------------------------------------------ */

interface RunningPreview {
  taskId: string;
  process: ChildProcess | null;
  server: http.Server | null;
  port: number;
  url: string;
  startedAt: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  killTimer: ReturnType<typeof setTimeout> | null;
  logs: string[];
  type: 'static' | 'node' | 'python' | 'custom';
  strategy: PreviewStrategy;
  readiness?: ReadinessResult;
}

export interface PreviewStartResult {
  ok: boolean;
  previewUrl?: string;
  previewId?: string;
  type?: string;
  expiresAt?: number;
  strategy?: PreviewStrategy;
  readiness?: ReadinessResult;
  error?: string;
}

export async function startPreviewWithStrategy(
  taskId: string,
  strategy: PreviewStrategy,
  envVars: Record<string, string> = {},
): Promise<PreviewStartResult> {
  stopPreview(taskId);

  if (running.size >= MAX_PREVIEWS) {
    return { ok: false, error: 'Maximum concurrent previews reached', strategy };
  }

  const root = workspaceFor(taskId);
  if (!fs.existsSync(root)) {
    return { ok: false, error: 'Workspace not found', strategy };
  }

  // Validate entry file if provided
  if (strategy.entryFile) {
    try { resolveWithin(root, strategy.entryFile); } catch {
      return { ok: false, error: `Entry file not found: ${strategy.entryFile}`, strategy };
    }
  }

  const port = await allocatePort(strategy.port);
  if (port === null) {
    return { ok: false, error: `Port ${strategy.port || 'auto'} unavailable`, strategy };
  }

  const ttlMs = strategy.ttlMs || DEFAULT_TTL_MS;
  const expiresAt = Date.now() + ttlMs;

  // Readiness mode: all runtimes use http-probe for runtime verification
  const readinessMode: ReadinessMode = 'http-probe';

  try {
    // Build step (if provided)
    if (strategy.buildCommand) {
      const build = await runBuildCommand(root, strategy.buildCommand, envVars);
      if (!build.ok) {
        return { ok: false, error: build.error, strategy };
      }
    }

    // Static server — no child process
    if (strategy.runtime === 'static') {
      // Resolve serveRoot: agent-provided path, validated within workspace boundary
      let serveDir = root;
      if (strategy.serveRoot) {
        try {
          serveDir = resolveWithin(root, strategy.serveRoot);
        } catch {
          return { ok: false, error: `serveRoot path invalid or outside workspace: ${strategy.serveRoot}`, strategy };
        }
      }
      const server = await staticServer(root, port, serveDir);
      const timer = setTimeout(() => stopPreview(taskId), ttlMs);
      const preview: RunningPreview = {
        taskId, process: null, server, port,
        url: `http://127.0.0.1:${port}`, startedAt: Date.now(),
        expiresAt, timer, killTimer: null, logs: ['Static file server started'],
        type: 'static', strategy,
      };
      running.set(taskId, preview);

      const readiness = await detectReadiness(null, port, readinessMode, 'static-html', preview.logs);
      preview.readiness = readiness;
      return {
        ok: readiness.ok, previewUrl: preview.url, previewId: taskId, type: 'static',
        expiresAt, strategy, readiness,
        error: readiness.ok ? undefined : `Readiness check failed: ${readiness.reason}`,
      };
    }

    // Dynamic process — resolve start command
    const startCmd = strategy.startCommand;
    if (!startCmd) {
      return { ok: false, error: `No start command provided for runtime '${strategy.runtime}'`, strategy };
    }

    const child = spawnStrategyProcess(root, port, envVars, strategy.runtime, startCmd);
    const logs: string[] = [];

    child.stdout?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n').filter(Boolean)) {
        logs.push(line);
        if (logs.length > MAX_LOG_LINES) logs.shift();
      }
    });
    child.stderr?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n').filter(Boolean)) {
        logs.push(`[err] ${line}`);
        if (logs.length > MAX_LOG_LINES) logs.shift();
      }
    });
    child.on('exit', () => stopPreview(taskId));

    const timer = setTimeout(() => stopPreview(taskId), ttlMs);
    const preview: RunningPreview = {
      taskId, process: child, server: null, port,
      url: `http://127.0.0.1:${port}`, startedAt: Date.now(),
      expiresAt, timer, killTimer: null, logs,
      type: strategy.runtime as 'node' | 'python' | 'custom', strategy,
    };
    running.set(taskId, preview);

    // Adaptive readiness detection
    const readiness = await detectReadiness(child, port, readinessMode, strategy.runtime, logs);
    preview.readiness = readiness;

    return {
      ok: readiness.ok, previewUrl: preview.url, previewId: taskId, type: preview.type,
      expiresAt, strategy, readiness,
      error: readiness.ok ? undefined : `Readiness check failed: ${readiness.reason}`,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to start preview', strategy };
  }
}

export function stopPreview(taskId: string): boolean {
  const p = running.get(taskId);
  if (!p) return false;
  clearTimeout(p.timer);
  if (p.killTimer) clearTimeout(p.killTimer);
  try { p.server?.close(); } catch {}
  try {
    if (p.process && !p.process.killed) {
      p.process.kill('SIGTERM');
      p.killTimer = setTimeout(() => {
        try { p.process?.kill('SIGKILL'); } catch {}
      }, SIGKILL_DELAY_MS);
    }
  } catch {}
  running.delete(taskId);
  return true;
}

export function getPreviewStatus(taskId: string) {
  const p = running.get(taskId);
  if (!p) return null;
  return {
    running: true, taskId, type: p.type, port: p.port,
    startedAt: p.startedAt, expiresAt: p.expiresAt,
    remainingMs: Math.max(0, p.expiresAt - Date.now()),
    logs: p.logs.slice(-50),
    strategy: p.strategy,
    readiness: p.readiness,
  };
}

export function getAllPreviews() {
  return Array.from(running.values()).map((p) => ({
    taskId: p.taskId, type: p.type, port: p.port,
    startedAt: p.startedAt, expiresAt: p.expiresAt,
    strategy: p.strategy,
    readiness: p.readiness,
  }));
}

/**
 * Returns the loopback port for a running, verified-ready preview, or null.
 * Used ONLY by the same-origin proxy route so the user's browser can reach
 * the host-local preview server. A preview that never passed HTTP readiness
 * (readiness.ok === false) is NOT proxyable — the proxy must not expose a
 * port that was never verified.
 */
export function getPreviewPort(taskId: string): number | null {
  const p = running.get(taskId);
  if (!p) return null;
  if (!p.readiness || !p.readiness.ok) return null;
  if (Date.now() > p.expiresAt) return null;
  return p.port;
}
