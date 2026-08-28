/**
 * Server-only half of the sandbox (v1.23): real Docker detection and the
 * guided-install consent payload. Split from sandbox.ts so client
 * components can import the tier DATA without dragging node:child_process
 * into the webpack graph (CI lesson: UnhandledSchemeError on node: URIs).
 */

import { exec } from 'node:child_process';

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
