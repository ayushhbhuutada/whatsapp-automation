import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INTERNAL_PEPPER = 'WA_AUTO_HARDWARE_NODE_LOCK_v1_2026';

let cachedProfile = null;
let cachedMachineId = null;

/**
 * Resolves paths for permanent machine ID anchor files
 */
function getAnchorFilePaths() {
  const paths = [];

  // Primary: %APPDATA%/WhatsAppAutomation/machine_id.anchor
  const appData = process.env.APPDATA;
  if (appData) {
    const dir = path.join(appData, 'WhatsAppAutomation');
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      paths.push(path.join(dir, 'machine_id.anchor'));
    } catch (e) {}
  }

  // Fallback: <project_root>/database/machine_id.anchor
  try {
    const dbDir = path.resolve(__dirname, '../../database');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    paths.push(path.join(dbDir, 'machine_id.anchor'));
  } catch (e) {}

  return paths;
}

/**
 * Loads anchored machine ID from persistent disk storage
 */
function loadAnchoredMachineId() {
  const anchorPaths = getAnchorFilePaths();
  for (const fpath of anchorPaths) {
    try {
      if (fs.existsSync(fpath)) {
        const content = fs.readFileSync(fpath, 'utf8').trim();
        if (content && /^WA-WIN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(content)) {
          return content;
        }
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Saves machine ID to persistent disk anchors
 */
function saveAnchoredMachineId(machineId) {
  if (!machineId || !/^WA-WIN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(machineId)) return;
  const anchorPaths = getAnchorFilePaths();
  for (const fpath of anchorPaths) {
    try {
      const dir = path.dirname(fpath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fpath, machineId, 'utf8');
    } catch (e) {}
  }
}

/**
 * Queries Windows MachineGuid directly from registry (ultra-fast, < 5ms)
 */
function getWindowsMachineGuid() {
  if (process.platform === 'win32') {
    try {
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const match = out.match(/MachineGuid\s+REG_SZ\s+([a-fA-F0-9-]+)/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch (_e) {}
  }
  return '';
}

/**
 * Queries immutable Windows hardware attributes
 */
function queryWindowsHardware() {
  const hw = {
    uuid: '',
    cpu: '',
    machineGuid: getWindowsMachineGuid()
  };

  if (process.platform === 'win32') {
    try {
      const psCommand = `powershell -NoProfile -NonInteractive -Command "[PSCustomObject]@{ uuid=(Get-CimInstance Win32_ComputerSystemProduct).UUID; cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId } | ConvertTo-Json -Compress"`;
      const output = execSync(psCommand, { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (output) {
        const parsed = JSON.parse(output);
        hw.uuid = (parsed.uuid || '').trim();
        hw.cpu = (parsed.cpu || '').trim();
      }
    } catch (err) {
      // Fallback to wmic or environment if powershell is busy
    }
  }

  // Immutable fallbacks
  if (!hw.uuid) {
    hw.uuid = os.hostname() || 'DEFAULT_SYS_UUID';
  }
  if (!hw.cpu) {
    const cpus = os.cpus();
    hw.cpu = (cpus && cpus.length > 0 && cpus[0].model) ? cpus[0].model : `${os.arch()}_${os.platform()}`;
  }
  if (!hw.machineGuid) {
    hw.machineGuid = `${os.platform()}_${os.userInfo().username || 'USER'}`;
  }

  return hw;
}

/**
 * Builds deterministic hardware profile and machine ID with permanent disk anchoring
 * @param {Object} [options]
 * @param {boolean} [options.refresh=false]
 * @returns {{ uuid: string, cpu: string, machineGuid: string, rawFingerprint: string, machineId: string, hash: string }}
 */
export function getHardwareProfile(options = {}) {
  if (cachedProfile && !options.refresh) {
    return cachedProfile;
  }

  // 1. Check if machine ID is already permanently anchored on this PC
  const existingAnchor = !options.refresh ? loadAnchoredMachineId() : null;

  const winHw = queryWindowsHardware();

  const rawElements = [
    winHw.uuid.trim().toUpperCase(),
    winHw.cpu.trim().toUpperCase(),
    winHw.machineGuid.trim().toLowerCase()
  ];

  const rawFingerprint = rawElements.join(':::');
  const fullHash = crypto
    .createHmac('sha256', INTERNAL_PEPPER)
    .update(rawFingerprint)
    .digest('hex')
    .toUpperCase();

  // If anchor exists, keep the permanent anchor; otherwise use newly calculated ID
  const formattedId = existingAnchor || `WA-WIN-${fullHash.slice(0, 4)}-${fullHash.slice(4, 8)}-${fullHash.slice(8, 12)}-${fullHash.slice(12, 16)}`;

  // Save anchor to disk if not already saved
  if (!existingAnchor) {
    saveAnchoredMachineId(formattedId);
  }

  cachedProfile = {
    uuid: winHw.uuid,
    cpu: winHw.cpu,
    machineGuid: winHw.machineGuid,
    rawFingerprint,
    machineId: formattedId,
    hash: fullHash
  };
  cachedMachineId = formattedId;

  return cachedProfile;
}

/**
 * Returns formatted Machine ID (e.g. WA-WIN-4F88-BFEB-9080-EC63)
 * @returns {string}
 */
export function getMachineId() {
  if (cachedMachineId) {
    return cachedMachineId;
  }
  const profile = getHardwareProfile();
  return profile.machineId;
}

/**
 * Alias for getHardwareProfile
 */
export function getHardwareFingerprint() {
  const profile = getHardwareProfile();
  return {
    raw: profile.rawFingerprint,
    machineId: profile.machineId,
    hash: profile.hash,
    profile
  };
}

export default {
  getMachineId,
  getHardwareProfile,
  getHardwareFingerprint
};
