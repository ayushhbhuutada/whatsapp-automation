import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';

const INTERNAL_PEPPER = 'WA_AUTO_HARDWARE_NODE_LOCK_v1_2026';

let cachedProfile = null;
let cachedMachineId = null;

/**
 * Extracts primary physical MAC address
 */
function getPrimaryMacAddress() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      const list = ifaces[name] || [];
      const physical = list.find(i => !i.internal && i.mac && i.mac !== '00:00:00:00:00:00');
      if (physical) {
        return physical.mac.trim().toLowerCase();
      }
    }
  } catch (e) {
    // ignore
  }
  return '00:00:00:00:00:00';
}

/**
 * Queries Windows hardware attributes via PowerShell CIM commands
 */
function queryWindowsHardware() {
  const hw = {
    uuid: '',
    cpu: '',
    disk: '',
    machineGuid: ''
  };

  if (process.platform === 'win32') {
    try {
      const psCommand = `powershell -NoProfile -NonInteractive -Command "[PSCustomObject]@{ uuid=(Get-CimInstance Win32_ComputerSystemProduct).UUID; cpu=(Get-CimInstance Win32_Processor).ProcessorId; disk=(Get-CimInstance Win32_DiskDrive | Select-Object -First 1).SerialNumber; guid=(Get-ItemPropertyValue 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' 'MachineGuid') } | ConvertTo-Json -Compress"`;
      const output = execSync(psCommand, { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (output) {
        const parsed = JSON.parse(output);
        hw.uuid = (parsed.uuid || '').trim();
        hw.cpu = (parsed.cpu || '').trim();
        hw.disk = (parsed.disk || '').trim();
        hw.machineGuid = (parsed.guid || '').trim();
      }
    } catch (err) {
      // CIM / PowerShell failed or timed out; fall back to individual or registry queries
    }
  }

  // Fallback / supplement individual empty fields
  if (!hw.uuid) {
    hw.uuid = os.hostname() || 'DEFAULT_SYS_UUID';
  }
  if (!hw.cpu) {
    const cpus = os.cpus();
    hw.cpu = (cpus && cpus.length > 0 && cpus[0].model) ? cpus[0].model : `${os.arch()}_${os.platform()}`;
  }
  if (!hw.disk) {
    hw.disk = process.env.SYSTEMDRIVE || 'C:';
  }
  if (!hw.machineGuid) {
    hw.machineGuid = `${os.platform()}_${os.userInfo().username || 'USER'}`;
  }

  return hw;
}

/**
 * Builds deterministic hardware profile and machine ID
 * @param {Object} [options]
 * @param {boolean} [options.refresh=false]
 * @returns {{ uuid: string, cpu: string, disk: string, machineGuid: string, mac: string, rawFingerprint: string, machineId: string, hash: string }}
 */
export function getHardwareProfile(options = {}) {
  if (cachedProfile && !options.refresh) {
    return cachedProfile;
  }

  const winHw = queryWindowsHardware();
  const mac = getPrimaryMacAddress();

  const rawElements = [
    winHw.uuid.trim().toUpperCase(),
    winHw.cpu.trim().toUpperCase(),
    winHw.disk.trim().toUpperCase(),
    winHw.machineGuid.trim().toLowerCase(),
    mac.trim().toLowerCase()
  ];

  const rawFingerprint = rawElements.join(':::');
  const fullHash = crypto
    .createHmac('sha256', INTERNAL_PEPPER)
    .update(rawFingerprint)
    .digest('hex')
    .toUpperCase();

  // Format: WA-WIN-XXXX-XXXX-XXXX-XXXX
  const formattedId = `WA-WIN-${fullHash.slice(0, 4)}-${fullHash.slice(4, 8)}-${fullHash.slice(8, 12)}-${fullHash.slice(12, 16)}`;

  cachedProfile = {
    uuid: winHw.uuid,
    cpu: winHw.cpu,
    disk: winHw.disk,
    machineGuid: winHw.machineGuid,
    mac,
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
