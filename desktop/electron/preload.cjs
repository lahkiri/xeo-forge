'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xeoDesktop', {
  isDesktop: true,
  getProject: () => ipcRenderer.invoke('project:get'),
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  setProject: (projectPath) => ipcRenderer.invoke('project:set', projectPath),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getBrowserState: () => ipcRenderer.invoke('browser:state'),
  openBrowserExtension: () => ipcRenderer.invoke('browser:open-extension'),
});

contextBridge.exposeInMainWorld('xeoDesktopEvents', {
  onProjectChanged: (callback) => {
    const listener = (_event, project) => callback(project);
    ipcRenderer.on('project:changed', listener);
    return () => ipcRenderer.removeListener('project:changed', listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
});
