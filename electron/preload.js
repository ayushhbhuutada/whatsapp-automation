import { contextBridge, ipcRenderer } from 'electron';

const desktopAPI = {
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  getLicenseStatus: () => ipcRenderer.invoke('get-license-status'),
  activateLicense: (key) => ipcRenderer.invoke('activate-license', key),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getAppPaths: () => ipcRenderer.invoke('get-app-paths'),
  showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkForUpdates: (options) => ipcRenderer.invoke('check-for-updates', options),
  downloadUpdate: (payload) => ipcRenderer.invoke('download-update', payload),
  installUpdate: (payload) => ipcRenderer.invoke('install-update', payload),
  getUpdateProgress: () => ipcRenderer.invoke('get-update-progress'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, data) => callback(data));
  }
};

contextBridge.exposeInMainWorld('desktopAPI', desktopAPI);
contextBridge.exposeInMainWorld('electronAPI', desktopAPI);

export default desktopAPI;
