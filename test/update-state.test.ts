import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  loadUpdateState,
  saveUpdateState,
  updateStatePath,
  loadUpdateSettings,
  saveUpdateSettings,
  updateSettingsPath,
} = require('../desktop/electron/update-state.cjs');

describe('local OTA update state', () => {
  const directories: string[] = [];

  afterEach(() => {
    while (directories.length) rmSync(directories.pop() as string, { recursive: true, force: true });
  });

  it('persists an installing marker and reports success after the new version starts', () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'xeo-ota-'));
    directories.push(userData);
    const filePath = updateStatePath(userData);
    const logger = { error: vi.fn() };

    saveUpdateState(filePath, {
      status: 'installing',
      currentVersion: '1.3.0',
      previousVersion: '1.3.0',
      version: '1.3.1',
      percent: 100,
      message: 'Restarting to install update…',
    }, logger);

    const state = loadUpdateState(filePath, '1.3.1', logger);
    expect(state.status).toBe('success');
    expect(state.currentVersion).toBe('1.3.1');
    expect(state.previousVersion).toBe('1.3.0');
    expect(state.message).toContain('successfully');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reports an incomplete update when the app restarts on the old version', () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'xeo-ota-'));
    directories.push(userData);
    const filePath = updateStatePath(userData);
    const logger = { error: vi.fn() };

    writeFileSync(filePath, JSON.stringify({
      status: 'installing',
      previousVersion: '1.3.0',
      version: '1.3.1',
      percent: 100,
    }));

    const state = loadUpdateState(filePath, '1.3.0', logger);
    expect(state.status).toBe('error');
    expect(state.message).toContain('did not complete');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('persists safe updater preferences under userData and clamps invalid values', () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'xeo-ota-'));
    directories.push(userData);
    const filePath = updateSettingsPath(userData);
    const logger = { error: vi.fn() };

    const saved = saveUpdateSettings(filePath, { channel: 'beta', autoCheck: false, intervalHours: 999 }, logger);
    expect(saved).toEqual({ channel: 'beta', autoCheck: false, intervalHours: 168 });
    expect(loadUpdateSettings(filePath, logger)).toEqual(saved);
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(saved);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not persist remote telemetry and keeps state under userData', () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'xeo-ota-'));
    directories.push(userData);
    const filePath = updateStatePath(userData);
    const logger = { error: vi.fn() };

    saveUpdateState(filePath, {
      status: 'available',
      currentVersion: '1.3.1',
      version: '1.3.2',
      percent: 0,
      message: 'Update available.',
    }, logger);

    expect(filePath).toBe(path.join(userData, 'update-state.json'));
    expect(JSON.parse(readFileSync(filePath, 'utf8')).status).toBe('available');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
