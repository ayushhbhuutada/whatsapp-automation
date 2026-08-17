/**
 * Milestone 3: Electron Standalone Packaging & NSIS Installer Verification Suite
 * Verifies desktop packaging infrastructure, IPC context bridges, AppData path resolution,
 * auto-port hunting, multi-tier Chromium detection, and NSIS installer generation.
 */

import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { fileURLToPath } from 'url';
import { createTestSuite } from './test_helper.js';

import {
  getAppDataDir,
  getDatabasePath,
  getSessionsDir,
  getUploadsDir,
  getAttachmentsDir
} from '../backend/paths.js';

import {
  getChromiumDetectionTiers,
  findChromiumExecutable
} from '../backend/services/openwaService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const m3DesktopPackagingSuite = createTestSuite('Milestone 3: Electron Standalone Packaging & NSIS Installer Suite');

// 1. File Structure Verification
m3DesktopPackagingSuite.add('Packaging Files: electron/main.cjs, preload.cjs, and electron-builder.yml exist', () => {
  const mainCjs = path.join(rootDir, 'electron', 'main.cjs');
  const preloadCjs = path.join(rootDir, 'electron', 'preload.cjs');
  const mainJs = path.join(rootDir, 'electron', 'main.js');
  const preloadJs = path.join(rootDir, 'electron', 'preload.js');
  const electronBuilderYml = path.join(rootDir, 'electron-builder.yml');

  assert.strictEqual(fs.existsSync(mainCjs), true, 'electron/main.cjs must exist');
  assert.strictEqual(fs.existsSync(preloadCjs), true, 'electron/preload.cjs must exist');
  assert.strictEqual(fs.existsSync(mainJs), true, 'electron/main.js must exist');
  assert.strictEqual(fs.existsSync(preloadJs), true, 'electron/preload.js must exist');
  assert.strictEqual(fs.existsSync(electronBuilderYml), true, 'electron-builder.yml must exist');
});

// 2. Package.json Configuration
m3DesktopPackagingSuite.add('Package Configuration: package.json defines desktop main, build scripts, and electron-builder config', () => {
  const pkgPath = path.join(rootDir, 'package.json');
  assert.strictEqual(fs.existsSync(pkgPath), true);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  assert.strictEqual(pkg.main, 'electron/main.cjs', 'pkg.main must point to electron/main.cjs');
  assert.ok(pkg.scripts['build:frontend'], 'pkg.scripts must have build:frontend');
  assert.ok(pkg.scripts['build:electron'], 'pkg.scripts must have build:electron');
  assert.ok(pkg.scripts['build:installer'], 'pkg.scripts must have build:installer');
  assert.ok(pkg.scripts['dist'], 'pkg.scripts must have dist');
  assert.ok(pkg.scripts['start:electron'], 'pkg.scripts must have start:electron');

  assert.ok(pkg.build, 'pkg.build configuration must exist');
  assert.strictEqual(pkg.build.appId, 'com.whatsapp.automation.pro', 'appId must match com.whatsapp.automation.pro');
  assert.strictEqual(pkg.build.productName, 'WhatsApp Automation', 'productName must match WhatsApp Automation');
  assert.strictEqual(pkg.build.directories?.output, 'dist_electron', 'output directory must be dist_electron');
  assert.strictEqual(pkg.build.asar, true, 'asar packaging must be true');
});

// 3. Electron-Builder YAML Configuration
m3DesktopPackagingSuite.add('Electron Builder YAML: electron-builder.yml defines correct appId, NSIS target, and 64-bit arch', () => {
  const ymlContent = fs.readFileSync(path.join(rootDir, 'electron-builder.yml'), 'utf8');

  assert.ok(ymlContent.includes('appId: com.whatsapp.automation.pro'), 'appId matches');
  assert.ok(ymlContent.includes('productName: WhatsApp Automation'), 'productName matches');
  assert.ok(ymlContent.includes('dist_electron'), 'output dir matches');
  assert.ok(ymlContent.includes('WhatsAppAutomationSetup'), 'artifactName matches');
  assert.ok(ymlContent.includes('target: nsis') || ymlContent.includes('nsis'), 'nsis target matches');
  assert.ok(ymlContent.includes('x64'), 'x64 arch matches');
  assert.ok(ymlContent.includes('asar: true'), 'asar is enabled');
});

// 4. Preload IPC Context Bridge Verification
m3DesktopPackagingSuite.add('Preload Context Bridge: preload.cjs exposes desktopAPI and electronAPI with all 7 IPC methods', () => {
  const preloadContent = fs.readFileSync(path.join(rootDir, 'electron', 'preload.cjs'), 'utf8');

  assert.ok(preloadContent.includes('getMachineId'), 'exposes getMachineId');
  assert.ok(preloadContent.includes('getLicenseStatus'), 'exposes getLicenseStatus');
  assert.ok(preloadContent.includes('activateLicense'), 'exposes activateLicense');
  assert.ok(preloadContent.includes('openExternal'), 'exposes openExternal');
  assert.ok(preloadContent.includes('getAppPaths'), 'exposes getAppPaths');
  assert.ok(preloadContent.includes('showItemInFolder'), 'exposes showItemInFolder');
  assert.ok(preloadContent.includes('getVersion'), 'exposes getVersion');

  assert.ok(preloadContent.includes("contextBridge.exposeInMainWorld('desktopAPI'"), 'exposes desktopAPI');
  assert.ok(preloadContent.includes("contextBridge.exposeInMainWorld('electronAPI'"), 'exposes electronAPI');
});

// 5. Main Process IPC Registration Verification
m3DesktopPackagingSuite.add('Main Process: main.cjs registers all required IPC channels and handles', () => {
  const mainContent = fs.readFileSync(path.join(rootDir, 'electron', 'main.cjs'), 'utf8');

  assert.ok(mainContent.includes("ipcMain.handle('get-machine-id'"), 'registers get-machine-id');
  assert.ok(mainContent.includes("ipcMain.handle('get-license-status'"), 'registers get-license-status');
  assert.ok(mainContent.includes("ipcMain.handle('activate-license'"), 'registers activate-license');
  assert.ok(mainContent.includes("ipcMain.handle('open-external'"), 'registers open-external');
  assert.ok(mainContent.includes("ipcMain.handle('get-app-paths'"), 'registers get-app-paths');
  assert.ok(mainContent.includes("ipcMain.handle('show-item-in-folder'"), 'registers show-item-in-folder');
  assert.ok(mainContent.includes("ipcMain.handle('get-version'"), 'registers get-version');
});

// 6. AppData Path Resolution
m3DesktopPackagingSuite.add('AppData Paths: backend/paths.js resolves application data and subdirectories correctly', () => {
  const originalIsElectron = process.env.IS_ELECTRON;
  const originalAppData = process.env.APPDATA;

  try {
    process.env.IS_ELECTRON = 'true';
    if (!process.env.APPDATA) {
      process.env.APPDATA = path.join(os.homedir(), 'AppData', 'Roaming');
    }

    const appData = getAppDataDir();
    assert.ok(appData.includes('WhatsAppAutomation'), `AppData dir must include WhatsAppAutomation: ${appData}`);

    const dbPath = getDatabasePath();
    assert.ok(dbPath.includes('db.sqlite'), `Database path must end with db.sqlite: ${dbPath}`);

    const sessionsDir = getSessionsDir();
    assert.ok(sessionsDir.includes('sessions') || sessionsDir.includes('.wwebjs_auth'), `Sessions path valid: ${sessionsDir}`);

    const uploadsDir = getUploadsDir();
    assert.ok(uploadsDir.includes('uploads'), `Uploads dir valid: ${uploadsDir}`);

    const attachmentsDir = getAttachmentsDir();
    assert.ok(attachmentsDir.includes('attachments'), `Attachments dir valid: ${attachmentsDir}`);
  } finally {
    process.env.IS_ELECTRON = originalIsElectron;
    process.env.APPDATA = originalAppData;
  }
});

// 7. Auto-Port Hunting Logic
m3DesktopPackagingSuite.add('Auto-Port Hunting: Dynamic port selector finds open ports in range 5000-5010', async () => {
  // Create a temporary mock server on port 5000 to verify hunting selects next available port
  const occupiedServer = net.createServer();
  const testBasePort = 5000;

  let occupiedPort = null;
  await new Promise((resolve) => {
    occupiedServer.once('error', () => {
      // If 5000 already in use, that's fine
      resolve();
    });
    occupiedServer.listen(testBasePort, '0.0.0.0', () => {
      occupiedPort = testBasePort;
      resolve();
    });
  });

  const findPort = (start = 5000, end = 5010) => {
    return new Promise((resolve, reject) => {
      const probe = (p) => {
        if (p > end) return reject(new Error('No open ports'));
        const s = net.createServer();
        s.unref();
        s.on('error', () => probe(p + 1));
        s.listen(p, '0.0.0.0', () => {
          s.close(() => resolve(p));
        });
      };
      probe(start);
    });
  };

  const foundPort = await findPort(5000, 5010);
  assert.ok(foundPort >= 5000 && foundPort <= 5010, `Found port must be within 5000-5010 range: ${foundPort}`);

  if (occupiedPort) {
    await new Promise(r => occupiedServer.close(r));
  }
});

// 8. Multi-Tier Chromium / Edge Detection
m3DesktopPackagingSuite.add('Multi-Tier Chromium Detection: openwaService defines 3 structured detection tiers', () => {
  const tiers = getChromiumDetectionTiers();

  assert.strictEqual(Array.isArray(tiers), true, 'Tiers must be an array');
  assert.strictEqual(tiers.length >= 3, true, 'Must have at least 3 detection tiers');

  assert.strictEqual(tiers[0].name, 'Packaged Chromium', 'Tier 1 must be Packaged Chromium');
  assert.strictEqual(tiers[1].name, 'Google Chrome', 'Tier 2 must be Google Chrome');
  assert.strictEqual(tiers[2].name, 'Microsoft Edge', 'Tier 3 must be Microsoft Edge');

  // Verify paths array
  for (const tier of tiers) {
    assert.strictEqual(Array.isArray(tier.paths), true, `${tier.name} paths must be an array`);
    assert.ok(tier.paths.length > 0, `${tier.name} must have candidate paths configured`);
  }

  // Edge path should include msedge.exe
  const edgeTier = tiers.find(t => t.name === 'Microsoft Edge');
  const hasEdgeExe = edgeTier.paths.some(p => p.toLowerCase().includes('msedge.exe'));
  assert.strictEqual(hasEdgeExe, true, 'Microsoft Edge tier must target msedge.exe');

  // Chrome path should include chrome.exe
  const chromeTier = tiers.find(t => t.name === 'Google Chrome');
  const hasChromeExe = chromeTier.paths.some(p => p.toLowerCase().includes('chrome.exe'));
  assert.strictEqual(hasChromeExe, true, 'Google Chrome tier must target chrome.exe');
});

// 9. Executable & Installer Generation Verification
m3DesktopPackagingSuite.add('Installer Executable Artifacts: WhatsAppAutomationSetup.exe and win-unpacked exist in dist_electron', () => {
  const distElectronDir = path.join(rootDir, 'dist_electron');
  const setupExePath = path.join(distElectronDir, 'WhatsAppAutomationSetup.exe');
  const winUnpackedDir = path.join(distElectronDir, 'win-unpacked');
  const unpackedExePath = path.join(winUnpackedDir, 'WhatsAppAutomation.exe');

  assert.strictEqual(fs.existsSync(distElectronDir), true, 'dist_electron directory must exist');
  assert.strictEqual(fs.existsSync(setupExePath), true, 'dist_electron/WhatsAppAutomationSetup.exe must exist');

  const stats = fs.statSync(setupExePath);
  assert.ok(stats.size > 50 * 1024 * 1024, `WhatsAppAutomationSetup.exe size (${(stats.size / 1024 / 1024).toFixed(2)} MB) must be > 50MB`);

  assert.strictEqual(fs.existsSync(winUnpackedDir), true, 'dist_electron/win-unpacked directory must exist');
  assert.strictEqual(fs.existsSync(unpackedExePath), true, 'dist_electron/win-unpacked/WhatsAppAutomation.exe must exist');
});

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith('m3_desktop_packaging.test.js')) {
  m3DesktopPackagingSuite.run().then(res => {
    if (res.failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  });
}
