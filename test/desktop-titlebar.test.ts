import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Desktop titlebar (desktop-parity batch, Phase 1.1).
 *
 * The live report: the default Electron frame (raw OS min/max/close buttons)
 * broke the app's entire visual identity while the SaaS captures showed no
 * such barrier. The fix: frame: false + a custom titlebar drawn from the
 * same design tokens, on Windows and Linux alike, with the window controls
 * going through IPC as the ONLY path.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('the OS frame is gone and the app owns the identity', () => {
  it('creates the window frameless', () => {
    expect(readSrc('desktop/electron/main.cjs')).toMatch(/frame: false/);
  });

  it('window controls exist only as IPC — no parallel path', () => {
    const main = readSrc('desktop/electron/main.cjs');
    expect(main).toMatch(/ipcMain\.handle\('window:minimize'/);
    expect(main).toMatch(/ipcMain\.handle\('window:maximize:toggle'/);
    expect(main).toMatch(/ipcMain\.handle\('window:close'/);
    const preload = readSrc('desktop/electron/preload.cjs');
    expect(preload).toMatch(/windowMinimize: \(\) => ipcRenderer\.invoke\('window:minimize'\)/);
    expect(preload).toMatch(/windowMaximizeToggle: \(\) => ipcRenderer\.invoke\('window:maximize:toggle'\)/);
    expect(preload).toMatch(/windowClose: \(\) => ipcRenderer\.invoke\('window:close'\)/);
  });

  it('the maximize state is published to the renderer', () => {
    const main = readSrc('desktop/electron/main.cjs');
    expect(main).toMatch(/mainWindow\.on\('maximize', publishMaximized\)/);
    expect(main).toMatch(/mainWindow\.on\('unmaximize', publishMaximized\)/);
    expect(readSrc('desktop/electron/preload.cjs')).toMatch(/onWindowMaximized/);
  });
});

describe('the custom titlebar matches the design system', () => {
  const bar = readSrc('components/DesktopTitleBar.tsx');

  it('renders only inside the Desktop shell', () => {
    expect(bar).toMatch(/if \(!isDesktop\) return null;/);
    expect(bar).toMatch(/window\.xeoDesktop/);
  });

  it('is a drag region with no-drag window controls', () => {
    expect(bar).toMatch(/WebkitAppRegion: 'drag'/);
    expect(bar).toMatch(/WebkitAppRegion: 'noDrag'/);
  });

  it('carries aria-labels for all three controls and the app shell mounts it', () => {
    expect(bar).toMatch(/aria-label="Minimize window"/);
    expect(bar).toMatch(/aria-label=\{maximized \? 'Restore window' : 'Maximize window'\}/);
    expect(bar).toMatch(/aria-label="Close window"/);
    const shell = readSrc('components/AppShell.tsx');
    expect(shell).toMatch(/<DesktopTitleBar \/>/);
  });
});
