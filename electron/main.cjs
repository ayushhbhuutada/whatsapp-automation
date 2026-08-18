const { app, BrowserWindow, Tray, Menu, ipcMain, shell, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const { spawn, fork } = require('child_process');
const crypto = require('crypto');

let mainWindow = null;
let splashWindow = null;
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
    attachmentsPath: path.join(baseDir, 'attachments'),
    logsPath: path.join(baseDir, 'logs')
  };

  try {
    if (!fs.existsSync(paths.appData)) fs.mkdirSync(paths.appData, { recursive: true });
    if (!fs.existsSync(paths.sessionPath)) fs.mkdirSync(paths.sessionPath, { recursive: true });
    if (!fs.existsSync(paths.uploadsPath)) fs.mkdirSync(paths.uploadsPath, { recursive: true });
    if (!fs.existsSync(paths.attachmentsPath)) fs.mkdirSync(paths.attachmentsPath, { recursive: true });
    if (!fs.existsSync(paths.logsPath)) fs.mkdirSync(paths.logsPath, { recursive: true });
  } catch (e) {
    console.error('[Electron Main] Error initializing AppData subdirectories:', e);
  }

  return paths;
}

/**
 * Creates lightweight splash / startup dialogue box
 */
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 440,
    height: 290,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#020617',
    center: true,
    show: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const splashPath = path.join(__dirname, 'splash.html');
  if (fs.existsSync(splashPath)) {
    splashWindow.loadFile(splashPath);
  }
}

/**
 * Updates status text in splash screen
 */
function updateSplashStatus(statusText) {
  if (splashWindow && !splashWindow.isDestroyed() && splashWindow.webContents) {
    splashWindow.webContents.executeJavaScript(
      `var el = document.getElementById('status'); if(el) el.textContent = ${JSON.stringify(statusText)};`
    ).catch(() => {});
  }
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
function checkServerReady(url, maxAttempts = 35) {
  return new Promise((resolve) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const req = http.get(url, (res) => {
        if (res.statusCode < 500) {
          clearInterval(interval);
          resolve(true);
        }
      });
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          resolve(false);
        }
      });
      req.setTimeout(800, () => {
        req.destroy();
      });
    }, 400);
  });
}

/**
 * Resolves path to backend server.js in both dev and packaged production
 */
function getBackendServerPath() {
  const candidatePaths = [
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'backend', 'server.js') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'server.js') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'backend', 'server.js') : null,
    path.resolve(__dirname, '../backend/server.js'),
    path.resolve(process.cwd(), 'backend/server.js'),
    path.resolve(__dirname, '../../backend/server.js')
  ].filter(Boolean);

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return path.resolve(__dirname, '../backend/server.js');
}

/**
 * Initializes embedded Express backend server directly inside Electron Node runtime
 */
async function startBackendServer(port) {
  const appPaths = getAppDataPaths();
  const serverPath = getBackendServerPath();

  process.env.PORT = String(port);
  process.env.NODE_ENV = 'production';
  process.env.IS_ELECTRON = 'true';
  process.env.APPDATA_DIR = appPaths.appData;
  process.env.DB_PATH = appPaths.dbPath;
  process.env.SESSIONS_DIR = appPaths.sessionPath;
  process.env.UPLOADS_DIR = appPaths.uploadsPath;
  process.env.ATTACHMENTS_DIR = appPaths.attachmentsPath;

  const logFile = path.join(appPaths.logsPath, 'backend_startup.log');
  try {
    fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] Initializing embedded backend from: ${serverPath}\n`);
    const { pathToFileURL } = require('url');
    await import(pathToFileURL(serverPath).href);
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] Embedded backend initialized successfully on port ${port}.\n`);
  } catch (err) {
    console.error('[Electron Main] Embedded backend initialization error:', err);
    try {
      fs.appendFileSync(logFile, `[Backend Init Error] ${err.message}\n${err.stack}\n`);
    } catch (e) {}
  }
}

function getServiceUrl(relPath) {
  const { pathToFileURL } = require('url');
  const possiblePaths = [
    path.join(__dirname, relPath),
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'backend', relPath.replace('../backend/', '')) : null,
    path.resolve(process.cwd(), 'backend', relPath.replace('../backend/', ''))
  ].filter(Boolean);
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return pathToFileURL(p).href;
  }
  return pathToFileURL(path.join(__dirname, relPath)).href;
}

/**
 * Registers secure IPC handlers for desktop context bridge
 */
function registerIpcHandlers() {
  // 1. Get Hardware Machine ID
  ipcMain.handle('get-machine-id', async () => {
    try {
      const url = getServiceUrl('../backend/services/hardwareIdService.js');
      const { getMachineId } = await import(url);
      return getMachineId();
    } catch (e) {
      const mac = os.hostname() + ':::' + os.arch() + ':::' + os.platform();
      const hash = crypto.createHash('sha256').update(mac).digest('hex').toUpperCase();
      return `WA-WIN-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}`;
    }
  });

  // 2. Get License Status
  ipcMain.handle('get-license-status', async () => {
    try {
      const url = getServiceUrl('../backend/services/licenseService.js');
      const { getLicenseStatus } = await import(url);
      return await getLicenseStatus();
    } catch (e) {
      return { activated: false, error: e.message };
    }
  });

  // 3. Activate License
  ipcMain.handle('activate-license', async (event, licenseKey) => {
    try {
      const url = getServiceUrl('../backend/services/licenseService.js');
      const { activateLicense } = await import(url);
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

function getFrontendIndexPath() {
  const possiblePaths = [
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'frontend', 'dist', 'index.html') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'frontend', 'dist', 'index.html') : null,
    path.resolve(__dirname, '../frontend/dist/index.html'),
    path.resolve(__dirname, '../../frontend/dist/index.html'),
    path.resolve(process.cwd(), 'frontend/dist/index.html'),
    path.resolve(process.cwd(), 'resources/app/frontend/dist/index.html')
  ].filter(Boolean);

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
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
    show: false, // Keep hidden until fully loaded & painted
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      preload: preloadPath
    }
  });

  mainWindow.setMenuBarVisibility(false);
  
  const indexPath = getFrontendIndexPath();
  if (indexPath) {
    mainWindow.loadFile(indexPath);
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${port}`);
  }

  // Smooth transition: Reveal Main Window only when ready to paint, then dismiss Splash
  let hasShown = false;
  const revealMainWindow = () => {
    if (hasShown || !mainWindow || mainWindow.isDestroyed()) return;
    hasShown = true;
    mainWindow.show();
    mainWindow.focus();
    if (splashWindow && !splashWindow.isDestroyed()) {
      try { splashWindow.close(); } catch (e) {}
    }
  };

  mainWindow.once('ready-to-show', revealMainWindow);
  // Fallback reveal in case ready-to-show is delayed by system compositor
  setTimeout(revealMainWindow, 1800);

  // Guard against multiple close events firing (prevents double-quit bug)
  let isClosing = false;
  mainWindow.on('close', () => {
    if (isClosing) return;
    isClosing = true;
    if (app) {
      app.isQuitting = true;
      if (serverProcess) {
        try { serverProcess.kill('SIGTERM'); } catch (e) {}
      }
      app.exit(0);
    }
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

// Standard stability defaults
if (app) {
  try {
    app.commandLine.appendSwitch('no-sandbox');
  } catch (e) {}

  app.whenReady().then(async () => {
    // 1. Immediately display instant startup splash dialog (0.1s response)
    createSplashWindow();
    updateSplashStatus('Initializing local environment...');

    registerIpcHandlers();

    // 2. Find open local port
    updateSplashStatus('Locating available network port...');
    try {
      selectedPort = await findAvailablePort(5000, 5010);
    } catch (err) {
      selectedPort = 5000;
    }

    // 3. Start local automation backend server IN BACKGROUND (non-blocking)
    // Window opens immediately; frontend retries API calls until backend is ready.
    updateSplashStatus('Starting automation engine in background...');
    startBackendServer(selectedPort).catch((err) => {
      console.error('[Electron Main] Backend startup error:', err);
    });

    // 4. Open workspace window immediately (no need to wait for backend)
    updateSplashStatus('Opening workspace interface...');
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
  createSplashWindow,
  createTray
};
