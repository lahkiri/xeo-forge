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

const DEFAULT_UPDATE_SETTINGS = {
  channel: 'latest',
  autoCheck: true,
  intervalHours: 6,
};

function updateStatePath(userDataPath) {
  return path.join(userDataPath, 'update-state.json');
}

function updateSettingsPath(userDataPath) {
  return path.join(userDataPath, 'update-settings.json');
}

function initialUpdateState(currentVersion) {
  return {
    status: 'idle',
    currentVersion,
    version: null,
    percent: 0,
    message: '',
    channel: DEFAULT_UPDATE_SETTINGS.channel,
    lastCheckedAt: null,
    lastError: null,
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
    channel: value.channel === 'beta' ? 'beta' : 'latest',
    lastCheckedAt: typeof value.lastCheckedAt === 'string' ? value.lastCheckedAt : null,
    lastError: typeof value.lastError === 'string' ? value.lastError : null,
    downloadedAt: typeof value.downloadedAt === 'string' ? value.downloadedAt : undefined,
    releaseDate: typeof value.releaseDate === 'string' ? value.releaseDate : undefined,
    size: Number.isFinite(value.size) ? value.size : null,
    transferred: Number.isFinite(value.transferred) ? value.transferred : undefined,
    total: Number.isFinite(value.total) ? value.total : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
  };
}

function loadUpdateState(filePath, currentVersion, logger = console) {
  if (!existsSync(filePath)) return initialUpdateState(currentVersion);
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    const state = normalizePersistedState(parsed, currentVersion);
    if (state.status !== 'installing') return state;

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
      lastError: `Update did not complete. Xeo Forge is running ${currentVersion}.`,
      message: `Update did not complete. Xeo Forge is running ${currentVersion}.`,
    };
  } catch (error) {
    logger.error('[desktop] unable to read local update state', error);
    return {
      ...initialUpdateState(currentVersion),
      status: 'error',
      lastError: 'Update state could not be read.',
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

function loadUpdateSettings(filePath, logger = console) {
  if (!existsSync(filePath)) return { ...DEFAULT_UPDATE_SETTINGS };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return {
      channel: parsed?.channel === 'beta' ? 'beta' : 'latest',
      autoCheck: parsed?.autoCheck !== false,
      intervalHours: Number.isFinite(parsed?.intervalHours) ? Math.max(1, Math.min(168, Math.round(parsed.intervalHours))) : DEFAULT_UPDATE_SETTINGS.intervalHours,
    };
  } catch (error) {
    logger.error('[desktop] unable to read local update settings', error);
    return { ...DEFAULT_UPDATE_SETTINGS };
  }
}

function saveUpdateSettings(filePath, settings, logger = console) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const normalized = {
      channel: settings?.channel === 'beta' ? 'beta' : 'latest',
      autoCheck: settings?.autoCheck !== false,
      intervalHours: Number.isFinite(settings?.intervalHours) ? Math.max(1, Math.min(168, Math.round(settings.intervalHours))) : DEFAULT_UPDATE_SETTINGS.intervalHours,
    };
    writeFileSync(filePath, JSON.stringify(normalized, null, 2), { encoding: 'utf8', mode: 0o600 });
    return normalized;
  } catch (error) {
    logger.error('[desktop] unable to persist local update settings', error);
    return null;
  }
}

module.exports = {
  DEFAULT_UPDATE_SETTINGS,
  initialUpdateState,
  loadUpdateState,
  saveUpdateState,
  updateStatePath,
  loadUpdateSettings,
  saveUpdateSettings,
  updateSettingsPath,
};
