const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const APP_PORT = Number(process.env.XEO_APP_PORT || 3100);
const BROKER_PORT = Number(process.env.XEO_RUNTIME_PORT || 4317);
const projectRoot = path.resolve(__dirname, '..', '..');
let nextProcess;
let brokerProcess;

function projectConfigPath() {
  return path.join(app.getPath('userData'), 'project.json');
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

  const window = new BrowserWindow({
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
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://')) shell.openExternal(target);
    return { action: 'deny' };
  });
  await window.loadURL(url);
}

function stopChild(child) {
  if (!child || child.killed) return;
  child.kill();
}

app.whenReady().then(() => createWindow().catch((error) => {
  console.error('[desktop] startup failed', error);
  app.quit();
}));

app.on('window-all-closed', () => {
  stopChild(nextProcess);
  stopChild(brokerProcess);
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopChild(nextProcess);
  stopChild(brokerProcess);
});
