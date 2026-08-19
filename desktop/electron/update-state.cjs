'use strict';

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const VALID_STATUSES = new Set([
  'idle',
  'checking',
  'available',
  'not-available',
  'downloading',
  'downloaded',
  'installing',
  'success',
  'error',
]);

function updateStatePath(userDataPath) {
  return path.join(userDataPath, 'update-state.json');
}

function initialUpdateState(currentVersion) {
  return {
    status: 'idle',
    currentVersion,
    version: null,
    percent: 0,
    message: '',
  };
}

function normalizePersistedState(value, currentVersion) {
  if (!value || typeof value !== 'object') return initialUpdateState(currentVersion);
  const status = typeof value.status === 'string' && VALID_STATUSES.has(value.status) ? value.status : 'idle';
  const version = typeof value.version === 'string' ? value.version : null;
  const previousVersion = typeof value.previousVersion === 'string' ? value.previousVersion : null;
  const percent = Number.isFinite(value.percent) ? Math.max(0, Math.min(100, value.percent)) : 0;
  return {
    ...initialUpdateState(currentVersion),
    status,
    version,
    previousVersion,
    percent,
    message: typeof value.message === 'string' ? value.message : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
  };
}

function loadUpdateState(filePath, currentVersion, logger = console) {
  if (!existsSync(filePath)) return initialUpdateState(currentVersion);
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    const state = normalizePersistedState(parsed, currentVersion);
    if (state.status !== 'installing') return initialUpdateState(currentVersion);

    if (state.version && state.version === currentVersion && state.previousVersion && state.previousVersion !== currentVersion) {
      return {
        ...state,
        status: 'success',
        message: `Update installed successfully. Xeo Forge is now ${currentVersion}.`,
      };
    }

    return {
      ...state,
      status: 'error',
      message: `Update did not complete. Xeo Forge is running ${currentVersion}.`,
    };
  } catch (error) {
    logger.error('[desktop] unable to read local update state', error);
    return {
      ...initialUpdateState(currentVersion),
      status: 'error',
      message: 'Update state could not be read. The application will continue normally.',
    };
  }
}

function saveUpdateState(filePath, state, logger = console) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    logger.error('[desktop] unable to persist local update state', error);
  }
}

module.exports = { initialUpdateState, loadUpdateState, saveUpdateState, updateStatePath };
