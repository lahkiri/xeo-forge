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

import { exec } from 'node:child_process';
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

/* ------------------------------------------------------------------ */
/*  Docker tier — real detection, real containment, honest failures    */
/* ------------------------------------------------------------------ */

export interface DockerStatus {
  available: boolean;
  version?: string;
  /** Human, actionable — what the UI shows verbatim. */
  detail: string;
}

/** Real probe: `docker version` with a hard timeout. Never assumes. */
export function detectDocker(timeoutMs = 8000): Promise<DockerStatus> {
  return new Promise((resolve) => {
    const child = exec('docker version --format {{.Server.Version}}', { timeout: timeoutMs }, (err, stdout) => {
      if (err) {
        resolve({
          available: false,
          detail:
            'Docker is not reachable on this machine. Install (or start) Docker Desktop, then re-check. Nothing was downloaded or changed by Xeo Forge.',
        });
        return;
      }
      const version = String(stdout).trim();
      resolve({
        available: Boolean(version),
        version: version || undefined,
        detail: version ? `Docker ${version} is running and ready.` : 'Docker responded without a version.',
      });
    });
    child.on('error', () => {
      resolve({
        available: false,
        detail:
          'Docker is not installed on this machine. Xeo Forge will offer a guided install with your explicit consent — nothing downloads silently.',
      });
    });
  });
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

/**
 * Guided-install consent payload — what the UI needs to ask BEFORE anything
 * happens. Download happens only after explicit approval, by opening the
 * official installer page for the OS; the app never streams an installer
 * itself and never elevates privileges on its own.
 */
export function dockerInstallGuidance(platform: string): {
  title: string;
  steps: string[];
  downloadUrl: string;
  approxDownload: string;
} {
  if (platform === 'win32') {
    return {
      title: 'Install Docker Desktop (Windows)',
      steps: [
        'Download Docker Desktop from the official page (opens in your browser).',
        'Run the installer (requires Administrator approval — Windows will ask).',
        'Restart when the installer offers, then open Docker Desktop once.',
        'Return here and press "Re-check Docker" — activation is one click.',
      ],
      downloadUrl: 'https://www.docker.com/products/docker-desktop/',
      approxDownload: '~500 MB',
    };
  }
  if (platform === 'darwin') {
    return {
      title: 'Install Docker Desktop (macOS)',
      steps: [
        'Download Docker Desktop for your chip (Apple Silicon or Intel).',
        'Drag it to Applications and launch it once.',
        'Grant the permissions it asks for.',
        'Return here and press "Re-check Docker".',
      ],
      downloadUrl: 'https://www.docker.com/products/docker-desktop/',
      approxDownload: '~600 MB',
    };
  }
  return {
    title: 'Install Docker Engine (Linux)',
    steps: [
      'Run the official convenience script in a terminal, or use your distro packages.',
      'Enable and start the service: sudo systemctl enable --now docker.',
      'Add your user to the docker group if you prefer passwordless runs.',
      'Return here and press "Re-check Docker".',
    ],
    downloadUrl: 'https://docs.docker.com/engine/install/',
    approxDownload: '~300 MB',
  };
}
