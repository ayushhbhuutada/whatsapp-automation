import { app, BrowserWindow, Tray, Menu, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let tray = null;
let serverProcess = null;
const BACKEND_PORT = 5000;

function checkServerReady(url, maxAttempts = 30) {
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
    }, 500);
  });
}

function startBackendServer() {
  const serverPath = path.join(__dirname, '../backend/server.js');
  serverProcess = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: BACKEND_PORT, NODE_ENV: 'production' },
    stdio: 'inherit'
  });

  serverProcess.on('error', (err) => {
    console.error('[Electron Main] Backend spawn error:', err);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'WhatsApp Automation & Anti-Ban Suite',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL(`http://localhost:${BACKEND_PORT}`);

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  // Open external links in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open WhatsApp Automation Suite', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Quit Application', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('WhatsApp Automation Suite');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow?.show());
  } catch (e) {
    console.log('[Electron Tray] Tray icon omitted or unavailable.');
  }
}

app.whenReady().then(async () => {
  startBackendServer();
  const ready = await checkServerReady(`http://localhost:${BACKEND_PORT}/api/anti-ban/health`);
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
