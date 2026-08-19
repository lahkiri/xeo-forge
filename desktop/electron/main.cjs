const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { autoUpdater } = require('electron-updater');
const { startBrowserBridge: createBrowserBridge } = require('./browser-bridge.cjs');
const { loadUpdateState, saveUpdateState, updateStatePath } = require('./update-state.cjs');

const APP_PORT = Number(process.env.XEO_APP_PORT || 3100);
const BROKER_PORT = Number(process.env.XEO_RUNTIME_PORT || 4317);
const BROWSER_PORT = Number(process.env.XEO_BROWSER_PORT || 4321);
const projectRoot = path.resolve(__dirname, '..', '..');
let nextProcess;
let brokerProcess;
let mainWindow;
let updateTimer;
let browserBridge;
let updateStateFile;
let updateState = { status: 'idle', currentVersion: app.getVersion(), version: null, percent: 0, message: '' };

function projectConfigPath() {
  return path.join(app.getPath('userData'), 'project.json');
}

function browserTokenPath() {
  return path.join(app.getPath('userData'), 'browser-token');
}

function browserPreferencePath() {
  return path.join(app.getPath('userData'), 'browser-profile.json');
}

function getBrowserToken() {
  try {
    const token = readFileSync(browserTokenPath(), 'utf8').trim();
    if (token.length >= 32) return token;
  } catch {}
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
  const channel = process.env.XEO_UPDATE_CHANNEL === 'beta' ? 'beta' : 'latest';
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = channel === 'beta';
  autoUpdater.channel = channel;
  autoUpdater.on('checking-for-update', () => publishUpdate('checking', { message: 'Checking for updates…' }));
  autoUpdater.on('update-available', (info) => publishUpdate('available', { version: info.version, releaseDate: info.releaseDate, size: info.files?.[0]?.size || null, message: `Xeo Forge ${info.version} is available.` }));
  autoUpdater.on('update-not-available', () => publishUpdate('not-available', { version: null, message: 'Xeo Forge is up to date.' }));
  autoUpdater.on('download-progress', (progress) => publishUpdate('downloading', { version: updateState.version, percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total, message: 'Downloading update in the background…' }));
  autoUpdater.on('update-downloaded', (info) => publishUpdate('downloaded', { version: info.version, percent: 100, message: 'Update ready. Restart Xeo Forge to install it.' }));
  autoUpdater.on('error', (error) => publishUpdate('error', { message: error instanceof Error ? error.message : String(error) }));

  const check = () => autoUpdater.checkForUpdates().catch((error) => publishUpdate('error', { message: error instanceof Error ? error.message : String(error) }));
  updateTimer = setTimeout(check, 5000);
  updateTimer.unref?.();
  setInterval(check, 6 * 60 * 60 * 1000).unref?.();
}

ipcMain.handle('update:state', () => updateState);
ipcMain.handle('update:check', async () => {
  if (!updaterSupported()) return updateState;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publishUpdate('error', { message: error instanceof Error ? error.message : String(error) });
  }
  return updateState;
});
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
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return updateState;
});
ipcMain.handle('browser:state', () => browserState());
ipcMain.handle('browser:select', (_event, browserId) => {
  if (!browserBridge) throw new Error('Browser bridge is disabled.');
  return browserBridge.selectBrowser(browserId);
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
  brokerProcess = spawn(brokerPath, [], {
    env: { ...process.env, XEO_RUNTIME_ADDR: `127.0.0.1:${BROKER_PORT}` },
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
      PORT: String(APP_PORT),
      HOSTNAME: '127.0.0.1',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  nextProcess.on('error', (error) => console.error('[desktop] Next server error', error));
}

async function waitForApp(url, attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Xeo Forge did not become ready at ${url}`);
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

app.whenReady().then(async () => {
  try {
    updateStateFile = updateStatePath(app.getPath('userData'));
    updateState = loadUpdateState(updateStateFile, app.getVersion());
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
  browserBridge?.close();
  stopChild(nextProcess);
  stopChild(brokerProcess);
});
