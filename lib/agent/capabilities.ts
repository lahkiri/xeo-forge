/**
 * Capability manifest — the typed vocabulary for what a run may do.
 *
 * WHY THIS EXISTS (Phase 2 of the executive plan): the risk register's rule
 * is "the model never grants itself permission". Today policy lives in
 * scattered sets (WRITE_TOOLS, GIT_WRITE_OPS, browser SENSITIVE_ACTIONS,
 * MCP build-only). This module is the ONE typed namespace those checks
 * derive from, so a future policy engine, manifest storage, and Policy
 * Simulator consume a single vocabulary instead of five.
 *
 * WHAT THIS IS NOT YET: it does not replace the existing enforcement points
 * (executeTool, runGitOp, browser.ts) — those remain authoritative until the
 * broker milestone. This is the source-of-truth TYPE layer that mirrors
 * them exactly, plus the classifier functions they already embody. Each
 * enforcement point now imports its set FROM here, so drift becomes a
 * type-check error instead of a silent divergence.
 */

/** Every capability the runtime can name. Structured by domain. */
export type Capability =
  // filesystem
  | 'filesystem.workspace.read'
  | 'filesystem.workspace.write'
  // process
  | 'process.terminal.spawn'
  | 'process.preview.start'
  | 'process.code.execute'
  // network
  | 'network.http.public'
  // browser
  | 'browser.state'
  | 'browser.snapshot'
  | 'browser.navigate'
  | 'browser.interact'
  // vcs
  | 'vcs.git.read'
  | 'vcs.git.write'
  // external tools
  | 'mcp.server.call';

/** The risk class a capability carries. Drives mode gating and UI copy. */
export type CapabilityRisk = 'read' | 'mutate' | 'external';

export const CAPABILITY_RISK: Record<Capability, CapabilityRisk> = {
  'filesystem.workspace.read': 'read',
  'filesystem.workspace.write': 'mutate',
  'process.terminal.spawn': 'mutate',
  'process.preview.start': 'mutate',
  'process.code.execute': 'mutate',
  'network.http.public': 'external',
  'browser.state': 'read',
  'browser.snapshot': 'read',
  'browser.navigate': 'mutate',
  'browser.interact': 'mutate',
  'vcs.git.read': 'read',
  'vcs.git.write': 'mutate',
  'mcp.server.call': 'external',
};

/** Which tool names require which capability — the tool→capability map. */
export const TOOL_CAPABILITY: Record<string, Capability> = {
  file_read: 'filesystem.workspace.read',
  file_list: 'filesystem.workspace.read',
  file_write: 'filesystem.workspace.write',
  file_edit: 'filesystem.workspace.write',
  code_execute: 'process.code.execute',
  preview: 'process.preview.start',
  http_request: 'network.http.public',
  browser: 'browser.state', // per-action risk refined in browser.ts
  git_op: 'vcs.git.read', // write ops refined in git.ts
  terminal: 'process.terminal.spawn',
  // MCP namespaced tools (mcp__server__tool)
};

/** Capabilities available per run mode — mirrors executeTool's enforcement. */
export const MODE_CAPABILITIES: Record<'chat' | 'planning' | 'build', Set<Capability>> = {
  chat: new Set<Capability>([
    'filesystem.workspace.read',
    'network.http.public',
    'browser.state',
    'vcs.git.read',
  ]),
  planning: new Set<Capability>([
    'filesystem.workspace.read',
    'network.http.public',
    'browser.state',
    'vcs.git.read',
  ]),
  build: new Set<Capability>(Object.keys(CAPABILITY_RISK) as Capability[]),
};

/** Does `toolName` require a capability not granted in `mode`? */
export function toolBlockedInMode(toolName: string, mode: 'chat' | 'planning' | 'build'): boolean {
  const cap = TOOL_CAPABILITY[toolName];
  if (!cap) return false; // unknown tools handled by executeTool's default
  return !MODE_CAPABILITIES[mode].has(cap);
}

/** Human description for the Policy Simulator and governance rail. */
export const CAPABILITY_DESCRIPTION: Record<Capability, string> = {
  'filesystem.workspace.read': 'Read files inside the task workspace boundary.',
  'filesystem.workspace.write': 'Create, edit, or delete files in the workspace.',
  'process.terminal.spawn': 'Open an interactive terminal session on the host.',
  'process.preview.start': 'Start preview servers and host processes.',
  'process.code.execute': 'Run bash/python code (restricted host execution, not a sandbox).',
  'network.http.public': 'Make outbound HTTP requests to public origins.',
  'browser.state': 'Read the connected browser profile state.',
  'browser.snapshot': 'Read page content and capture screenshots.',
  'browser.navigate': 'Move the browser tab to a URL (sensitive).',
  'browser.interact': 'Click and type into live pages (sensitive).',
  'vcs.git.read': 'Inspect repository status, diff, log, branches.',
  'vcs.git.write': 'Stage, commit, checkout, revert inside the workspace repo.',
  'mcp.server.call': 'Call tools on user-configured MCP servers.',
};
