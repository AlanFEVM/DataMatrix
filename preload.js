const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('matrixAPI', {
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  saveWorkspace: (data) => ipcRenderer.invoke('workspace:save', data),
  pickFiles: () => ipcRenderer.invoke('file:pick'),
  getFilePath: (file) => webUtils.getPathForFile(file),
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  getThumbnail: (filePath) => ipcRenderer.invoke('file:thumbnail', filePath),
  getFileIcon: (filePath) => ipcRenderer.invoke('file:icon', filePath),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  fetchTitle: (url) => ipcRenderer.invoke('link:title', url),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  getDesktopMode: () => ipcRenderer.invoke('window:desktop-mode-status'),
  setDesktopMode: (enabled) => ipcRenderer.invoke('window:desktop-mode', enabled),
  onMaximized: (callback) => ipcRenderer.on('window:maximized', (_event, value) => callback(value)),
  onDesktopModeChanged: (callback) => ipcRenderer.on('window:desktop-mode-changed', (_event, value) => callback(value))
});
