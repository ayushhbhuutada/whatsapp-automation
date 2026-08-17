const { contextBridge, ipcRenderer } = require('electron');

const desktopAPI = {
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  getLicenseStatus: () => ipcRenderer.invoke('get-license-status'),
  activateLicense: (key) => ipcRenderer.invoke('activate-license', key),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getAppPaths: () => ipcRenderer.invoke('get-app-paths'),
  showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),
  getVersion: () => ipcRenderer.invoke('get-version')
};

// Expose secure API to renderer process
contextBridge.exposeInMainWorld('desktopAPI', desktopAPI);
contextBridge.exposeInMainWorld('electronAPI', desktopAPI);

module.exports = desktopAPI;
