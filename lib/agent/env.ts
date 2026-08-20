/**
 * Environment variable detection — scans workspace files for env references.
 *
 * Detects patterns like process.env.X, os.environ["X"], ENV["X"] etc.
 * Returns detected var names for the user to provide.
 */

import fs from 'node:fs';
import path from 'node:path';
import { workspaceFor } from './files';

const IGNORE = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.cache']);

// Patterns that reference environment variables
const ENV_PATTERNS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,          // process.env.NODE_ENV
  /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g, // process.env['NODE_ENV']
  /os\.environ\.get\(['"]([A-Z_][A-Z0-9_]*)['"]\)/g, // os.environ.get('KEY')
  /os\.environ\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g, // os.environ['KEY']
  /ENV\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,         // ENV['KEY']
  /\$\{?([A-Z_][A-Z0-9_]*)\}?/g,                // $VAR or ${VAR} in shell scripts
];

// Well-known env vars that are part of the runtime, not user-provided
const SYSTEM_VARS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TZ', 'TERM', 'TMPDIR',
  'NODE_ENV', 'PORT', 'HOST', 'DATABASE_URL', 'MODEL_API_KEY', 'MODEL_BASE_URL',
  'MODEL_ID', 'MODEL_NAME', 'TASK_WORK_DIR', 'COOKIE_SECURE', 'ROOT_ADMIN_EMAIL',
  'ROOT_ADMIN_PASSWORD', 'DEFAULT_DAILY_GRANT', 'CREDITS_PER_TOOL_CALL',
]);

interface DetectResult {
  envVars: string[];
  files: { path: string; vars: string[] }[];
}

function scanFile(abs: string): string[] {
  try {
    const content = fs.readFileSync(abs, 'utf8');
    if (content.length > 500_000) return []; // skip huge files
    const vars = new Set<string>();
    for (const re of ENV_PATTERNS) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(content)) !== null) {
        const name = match[1];
        if (name && !SYSTEM_VARS.has(name)) {
          vars.add(name);
        }
      }
    }
    return Array.from(vars);
  } catch {
    return [];
  }
}

export function detectEnvVars(taskId: string): DetectResult {
  const root = workspaceFor(taskId);
  if (!fs.existsSync(root)) return { envVars: [], files: [] };

  const allVars = new Set<string>();
  const files: { path: string; vars: string[] }[] = [];

  const walk = (dir: string, rel: string) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (IGNORE.has(e.name)) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          walk(path.join(dir, e.name), childRel);
        } else if (/\.(js|ts|jsx|tsx|py|sh|env|yaml|yml|json|toml|cfg|ini|conf)$/i.test(e.name)) {
          const vars = scanFile(path.join(dir, e.name));
          if (vars.length > 0) {
            files.push({ path: childRel, vars });
            vars.forEach((v) => allVars.add(v));
          }
        }
      }
    } catch (err) {
      // An unreadable subdirectory (permissions, broken symlink, race with the
      // agent writing files) must not abort the whole scan — but it is logged
      // so a systematically unreadable workspace is visible (AGENTS.md rule 3).
      console.warn(`[env] skipped unreadable directory ${dir}:`, err instanceof Error ? err.message : err);
    }
  };

  walk(root, '');
  return { envVars: Array.from(allVars).sort(), files };
}
