const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const { spawn, fork } = require('child_process');
const crypto = require('crypto');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let selectedPort = 5000;

/**
 * Resolves local AppData directories for packaged desktop data persistence
 */
function getAppDataPaths() {
  const baseDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'WhatsAppAutomation')
    : path.join(os.homedir(), '.whatsappautomation');

  const paths = {
    appData: baseDir,
    dbPath: path.join(baseDir, 'db.sqlite'),
    sessionPath: path.join(baseDir, 'sessions'),
    uploadsPath: path.join(baseDir, 'uploads'),
    attachmentsPath: path.join(baseDir, 'attachments')
  };

  try {
    if (!fs.existsSync(paths.appData)) fs.mkdirSync(paths.appData, { recursive: true });
    if (!fs.existsSync(paths.sessionPath)) fs.mkdirSync(paths.sessionPath, { recursive: true });
    if (!fs.existsSync(paths.uploadsPath)) fs.mkdirSync(paths.uploadsPath, { recursive: true });
    if (!fs.existsSync(paths.attachmentsPath)) fs.mkdirSync(paths.attachmentsPath, { recursive: true });
  } catch (e) {
    console.error('[Electron Main] Error initializing AppData subdirectories:', e);
  }

  return paths;
}

/**
 * Searches for an available port in the specified range (default: 5000 - 5010)
 */
function findAvailablePort(startPort = 5000, endPort = 5010) {
  return new Promise((resolve, reject) => {
    const testPort = (port) => {
      if (port > endPort) {
        return reject(new Error(`No open ports available in range ${startPort}-${endPort}`));
      }
      const tester = net.createServer();
      tester.unref();
      tester.on('error', () => {
        testPort(port + 1);
      });
      tester.listen(port, '0.0.0.0', () => {
        tester.close(() => {
          resolve(port);
        });
      });
    };
    testPort(startPort);
  });
}

/**
 * Polls backend HTTP server until ready or max attempts reached
 */
function checkServerReady(url, maxAttempts = 40) {
  return new Promise((resolve) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      http.get(url, (res) => {
        if (res.statusCode < 500) {
          clearInterval(interval);
          resolve(true);
        }
      }).on('error', () => {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          resolve(false);
        }
      });
    }, 400);
  });
}

/**
 * Spawns embedded Express backend server child process
 */
function startBackendServer(port) {
  const appPaths = getAppDataPaths();
  const serverPath = path.resolve(__dirname, '../backend/server.js');

  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'production',
    IS_ELECTRON: 'true',
    APPDATA_DIR: appPaths.appData,
    DB_PATH: appPaths.dbPath,
    SESSIONS_DIR: appPaths.sessionPath,
    UPLOADS_DIR: appPaths.uploadsPath,
    ATTACHMENTS_DIR: appPaths.attachmentsPath,
    ELECTRON_RUN_AS_NODE: '1'
  };

  // Launch server using Electron as Node runner or node binary
  const nodeExecutable = process.execPath;
  serverProcess = spawn(nodeExecutable, [serverPath], {
    env,
    stdio: 'inherit',
    windowsHide: true
  });

  serverProcess.on('error', (err) => {
    console.error('[Electron Main] Backend server spawn error:', err);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`[Electron Main] Backend server exited with code: ${code}, signal: ${signal}`);
  });
}

/**
 * Registers secure IPC handlers for desktop context bridge
 */
function registerIpcHandlers() {
  // 1. Get Hardware Machine ID
  ipcMain.handle('get-machine-id', async () => {
    try {
      const { getMachineId } = await import('../backend/services/hardwareIdService.js');
      return getMachineId();
    } catch (e) {
      // Fallback machine ID derivation
      const mac = os.hostname() + ':::' + os.arch() + ':::' + os.platform();
      const hash = crypto.createHash('sha256').update(mac).digest('hex').toUpperCase();
      return `WA-WIN-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}`;
    }
  });

  // 2. Get License Status
  ipcMain.handle('get-license-status', async () => {
    try {
      const { getLicenseStatus } = await import('../backend/services/licenseService.js');
      return await getLicenseStatus();
    } catch (e) {
      return { activated: false, error: e.message };
    }
  });

  // 3. Activate License
  ipcMain.handle('activate-license', async (event, licenseKey) => {
    try {
      const { activateLicense } = await import('../backend/services/licenseService.js');
      return await activateLicense(licenseKey);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 4. Open External URL
  ipcMain.handle('open-external', async (event, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:'))) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });

  // 5. Get Desktop App Paths
  ipcMain.handle('get-app-paths', () => {
    return getAppDataPaths();
  });

  // 6. Show Item In Folder
  ipcMain.handle('show-item-in-folder', (event, fullPath) => {
    if (fullPath && fs.existsSync(fullPath)) {
      shell.showItemInFolder(fullPath);
      return true;
    }
    return false;
  });

  // 7. Get Application Version
  ipcMain.handle('get-version', () => {
    return app ? app.getVersion() : '1.0.0';
  });
}

/**
 * Creates primary application browser window
 */
function createWindow(port) {
  const preloadPath = fs.existsSync(path.join(__dirname, 'preload.cjs'))
    ? path.join(__dirname, 'preload.cjs')
    : path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'WhatsApp Automation Pro',
    backgroundColor: '#020617',
    icon: fs.existsSync(path.join(__dirname, 'icon.png')) ? path.join(__dirname, 'icon.png') : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: preloadPath
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on('close', (event) => {
    if (app && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

/**
 * Initializes system tray
 */
function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  if (fs.existsSync(iconPath)) {
    try {
      tray = new Tray(iconPath);
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Open WhatsApp Automation Pro', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
        { type: 'separator' },
        { label: 'Quit Application', click: () => { if (app) { app.isQuitting = true; app.quit(); } } }
      ]);
      tray.setToolTip('WhatsApp Automation Pro');
      tray.setContextMenu(contextMenu);
      tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
    } catch (e) {
      console.log('[Electron Tray] Tray initialization skipped:', e.message);
    }
  }
}

// Lifecycle Events
if (app) {
  app.whenReady().then(async () => {
    registerIpcHandlers();

    try {
      selectedPort = await findAvailablePort(5000, 5010);
    } catch (err) {
      console.error('[Electron Main] Port hunting failed, falling back to 5000:', err.message);
      selectedPort = 5000;
    }

    startBackendServer(selectedPort);
    await checkServerReady(`http://localhost:${selectedPort}/api/anti-ban/health`, 50);

    createWindow(selectedPort);
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(selectedPort);
      } else if (mainWindow) {
        mainWindow.show();
      }
    });
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    if (serverProcess) {
      try {
        serverProcess.kill('SIGTERM');
      } catch (e) {}
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      if (app) app.quit();
    }
  });
}

module.exports = {
  findAvailablePort,
  getAppDataPaths,
  checkServerReady,
  startBackendServer,
  registerIpcHandlers,
  createWindow,
  createTray
};
