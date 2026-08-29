const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { autoUpdater } = require('electron-updater');
const { startBrowserBridge: createBrowserBridge } = require('./browser-bridge.cjs');
const {
  loadUpdateState,
  saveUpdateState,
  updateStatePath,
  loadUpdateSettings,
  saveUpdateSettings,
  updateSettingsPath,
} = require('./update-state.cjs');
const { browserPolicyPath } = require('./browser-policy.cjs');

const APP_PORT = Number(process.env.XEO_APP_PORT || 3100);
const BROKER_PORT = Number(process.env.XEO_RUNTIME_PORT || 4317);
const BROWSER_PORT = Number(process.env.XEO_BROWSER_PORT || 4321);
const projectRoot = path.resolve(__dirname, '..', '..');
let nextProcess;
let brokerProcess;
let mainWindow;
let updateTimer;
let updateInterval;
let browserBridge;
let runtimeToken = '';
let updateStateFile;
let updateSettingsFile;
let updateSettings = { channel: 'latest', autoCheck: true, intervalHours: 6 };
let updateState = { status: 'idle', currentVersion: app.getVersion(), version: null, percent: 0, message: '', channel: 'latest', lastCheckedAt: null, lastError: null };

function projectConfigPath() {
  return path.join(app.getPath('userData'), 'project.json');
}

function browserTokenPath() {
  return path.join(app.getPath('userData'), 'browser-token');
}

function browserPreferencePath() {
  return path.join(app.getPath('userData'), 'browser-profile.json');
}

function browserPolicyFile() {
  return browserPolicyPath(app.getPath('userData'));
}

function browserApprovedFile() {
  return path.join(app.getPath('userData'), 'browser-approved.json');
}

function runtimeTokenPath() {
  return path.join(app.getPath('userData'), 'runtime-token');
}

/**
 * Read or mint the shared secret for the Go runtime broker.
 *
 * /v1/processes starts arbitrary local executables, so the broker refuses
 * process control unless this token is configured. It is generated per install,
 * stored 0600 under userData, and passed to the broker and the Next server only
 * through the environment — never to a renderer.
 */
function getRuntimeToken() {
  try {
    const token = readFileSync(runtimeTokenPath(), 'utf8').trim();
    if (token.length >= 32) return token;
    console.warn('[desktop] stored runtime broker token was too short; minting a new one');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[desktop] could not read runtime broker token, minting a new one:', error?.message || error);
    }
  }
  const token = crypto.randomBytes(32).toString('hex');
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(runtimeTokenPath(), token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

function getBrowserToken() {
  try {
    const token = readFileSync(browserTokenPath(), 'utf8').trim();
    if (token.length >= 32) return token;
    console.warn('[desktop] stored browser bridge token was too short; minting a new one');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[desktop] could not read browser bridge token, minting a new one:', error?.message || error);
    }
  }
  const token = crypto.randomBytes(32).toString('hex');
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(browserTokenPath(), token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

function startBrowserBridge() {
  if (process.env.XEO_DISABLE_BROWSER === '1') return;
  browserBridge = createBrowserBridge({
    port: BROWSER_PORT,
    token: getBrowserToken(),
    preferencePath: browserPreferencePath(),
    policyPath: browserPolicyFile(),
    approvedPath: browserApprovedFile(),
  });
}

function browserState() {
  return {
    ...(browserBridge?.state() || {
      connected: false,
      selection: 'selection_required',
      selectedBrowserId: null,
      selectedProfile: null,
      profiles: [],
      tab: null,
      permissions: [],
    }),
    port: BROWSER_PORT,
    token: browserBridge?.token || null,
    browserPolicy: browserBridge?.getPolicy?.() || null,
  };
}

function readStoredProjectPath() {
  try {
    const value = JSON.parse(readFileSync(projectConfigPath(), 'utf8'));
    return typeof value.path === 'string' && existsSync(value.path) ? value.path : null;
  } catch {
    return null;
  }
}

function saveProjectPath(projectPath) {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(projectConfigPath(), JSON.stringify({ path: projectPath }, null, 2), 'utf8');
  return { path: projectPath };
}

ipcMain.handle('project:get', () => ({ path: readStoredProjectPath() }));
ipcMain.handle('project:set', (_event, projectPath) => {
  if (typeof projectPath !== 'string' || !existsSync(projectPath)) return { path: null, error: 'Project folder does not exist.' };
  return saveProjectPath(path.resolve(projectPath));
});
function publishUpdate(status, values = {}) {
  updateState = { ...updateState, status, ...values, currentVersion: app.getVersion() };
  if (updateStateFile) saveUpdateState(updateStateFile, updateState);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', updateState);
}

function updaterSupported() {
  if (!app.isPackaged || process.env.XEO_DISABLE_UPDATES === '1') return false;
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);
  return ['win32', 'darwin'].includes(process.platform);
}

function configureUpdater() {
  // Development, smoke-test, and non-AppImage Linux runs must never contact the release feed.
  if (!updaterSupported()) return;
  const channel = updateSettings.channel;
  autoUpdater.autoDownload = false;
  // The Restart to update action owns installation explicitly. Keeping the
  // implicit quit hook enabled can create a second installer invocation while
  // Electron is shutting down, so disable it and use one deterministic path.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = channel === 'beta';
  autoUpdater.channel = channel;
  updateState.channel = channel;
  autoUpdater.on('checking-for-update', () => publishUpdate('checking', { message: 'Checking the Xeo Forge release channel…', lastCheckedAt: new Date().toISOString(), lastError: null }));
  autoUpdater.on('update-available', (info) => publishUpdate('available', { version: info.version, releaseDate: info.releaseDate, size: info.files?.[0]?.size || null, lastError: null, message: `Xeo Forge ${info.version} is available.` }));
  autoUpdater.on('update-not-available', () => publishUpdate('not-available', { version: null, lastError: null, message: 'Xeo Forge is up to date.' }));
  autoUpdater.on('download-progress', (progress) => publishUpdate('downloading', { version: updateState.version, percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total, message: 'Downloading update in the background…' }));
  autoUpdater.on('update-downloaded', (info) => publishUpdate('downloaded', { version: info.version, percent: 100, downloadedAt: new Date().toISOString(), message: 'Update ready. Restart Xeo Forge to install it.' }));
  autoUpdater.on('error', (error) => publishUpdate('error', { lastError: error instanceof Error ? error.message : String(error), message: error instanceof Error ? error.message : String(error) }));
  scheduleUpdateChecks();
}

function checkForUpdates() {
  if (!updaterSupported()) return Promise.resolve(updateState);
  publishUpdate('checking', { lastCheckedAt: new Date().toISOString(), lastError: null, message: 'Checking the Xeo Forge release channel…' });
  return autoUpdater.checkForUpdates()
    .then(() => updateState)
    .catch((error) => {
      publishUpdate('error', { lastError: error instanceof Error ? error.message : String(error), message: error instanceof Error ? error.message : String(error) });
      return updateState;
    });
}

function scheduleUpdateChecks() {
  if (updateTimer) clearTimeout(updateTimer);
  if (updateInterval) clearInterval(updateInterval);
  if (!updaterSupported() || !updateSettings.autoCheck) return;
  // Give the local server and renderer time to start, then use a persisted interval.
  updateTimer = setTimeout(() => { void checkForUpdates(); }, 15000);
  updateTimer.unref?.();
  updateInterval = setInterval(() => { void checkForUpdates(); }, updateSettings.intervalHours * 60 * 60 * 1000);
  updateInterval.unref?.();
}

ipcMain.handle('update:state', () => updateState);
ipcMain.handle('update:settings', () => updateSettings);
ipcMain.handle('update:settings:set', (_event, nextSettings) => {
  const saved = saveUpdateSettings(updateSettingsFile, nextSettings);
  if (!saved) throw new Error('Could not save update settings.');
  updateSettings = saved;
  updateState.channel = saved.channel;
  publishUpdate(updateState.status, { channel: saved.channel });
  scheduleUpdateChecks();
  return updateSettings;
});
ipcMain.handle('update:check', async () => checkForUpdates());
ipcMain.handle('update:download', async () => {
  if (updateState.status !== 'available') return updateState;
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    publishUpdate('error', { message: error instanceof Error ? error.message : String(error) });
  }
  return updateState;
});
ipcMain.handle('update:install', () => {
  if (updateState.status !== 'downloaded') return updateState;
  publishUpdate('installing', {
    previousVersion: app.getVersion(),
    message: 'Restarting to install update…',
  });
  setImmediate(launchDownloadedUpdate);
  return updateState;
});
ipcMain.handle('browser:state', () => browserState());
ipcMain.handle('browser:select', (_event, browserId) => {
  if (!browserBridge) throw new Error('Browser bridge is disabled.');
  return browserBridge.selectBrowser(browserId);
});
ipcMain.handle('browser:pairing:approve', (_event, pairingId) => {
  if (!browserBridge) throw new Error('Browser bridge is disabled.');
  return browserBridge.approvePairing(pairingId);
});
ipcMain.handle('browser:pairing:deny', (_event, pairingId) => {
  if (!browserBridge) throw new Error('Browser bridge is disabled.');
  return browserBridge.denyPairing(pairingId);
});
ipcMain.handle('browser:policy', () => browserBridge?.getPolicy?.() || null);
ipcMain.handle('browser:policy:set', (_event, policy) => {
  if (!browserBridge) throw new Error('Browser bridge is disabled.');
  return browserBridge.setPolicy(policy);
});
ipcMain.handle('browser:open-extension', async () => shell.openPath(resourcePath('browser-extension')));

ipcMain.handle('project:choose', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose a project folder',
    defaultPath: readStoredProjectPath() || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { path: readStoredProjectPath() };
  const project = saveProjectPath(result.filePaths[0]);
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('project:changed', project));
  return project;
});

function resourcePath(...parts) {
  const root = app.isPackaged ? process.resourcesPath : projectRoot;
  return path.join(root, ...parts);
}

function startRuntimeBroker() {
  const executable = process.platform === 'win32' ? 'xeo-forge-runtime-broker.exe' : 'xeo-forge-runtime-broker';
  const brokerPath = resourcePath('native', executable);
  if (!existsSync(brokerPath)) {
    console.warn(`[desktop] runtime broker not bundled: ${brokerPath}`);
    return;
  }
  runtimeToken = getRuntimeToken();
  brokerProcess = spawn(brokerPath, [], {
    env: {
      ...process.env,
      // Loopback only. The broker itself refuses a non-loopback bind unless
      // XEO_RUNTIME_ALLOW_PUBLIC=1, which the desktop shell never sets.
      XEO_RUNTIME_ADDR: `127.0.0.1:${BROKER_PORT}`,
      XEO_RUNTIME_TOKEN: runtimeToken,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  brokerProcess.on('error', (error) => console.error('[desktop] broker error', error));
}

function startNextServer() {
  const serverPath = resourcePath('app', 'server.js');
  if (!existsSync(serverPath)) throw new Error(`Packaged Next server is missing: ${serverPath}`);
  const localDbPath = path.join(app.getPath('userData'), 'data', 'xeo.db');
  nextProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      XEO_DESKTOP_LOCAL: '1',
      DB_PATH: process.env.DB_PATH || localDbPath,
      XEO_PROJECT_ROOT: readStoredProjectPath() || '',
      XEO_BROWSER_PORT: String(BROWSER_PORT),
      XEO_BROWSER_TOKEN: browserBridge?.token || '',
      XEO_BROWSER_POLICY_PATH: browserPolicyFile(),
      XEO_RUNTIME_PORT: String(BROKER_PORT),
      XEO_RUNTIME_TOKEN: runtimeToken,
      PORT: String(APP_PORT),
      HOSTNAME: '127.0.0.1',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  nextProcess.on('error', (error) => console.error('[desktop] Next server error', error));
}

async function waitForApp(url, attempts = 80) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch (error) {
      // Connection refused while the Next server boots is the expected case.
      // Retained so the timeout below can report why it never came up.
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const detail = lastError ? ` (last error: ${lastError.message || lastError})` : '';
  throw new Error(`Xeo Forge did not become ready at ${url}${detail}`);
}

async function createWindow() {
  startRuntimeBroker();
  startNextServer();
  const url = `http://127.0.0.1:${APP_PORT}/`;
  await waitForApp(url);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#080c14',
    autoHideMenuBar: true,
    title: 'Xeo Forge — Control Plane for Agentic Work',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://')) shell.openExternal(target);
    return { action: 'deny' };
  });
  await mainWindow.loadURL(url);
  mainWindow.webContents.send('update:status', updateState);
}

function stopChild(child) {
  if (!child || child.killed) return;
  child.kill();
}

function stopRuntimeForUpdate() {
  browserBridge?.close();
  stopChild(nextProcess);
  stopChild(brokerProcess);
}

function launchDownloadedUpdate() {
  // electron-updater normally supplies these exact NSIS flags. Launching the
  // Windows installer explicitly makes the unattended contract observable and
  // prevents a second app-quit path from falling back to an interactive setup.
  if (process.platform === 'win32') {
    const installerPath = autoUpdater.installerPath;
    if (typeof installerPath === 'string' && installerPath.length > 0) {
      const installer = spawn(installerPath, ['/S', '--updated', '--force-run'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      installer.once('error', (error) => {
        console.error('[desktop] silent update installer failed to start', error);
      });
      installer.unref();
      stopRuntimeForUpdate();
      app.exit(0);
      return;
    }
    console.error('[desktop] downloaded Windows installer path is unavailable; falling back to electron-updater');
  }

  autoUpdater.quitAndInstall(true, true);
}

app.whenReady().then(async () => {
  try {
    updateStateFile = updateStatePath(app.getPath('userData'));
    updateSettingsFile = updateSettingsPath(app.getPath('userData'));
    updateSettings = loadUpdateSettings(updateSettingsFile);
    updateState = loadUpdateState(updateStateFile, app.getVersion());
    updateState.channel = updateSettings.channel;
    saveUpdateState(updateStateFile, updateState);
    startBrowserBridge();
    await createWindow();
    configureUpdater();
  } catch (error) {
    console.error('[desktop] startup failed', error);
    app.quit();
  }
});


app.on('window-all-closed', () => {
  stopChild(nextProcess);
  stopChild(brokerProcess);
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (updateTimer) clearTimeout(updateTimer);
  if (updateInterval) clearInterval(updateInterval);
  browserBridge?.close();
  stopChild(nextProcess);
  stopChild(brokerProcess);
});
