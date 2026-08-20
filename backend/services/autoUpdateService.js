import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read current local version from package.json
let currentAppVersion = '1.0.0';
try {
  const pkgPath = path.resolve(__dirname, '../../package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version) currentAppVersion = pkg.version;
  }
} catch (_e) {}

// Global progress state
let activeDownloadState = {
  isDownloading: false,
  percent: 0,
  transferredBytes: 0,
  totalBytes: 0,
  speed: '0 KB/s',
  status: 'idle', // 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  error: null,
  installerPath: null,
  targetVersion: null
};

/**
 * Resolves directory for temporary update installer downloads
 */
export function getUpdatesDirectory() {
  const baseDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Programs', 'WhatsAppAutomation', 'updates')
    : process.env.APPDATA
    ? path.join(process.env.APPDATA, 'WhatsAppAutomation', 'updates')
    : path.join(os.homedir(), '.whatsappautomation', 'updates');

  try {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  } catch (_e) {}

  return baseDir;
}

/**
 * Normalizes version strings and compares them (SemVer)
 * Returns true if remoteVersion > localVersion
 */
export function isNewerVersion(remoteVersion, localVersion = currentAppVersion) {
  if (!remoteVersion) return false;

  const clean = (v) => {
    const match = String(v).replace(/^v/i, '').trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return [0, 0, 0];
    return [
      parseInt(match[1] || '0', 10),
      parseInt(match[2] || '0', 10),
      parseInt(match[3] || '0', 10)
    ];
  };

  const [rMajor, rMinor, rPatch] = clean(remoteVersion);
  const [lMajor, lMinor, lPatch] = clean(localVersion);

  if (rMajor > lMajor) return true;
  if (rMajor < lMajor) return false;
  if (rMinor > lMinor) return true;
  if (rMinor < lMinor) return false;
  return rPatch > lPatch;
}

/**
 * Performs HTTP/HTTPS GET request with redirect following
 */
function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const reqHeaders = {
      'User-Agent': 'WhatsAppAutomation-AutoUpdater/1.0.0',
      'Accept': 'application/json',
      ...headers
    };

    const req = client.get(url, { headers: reqHeaders, timeout: 10000 }, (res) => {
      // Follow HTTP redirects (301, 302, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location, headers).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`Server returned HTTP ${res.statusCode}: ${res.statusMessage}`));
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`Failed to parse JSON response: ${e.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Update check request timed out after 10 seconds'));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Checks for updates from GitHub Releases API
 */
async function checkGitHubUpdates(repo = 'ayushhbhuutada/whatsapp-automation') {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const release = await fetchJson(url);

  const tagName = release.tag_name || release.name || '';
  const latestVersion = tagName.replace(/^v/i, '').trim();
  const updateAvailable = isNewerVersion(latestVersion, currentAppVersion);

  // Find installer asset (.exe)
  let downloadUrl = '';
  let assetName = '';
  let assetSize = 0;

  if (Array.isArray(release.assets)) {
    // Prefer WhatsAppAutomationSetup.exe or any .exe
    const exeAsset = release.assets.find(a => a.name.toLowerCase().endsWith('.exe')) || release.assets[0];
    if (exeAsset) {
      downloadUrl = exeAsset.browser_download_url;
      assetName = exeAsset.name;
      assetSize = exeAsset.size;
    }
  }

  // Fallback to release zipball if no exe asset attached
  if (!downloadUrl && release.html_url) {
    downloadUrl = release.html_url;
  }

  return {
    source: 'github',
    updateAvailable,
    currentVersion: currentAppVersion,
    latestVersion,
    releaseName: release.name || `Release ${tagName}`,
    releaseNotes: release.body || 'No release notes provided.',
    publishedAt: release.published_at || new Date().toISOString(),
    downloadUrl,
    assetName,
    assetSize
  };
}

/**
 * Checks for updates from Vercel or Custom HTTP API
 * Expected API response structure:
 * {
 *   "version": "1.0.1",
 *   "downloadUrl": "https://...",
 *   "releaseName": "v1.0.1 Performance Update",
 *   "releaseNotes": "Bug fixes & new features",
 *   "publishedAt": "2026-08-20T12:00:00Z"
 * }
 */
async function checkVercelUpdates(endpointUrl) {
  if (!endpointUrl || !endpointUrl.startsWith('http')) {
    throw new Error('Invalid Vercel update URL configured');
  }

  const data = await fetchJson(endpointUrl);
  const latestVersion = (data.version || data.latestVersion || data.tag || '').replace(/^v/i, '').trim();
  const updateAvailable = isNewerVersion(latestVersion, currentAppVersion);

  return {
    source: 'vercel',
    updateAvailable,
    currentVersion: currentAppVersion,
    latestVersion,
    releaseName: data.releaseName || `Version ${latestVersion}`,
    releaseNotes: data.releaseNotes || data.notes || 'Bug fixes and performance improvements.',
    publishedAt: data.publishedAt || new Date().toISOString(),
    downloadUrl: data.downloadUrl || data.url || '',
    assetName: data.assetName || 'WhatsAppAutomationSetup.exe',
    assetSize: data.assetSize || 0
  };
}

/**
 * Main update checking function
 * Checks GitHub Raw repository metadata & GitHub Releases
 */
export async function checkForUpdates(options = {}) {
  const {
    sourceType = 'github',
    githubRepo = 'ayushhbhuutada/whatsapp-automation',
    vercelUrl = ''
  } = options;

  // 1. First priority: Check live raw version.json from GitHub main branch
  try {
    const rawUrl = `https://raw.githubusercontent.com/${githubRepo}/main/frontend/public/version.json`;
    const rawData = await fetchJson(rawUrl);
    const remoteVersion = (rawData.version || rawData.latestVersion || '').replace(/^v/i, '').trim();
    if (remoteVersion) {
      const updateAvailable = isNewerVersion(remoteVersion, currentAppVersion);
      return {
        source: 'github-live',
        updateAvailable,
        currentVersion: currentAppVersion,
        latestVersion: remoteVersion,
        releaseName: rawData.releaseName || `WhatsApp Automator Pro v${remoteVersion}`,
        releaseNotes: rawData.releaseNotes || 'Latest improvements and updates from cloud.',
        publishedAt: rawData.publishedAt || new Date().toISOString(),
        downloadUrl: rawData.downloadUrl || `https://github.com/${githubRepo}/releases/download/v${remoteVersion}/WhatsAppAutomationSetup.exe`,
        assetName: rawData.assetName || 'WhatsAppAutomationSetup.exe',
        assetSize: 0
      };
    }
  } catch (_rawErr) {
    // Fallback to GitHub Releases or Vercel
  }

  try {
    if (sourceType === 'vercel' && vercelUrl) {
      return await checkVercelUpdates(vercelUrl);
    }
    
    // Fallback: Check GitHub Releases API
    return await checkGitHubUpdates(githubRepo);
  } catch (err) {
    return {
      source: sourceType,
      updateAvailable: false,
      currentVersion: currentAppVersion,
      latestVersion: currentAppVersion,
      releaseName: `Current Version ${currentAppVersion}`,
      releaseNotes: 'Your application is on the latest available build.',
      downloadUrl: '',
      error: err.message
    };
  }
}

/**
 * Downloads update installer with live progress tracking
 */
export function downloadUpdate(downloadUrl, targetVersion = 'latest', onProgress = null) {
  return new Promise((resolve, reject) => {
    if (!downloadUrl || !downloadUrl.startsWith('http')) {
      return reject(new Error('Invalid update download URL'));
    }

    const updatesDir = getUpdatesDirectory();
    const fileName = `WhatsAppAutomationSetup_${targetVersion.replace(/[^a-zA-Z0-9._-]/g, '')}.exe`;
    const destPath = path.join(updatesDir, fileName);

    activeDownloadState = {
      isDownloading: true,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      speed: '0 KB/s',
      status: 'downloading',
      error: null,
      installerPath: destPath,
      targetVersion
    };

    const downloadWithRedirects = (url) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.get(url, {
        headers: { 'User-Agent': 'WhatsAppAutomation-AutoUpdater/1.0.0' }
      }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadWithRedirects(res.headers.location);
        }

        if (res.statusCode !== 200) {
          activeDownloadState.status = 'error';
          activeDownloadState.error = `HTTP ${res.statusCode}: ${res.statusMessage}`;
          activeDownloadState.isDownloading = false;
          return reject(new Error(activeDownloadState.error));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        activeDownloadState.totalBytes = totalBytes;

        const fileStream = fs.createWriteStream(destPath);
        let transferred = 0;
        let lastTime = Date.now();
        let lastTransferred = 0;

        res.on('data', (chunk) => {
          transferred += chunk.length;
          activeDownloadState.transferredBytes = transferred;

          if (totalBytes > 0) {
            activeDownloadState.percent = Math.min(100, Math.round((transferred / totalBytes) * 100));
          }

          // Calculate download speed every 500ms
          const now = Date.now();
          if (now - lastTime >= 500) {
            const timeDiff = (now - lastTime) / 1000;
            const bytesDiff = transferred - lastTransferred;
            const bytesPerSec = bytesDiff / timeDiff;

            if (bytesPerSec > 1024 * 1024) {
              activeDownloadState.speed = `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
            } else {
              activeDownloadState.speed = `${Math.round(bytesPerSec / 1024)} KB/s`;
            }

            lastTime = now;
            lastTransferred = transferred;

            if (typeof onProgress === 'function') {
              onProgress({ ...activeDownloadState });
            }
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            activeDownloadState.isDownloading = false;
            activeDownloadState.percent = 100;
            activeDownloadState.status = 'ready';
            activeDownloadState.installerPath = destPath;

            if (typeof onProgress === 'function') {
              onProgress({ ...activeDownloadState });
            }

            resolve({
              success: true,
              installerPath: destPath,
              version: targetVersion,
              totalBytes: transferred
            });
          });
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          activeDownloadState.status = 'error';
          activeDownloadState.error = err.message;
          activeDownloadState.isDownloading = false;
          reject(err);
        });
      });

      req.on('error', (err) => {
        activeDownloadState.status = 'error';
        activeDownloadState.error = err.message;
        activeDownloadState.isDownloading = false;
        reject(err);
      });
    };

    downloadWithRedirects(downloadUrl);
  });
}

/**
 * Returns current download progress state
 */
export function getDownloadState() {
  return { ...activeDownloadState, currentVersion: currentAppVersion };
}

/**
 * Executes downloaded installer and triggers application exit
 */
export function applyUpdateAndRestart(installerPath = activeDownloadState.installerPath) {
  if (!installerPath || !fs.existsSync(installerPath)) {
    throw new Error('Downloaded installer file not found on disk');
  }

  console.log(`[AutoUpdater] Launching update installer: ${installerPath}`);

  // Launch installer detached so it proceeds after current process closes
  const child = spawn(installerPath, ['--updated'], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  return { success: true, message: 'Installer launched. Application will now restart.' };
}

export default {
  currentAppVersion,
  isNewerVersion,
  checkForUpdates,
  downloadUpdate,
  getDownloadState,
  applyUpdateAndRestart,
  getUpdatesDirectory
};
