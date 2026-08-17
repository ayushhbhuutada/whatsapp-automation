import { contextBridge, ipcRenderer } from 'electron';

const desktopAPI = {
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  getLicenseStatus: () => ipcRenderer.invoke('get-license-status'),
  activateLicense: (key) => ipcRenderer.invoke('activate-license', key),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getAppPaths: () => ipcRenderer.invoke('get-app-paths'),
  showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),
  getVersion: () => ipcRenderer.invoke('get-version')
};

contextBridge.exposeInMainWorld('desktopAPI', desktopAPI);
contextBridge.exposeInMainWorld('electronAPI', desktopAPI);

export default desktopAPI;
