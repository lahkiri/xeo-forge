/**
 * Tool definitions + dispatch. The only tools the agent has (AGENTS.md §7).
 *
 * executeTool() runs a single tool call against a per-task ToolContext and
 * returns a string result (clamped). task_complete is handled by the loop,
 * not here (it terminates the run rather than producing an observation).
 */

import type OpenAI from 'openai';
import type { TaskMode } from '../types';
import { z } from 'zod';
import { FileTool } from './files';
import { CodeTool } from './code';
import { analyzeProject, startPreviewWithStrategy, stopPreview, getPreviewStatus } from './preview';

const MAX_RESULT_CHARS = 8000;

/**
 * Tools that mutate state. These are HARD-LOCKED in planning mode (read-only).
 * Planning mode may only inspect: file_read, file_list, http_request.
 */
export const WRITE_TOOLS = new Set(['file_write', 'file_edit', 'code_execute']);

/** Tools available to a planning-mode run (read-only + completion). */
export const PLANNING_TOOLS = new Set(['file_read', 'file_list', 'http_request', 'task_complete']);

export interface ToolContext {
  taskId: string;
  mode: TaskMode;
  files: FileTool;
  code: CodeTool;
}

export function createToolContext(taskId: string, mode: TaskMode): ToolContext {
  return { taskId, mode, files: new FileTool(taskId), code: new CodeTool(taskId) };
}

/**
 * Tool schemas offered to the model for a given mode. In planning mode only the
 * read-only inspection tools (+ task_complete) are advertised, so the model is
 * steered away from writes — and executeTool enforces the lock regardless.
 */
export function schemasForMode(mode: TaskMode): OpenAI.Chat.Completions.ChatCompletionTool[] {
  if (mode === 'planning') {
    return TOOL_SCHEMAS.filter((t) => PLANNING_TOOLS.has(t.function.name));
  }
  return TOOL_SCHEMAS;
}

/** OpenAI tool schema for native tool-calling models. */
export const TOOL_SCHEMAS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'file_read',
      description: 'Read a UTF-8 text file from the task workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative path within the workspace.' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_write',
      description: 'Create or overwrite a file in the task workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_edit',
      description: 'Replace a unique snippet in an existing file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_list',
      description: 'List files in the task workspace (recursively).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Optional subdirectory; defaults to root.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'code_execute',
      description: 'Run bash or python code in the sandboxed workspace. Returns stdout/stderr/exit code.',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['bash', 'python'] },
          code: { type: 'string' },
        },
        required: ['language', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description: 'Make an HTTP request and return status + body (truncated).',
      parameters: {
        type: 'object',
        properties: {
          method: { type: 'string' },
          url: { type: 'string' },
          headers: { type: 'object' },
          body: { type: 'string' },
        },
        required: ['method', 'url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_complete',
      description: 'Finish the task with a concise summary. Call exactly once.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          memory_candidates: {
            type: 'array',
            maxItems: 8,
            description: 'Optional durable learning proposals. Stored as user-reviewable memories, never as permissions.',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', maxLength: 1200 },
                kind: { type: 'string', enum: ['preference', 'fact', 'decision', 'constraint', 'lesson'] },
                scope: { type: 'string', enum: ['global', 'task'] },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['content', 'kind', 'scope', 'confidence'],
            },
          },
        },
        required: ['summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'todo_update',
      description: 'Update the task todo list. Send the COMPLETE current state every time. Each call replaces the entire list. Maximum 5 items. Each item = ONE concrete verifiable action. Delete obsolete items. Update AFTER doing, not before.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique item identifier (e.g. "1", "setup")' },
                description: { type: 'string', description: 'What needs to be done' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: 'Current status' },
              },
              required: ['id', 'description', 'status'],
            },
            description: 'Complete current todo list state',
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview',
      description: 'Analyze, start, stop, or check status of a preview server. Use "analyze" first to inspect the project and determine the correct runtime strategy. Then "start" with the strategy you decided based on the analysis. The tool handles port allocation, build, process spawning, and adaptive readiness detection. NEVER assume a runtime — always analyze first.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['analyze', 'start', 'stop', 'status'], description: 'analyze: inspect project structure; start: launch with your strategy; stop: kill preview; status: check running preview' },
          runtime: { type: 'string', enum: ['static', 'node', 'python', 'custom'], description: 'Runtime type (from analyze or your decision)' },
          entryFile: { type: 'string', description: 'Main entry file relative to workspace (from analyze)' },
          buildCommand: { type: 'string', description: 'Build command to run before starting (e.g. "npm run build")' },
          startCommand: { type: 'string', description: 'Start command (e.g. "node server.js", "python3 app.py", "npx next start")' },
          port: { type: 'number', description: 'Preferred port (0 = auto-assign). Framework default ports are preferred when known.' },
          ttlMs: { type: 'number', description: 'Time-to-live in ms (default: 1800000 = 30min)' },
          envVars: { type: 'object', description: 'Environment variables to inject', additionalProperties: { type: 'string' } },
          serveRoot: { type: 'string', description: 'Subdirectory to serve static files from (e.g. "dist", "build"). Resolved within workspace. Only affects filesystem serving target — does not affect readiness.' },
        },
        required: ['action'],
      },
    },
  },
];

export const TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.function.name);

function clamp(s: string): string {
  if (s.length <= MAX_RESULT_CHARS) return s;
  return s.slice(0, MAX_RESULT_CHARS) + `\n…[truncated ${s.length - MAX_RESULT_CHARS} chars]`;
}

/** Zod schemas for tool arguments — enforced at dispatch, not just offered to the model. */
const toolArgSchemas: Record<string, z.ZodTypeAny> = {
  file_read: z.object({ path: z.string().min(1) }),
  file_write: z.object({ path: z.string().min(1), content: z.string() }),
  file_edit: z.object({ path: z.string().min(1), old_string: z.string().min(1), new_string: z.string() }),
  file_list: z.object({ path: z.string().optional() }),
  code_execute: z.object({ language: z.enum(['bash', 'python']), code: z.string().min(1) }),
  http_request: z.object({
    method: z.string().min(1),
    url: z.string().min(1),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
  }),
  task_complete: z.object({
    summary: z.string().min(1),
    memory_candidates: z.array(z.object({
      content: z.string().min(1).max(1200),
      kind: z.enum(['preference', 'fact', 'decision', 'constraint', 'lesson']),
      scope: z.enum(['global', 'task']),
      confidence: z.number().min(0).max(1),
    })).max(8).optional(),
  }),
  todo_update: z.object({
    items: z.array(z.object({
      id: z.string().min(1),
      description: z.string().min(1),
      status: z.enum(['pending', 'in_progress', 'done']),
    })),
  }),
  preview: z.object({
    action: z.enum(['analyze', 'start', 'stop', 'status']),
    runtime: z.enum(['static', 'node', 'python', 'custom']).optional(),
    entryFile: z.string().optional(),
    buildCommand: z.string().optional(),
    startCommand: z.string().optional(),
    port: z.number().int().min(0).max(65535).optional(),
    ttlMs: z.number().int().min(1000).max(3600000).optional(),
    envVars: z.record(z.string()).optional(),
    serveRoot: z.string().optional(),
  }),
};

function validateArgs(name: string, args: Record<string, any>): void {
  const schema = toolArgSchemas[name];
  if (!schema) return; // unknown tools are caught by the switch default
  const result = schema.safeParse(args);
  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join('; ');
    throw new Error(`Invalid arguments for ${name}: ${issues}`);
  }
}

/** SSRF protection: block requests to private/loopback/cloud-metadata IPs. */
function assertSafeUrl(urlStr: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('http_request: invalid URL');
  }
  let hostname = parsed.hostname.toLowerCase();

  // Normalize IPv4-mapped IPv6: ::ffff:127.0.0.1 → 127.0.0.1
  if (hostname.startsWith('::ffff:')) {
    hostname = hostname.slice(7);
  }
  // Strip IPv6 brackets
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  // Block IPv6 loopback
  if (hostname === '::1' || hostname === '[::1]') {
    throw new Error('http_request: requests to loopback addresses are blocked');
  }

  // Numeric IPv4 checks — handle octal (0177.0.0.1) and hex (0x7f.0.0.1) too
  let ipv4Parts: number[] | null = null;

  // Standard dotted decimal
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    ipv4Parts = ipv4Match.map(Number);
  }

  // Octal format: 0177.0.0.1
  if (!ipv4Parts) {
    const octalMatch = hostname.match(/^0(\d{1,3})\.0(\d{1,3})\.0(\d{1,3})\.0(\d{1,3})$/);
    if (octalMatch) {
      ipv4Parts = octalMatch.map((s, i) => (i === 0 ? parseInt(s, 8) : parseInt(s, 8)));
    }
  }

  // Hex format: 0x7f.0x0.0x0.0x1
  if (!ipv4Parts) {
    const hexMatch = hostname.match(/^(0x[0-9a-f]+)\.(0x[0-9a-f]+)\.(0x[0-9a-f]+)\.(0x[0-9a-f]+)$/i);
    if (hexMatch) {
      ipv4Parts = hexMatch.map((s) => parseInt(s, 16));
    }
  }

  // Decimal format: 2130706433 = 127.0.0.1
  if (!ipv4Parts && /^\d{1,10}$/.test(hostname)) {
    const val = parseInt(hostname, 10);
    if (val >= 0 && val <= 0xFFFFFFFF) {
      ipv4Parts = [(val >>> 24) & 0xFF, (val >>> 16) & 0xFF, (val >>> 8) & 0xFF, val & 0xFF];
    }
  }

  if (ipv4Parts) {
    const [a, b] = ipv4Parts;
    if (a === 127) throw new Error('http_request: requests to loopback addresses are blocked');
    if (a === 10) throw new Error('http_request: requests to private network addresses are blocked');
    if (a === 172 && b >= 16 && b <= 31) throw new Error('http_request: requests to private network addresses are blocked');
    if (a === 192 && b === 168) throw new Error('http_request: requests to private network addresses are blocked');
    if (a === 169 && b === 254) throw new Error('http_request: requests to link-local/metadata addresses are blocked');
    if (a === 0 && hostname === '0.0.0.0') throw new Error('http_request: requests to 0.0.0.0 are blocked');
    if (a === 100 && b >= 64 && b <= 127) throw new Error('http_request: requests to carrier-grade NAT are blocked');
  }

  // Hostname-based cloud metadata bypass prevention
  const metadataHosts = ['instance-data', 'metadata.google.internal', '169.254.169.254'];
  if (metadataHosts.includes(hostname)) {
    throw new Error('http_request: requests to cloud metadata endpoints are blocked');
  }

  // Block localhost aliases
  const blockedHostnames = ['localhost', 'local', 'broadcasthost'];
  if (blockedHostnames.includes(hostname)) {
    throw new Error('http_request: requests to localhost are blocked');
  }
}

async function httpRequest(args: Record<string, any>): Promise<string> {
  const method = String(args.method || 'GET').toUpperCase();
  const url = String(args.url || '');
  if (!/^https?:\/\//i.test(url)) throw new Error('http_request: url must be http(s)');
  assertSafeUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method,
      headers: (args.headers as Record<string, string>) || undefined,
      body: args.body != null && method !== 'GET' && method !== 'HEAD' ? String(args.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    return `HTTP ${res.status} ${res.statusText}\n\n${text}`;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Execute one tool call. Returns the observation string.
 * Throws on programmer/argument errors; the loop catches and feeds the error
 * back to the model as the tool result.
 */
export async function executeTool(name: string, args: Record<string, any>, ctx: ToolContext): Promise<string> {
  // System-level enforcement: planning mode is strictly read-only. Write/exec
  // tools are hard-locked here at the single dispatch chokepoint, regardless of
  // what the model was told or attempts.
  if (ctx.mode === 'planning' && WRITE_TOOLS.has(name)) {
    throw new Error(
      `Tool "${name}" is locked in planning mode. Planning is read-only; produce a plan and call task_complete. The user must approve the plan before any build (write/execute) can run.`,
    );
  }
  // Validate arguments against Zod schemas before dispatch.
  validateArgs(name, args);
  switch (name) {
    case 'file_read':
      return clamp(await ctx.files.read(String(args.path)));
    case 'file_write':
      await ctx.files.write(String(args.path), String(args.content ?? ''));
      return `Wrote ${args.path}`;
    case 'file_edit':
      await ctx.files.edit(String(args.path), String(args.old_string), String(args.new_string));
      return `Edited ${args.path}`;
    case 'file_list': {
      const list = await ctx.files.list(args.path ? String(args.path) : '.');
      return clamp(list.join('\n') || '(empty)');
    }
    case 'code_execute': {
      const lang = String(args.language || 'bash');
      const code = String(args.code ?? '');
      const result = lang === 'python' ? await ctx.code.python(code) : await ctx.code.bash(code);
      return clamp(
        `exit=${result.exitCode}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    }
    case 'http_request':
      return clamp(await httpRequest(args));
    case 'preview': {
      const action = String(args.action || 'status');
      if (action === 'analyze') {
        const analysis = await analyzeProject(ctx.taskId);
        return clamp(JSON.stringify(analysis, null, 2));
      }
      if (action === 'stop') {
        const stopped = stopPreview(ctx.taskId);
        return JSON.stringify({ ok: true, stopped });
      }
      if (action === 'status') {
        const status = getPreviewStatus(ctx.taskId);
        return JSON.stringify({ preview: status });
      }
      if (action === 'start') {
        const strategy = {
          runtime: String(args.runtime || 'static') as 'static' | 'node' | 'python' | 'custom',
          entryFile: args.entryFile ? String(args.entryFile) : undefined,
          buildCommand: args.buildCommand ? String(args.buildCommand) : undefined,
          startCommand: args.startCommand ? String(args.startCommand) : undefined,
          port: typeof args.port === 'number' ? args.port : undefined,
          ttlMs: typeof args.ttlMs === 'number' ? args.ttlMs : undefined,
          serveRoot: args.serveRoot ? String(args.serveRoot) : undefined,
        };
        const result = await startPreviewWithStrategy(ctx.taskId, strategy, (args.envVars as Record<string, string>) || {});
        return clamp(JSON.stringify(result, null, 2));
      }
      throw new Error(`Unknown preview action: ${action}`);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
