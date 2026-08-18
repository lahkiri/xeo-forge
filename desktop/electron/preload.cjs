'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xeoDesktop', {
  isDesktop: true,
  getProject: () => ipcRenderer.invoke('project:get'),
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  setProject: (projectPath) => ipcRenderer.invoke('project:set', projectPath),
});

contextBridge.exposeInMainWorld('xeoDesktopEvents', {
  onProjectChanged: (callback) => {
    const listener = (_event, project) => callback(project);
    ipcRenderer.on('project:changed', listener);
    return () => ipcRenderer.removeListener('project:changed', listener);
  },
});
