import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INTERNAL_PEPPER = 'WA_AUTO_HARDWARE_NODE_LOCK_v1_2026';

// Windows Registry key where the machine ID is permanently stored.
// This survives app uninstall/reinstall because NSIS does not touch HKCU software keys
// unless explicitly scripted to. This is the most resilient anchor.
const REG_KEY = 'HKCU\\Software\\WhatsAppAutomation';
const REG_VALUE = 'MachineAnchorId';

let cachedProfile = null;
let cachedMachineId = null;

// ──────────────────────────────────────────────────────────────────────
// Registry anchor: most resilient — survives reinstalls and %APPDATA% wipes
// ──────────────────────────────────────────────────────────────────────

function readRegistryAnchor() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync(
      `reg query "${REG_KEY}" /v ${REG_VALUE}`,
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const match = out.match(new RegExp(`${REG_VALUE}\\s+REG_SZ\\s+(WA-WIN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})`, 'i'));
    if (match && match[1]) return match[1].trim().toUpperCase();
  } catch (_e) {}
  return null;
}

function writeRegistryAnchor(machineId) {
  if (process.platform !== 'win32') return;
  if (!machineId || !/^WA-WIN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(machineId)) return;
  try {
    execSync(`reg add "${REG_KEY}" /f`, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    execSync(`reg add "${REG_KEY}" /v ${REG_VALUE} /t REG_SZ /d "${machineId}" /f`, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_e) {}
}

// ──────────────────────────────────────────────────────────────────────
// File anchors: secondary persistence in 3 locations
// Priority:
//  1. %APPDATA%/WhatsAppAutomation/machine_id.anchor
//  2. %LOCALAPPDATA%/Programs/WhatsAppAutomation/machine_id.anchor
//  3. <project_root>/database/machine_id.anchor
// ──────────────────────────────────────────────────────────────────────

function getAnchorFilePaths() {
  const paths = [];

  const appData = process.env.APPDATA;
  if (appData) {
    const dir = path.join(appData, 'WhatsAppAutomation');
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      paths.push(path.join(dir, 'machine_id.anchor'));
    } catch (_e) {}
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const dir = path.join(localAppData, 'Programs', 'WhatsAppAutomation');
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      paths.push(path.join(dir, 'machine_id.anchor'));
    } catch (_e) {}
  }

  try {
    const dbDir = path.resolve(__dirname, '../../database');
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    paths.push(path.join(dbDir, 'machine_id.anchor'));
  } catch (_e) {}

  return paths;
}

function loadFileAnchor() {
  for (const fpath of getAnchorFilePaths()) {
    try {
      if (fs.existsSync(fpath)) {
        const content = fs.readFileSync(fpath, 'utf8').trim().toUpperCase();
        if (content && /^WA-WIN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(content)) {
          return content;
        }
      }
    } catch (_e) {}
  }
  return null;
}

function saveFileAnchor(machineId) {
  if (!machineId || !/^WA-WIN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(machineId)) return;
  for (const fpath of getAnchorFilePaths()) {
    try {
      const dir = path.dirname(fpath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fpath, machineId.toUpperCase(), 'utf8');
    } catch (_e) {}
  }
}

// ──────────────────────────────────────────────────────────────────────
// Hardware fingerprint collection
// ──────────────────────────────────────────────────────────────────────

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
      if (match && match[1]) return match[1].trim();
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
    } catch (_err) {}
  }

  // Immutable fallbacks
  if (!hw.uuid) hw.uuid = os.hostname() || 'DEFAULT_SYS_UUID';
  if (!hw.cpu) {
    const cpus = os.cpus();
    hw.cpu = (cpus && cpus.length > 0 && cpus[0].model) ? cpus[0].model : `${os.arch()}_${os.platform()}`;
  }
  if (!hw.machineGuid) hw.machineGuid = `${os.platform()}_${os.userInfo().username || 'USER'}`;

  return hw;
}

// ──────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────

/**
 * Builds deterministic hardware profile and machine ID with permanent anchoring.
 *
 * Anchor priority (load order):
 *   1. Windows Registry: HKCU\Software\WhatsAppAutomation\MachineAnchorId  ← most resilient
 *   2. File anchors:     %APPDATA%, %LOCALAPPDATA%\Programs, database/
 *   3. Fresh hardware fingerprint hash (first-time generation on new machine)
 *
 * On first run: generates the ID from hardware, writes to ALL anchor locations.
 * On reinstall: reads from registry (which was never deleted), skips hardware scan.
 *
 * @param {Object} [options]
 * @param {boolean} [options.refresh=false]
 */
export function getHardwareProfile(options = {}) {
  if (cachedProfile && !options.refresh) return cachedProfile;

  // 1. Try registry anchor first (survives reinstall)
  let existingAnchor = !options.refresh ? readRegistryAnchor() : null;

  // 2. Fall back to file anchors
  if (!existingAnchor && !options.refresh) existingAnchor = loadFileAnchor();

  // 3. Collect hardware fingerprint (for generating new ID if no anchor found)
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

  // 4. Determine the final machine ID
  const formattedId = existingAnchor ||
    `WA-WIN-${fullHash.slice(0, 4)}-${fullHash.slice(4, 8)}-${fullHash.slice(8, 12)}-${fullHash.slice(12, 16)}`;

  // 5. Sync any missing anchors (e.g. registry exists but file was deleted, or vice versa)
  if (!readRegistryAnchor()) writeRegistryAnchor(formattedId);
  if (!loadFileAnchor()) saveFileAnchor(formattedId);

  const macAddresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')
    .map(i => i.mac);
  const primaryMac = macAddresses.length > 0 ? macAddresses[0] : '00:15:5D:01:02:03';

  cachedProfile = {
    uuid: winHw.uuid,
    cpu: winHw.cpu,
    disk: winHw.machineGuid || 'DEFAULT_SYS_DISK',
    mac: primaryMac,
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
  if (cachedMachineId) return cachedMachineId;
  return getHardwareProfile().machineId;
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