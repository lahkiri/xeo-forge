/**
 * Sandbox — three honest tiers (v1.23), the owner's design verbatim.
 *
 *  standard — today's behavior, LABELED as what it is: hardened in-process
 *             execution (path boundaries, env whitelist, command blocklist)
 *             but NO real OS-level isolation. The UI says so explicitly.
 *  strict   — the same process, materially tighter: an extra data-driven
 *             deny-rule layer (no network tools at all, no process
 *             management, shorter timeout), still not a kernel boundary.
 *  docker   — real isolation: every execution command runs inside a
 *             ephemeral container (workspace bind-mounted, CPU/memory
 *             capped, network disabled). Requires Docker on the machine;
 *             detection is a real probe, never an assumption. If Docker is
 *             missing, activating this tier surfaces a consent-based guided
 *             install flow — nothing downloads silently, and any mid-flight
 *             failure reverts to the previous working tier (fail-closed).
 *
 * The tier is DATA on the task row (tasks.sandbox_mode) and flows through
 * the same ToolContext as every other authority — it adds deny RULES, it
 * does not add a parallel permission path.
 */

import type { PermissionRule } from './permissions';

export type SandboxMode = 'standard' | 'strict' | 'docker';

export interface SandboxSpec {
  id: SandboxMode;
  label: string;
  /** Honest one-liner shown at choice time — no euphemisms. */
  describe: string;
  /** What the isolation actually IS, in plain words. */
  isolation: 'no OS-level isolation' | 'hardened process, no OS-level isolation' | 'real container isolation';
}

export const SANDBOX_MODES: readonly SandboxSpec[] = [
  {
    id: 'standard',
    label: 'Standard (no sandbox)',
    describe: 'Current hardened execution: workspace path boundaries, safe env, command blocklist — but the agent runs on your machine with full filesystem access. No OS-level isolation.',
    isolation: 'no OS-level isolation',
  },
  {
    id: 'strict',
    label: 'Strict (hardened)',
    describe: 'Tighter rules on the same process: network tools denied, process control denied, shorter timeouts. Still NOT OS-level isolation — a determined escape is not stopped by the kernel.',
    isolation: 'hardened process, no OS-level isolation',
  },
  {
    id: 'docker',
    label: 'Docker (real isolation)',
    describe: 'Every command runs in an ephemeral container: workspace bind-mounted, CPU and memory capped, network disabled. Requires Docker installed on this machine.',
    isolation: 'real container isolation',
  },
] as const;

const MODE_BY_ID = new Map(SANDBOX_MODES.map((m) => [m.id, m]));

export const DEFAULT_SANDBOX_MODE: SandboxMode = 'standard';

export function isSandboxMode(value: unknown): value is SandboxMode {
  return typeof value === 'string' && MODE_BY_ID.has(value as SandboxMode);
}

export function normalizeSandboxMode(value: unknown): SandboxMode {
  return isSandboxMode(value) ? value : DEFAULT_SANDBOX_MODE;
}

export function sandboxSpec(mode: unknown): SandboxSpec {
  return MODE_BY_ID.get(normalizeSandboxMode(mode)) ?? MODE_BY_ID.get(DEFAULT_SANDBOX_MODE)!;
}

/**
 * STRICT TIER ENFORCEMENT — as rule DATA, appended to the run's permission
 * rules (governance-inheritance, not a bypass). Ordered BEFORE the level's
 * own rules by effectiveRules composition at the call site.
 */
export function strictSandboxRules(): PermissionRule[] {
  return [
    { action: 'network', resource: '*', effect: 'deny', note: 'Sandbox strict: no network from commands or request tools' },
    { action: 'shell', resource: '*curl*', effect: 'deny', note: 'Sandbox strict: outbound transfer tool' },
    { action: 'shell', resource: '*wget*', effect: 'deny', note: 'Sandbox strict: outbound transfer tool' },
    { action: 'shell', resource: '*ssh*', effect: 'deny', note: 'Sandbox strict: remote access tool' },
    { action: 'shell', resource: '*scp*', effect: 'deny', note: 'Sandbox strict: remote transfer' },
    { action: 'shell', resource: '*kill*', effect: 'deny', note: 'Sandbox strict: process control' },
    { action: 'shell', resource: '*chmod 777*', effect: 'deny', note: 'Sandbox strict: permission loosening' },
    { action: 'subagent', resource: '*', effect: 'deny', note: 'Sandbox strict: delegation disabled' },
  ];
}

/**
 * Wrap a shell command for container execution. The workspace is mounted
 * read-write at /workspace (the agent's boundary), CPU/memory are capped,
 * and the network is OFF — a sandboxed command has no one to talk to.
 */
export function dockerWrapCommand(command: string, workDir: string, image = 'node:20-bookworm-slim'): string {
  const escaped = command.replace(/'/g, `'\\''`);
  return (
    `docker run --rm --network none ` +
    `--cpus 1 --memory 512m --pids-limit 128 ` +
    `-v "${workDir}:/workspace" -w /workspace ` +
    `${image} sh -c '${escaped}'`
  );
}
