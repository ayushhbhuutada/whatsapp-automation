import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMachineId } from './hardwareIdService.js';
import { VENDOR_PUBLIC_KEY, canonicalJsonStringify } from '../utils/licenseGenerator.js';
import { get, run } from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves paths for offline lease cache files
 */
export function getLeaseFilePaths() {
  const paths = [];

  // Primary: %APPDATA%/WhatsAppAutomation/license.json
  const appData = process.env.APPDATA;
  if (appData) {
    const dir = path.join(appData, 'WhatsAppAutomation');
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      paths.push(path.join(dir, 'license.json'));
    } catch (e) {}
  }

  // Fallback: <project_root>/database/license.json
  try {
    const dbDir = path.resolve(__dirname, '../../database');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    paths.push(path.join(dbDir, 'license.json'));
  } catch (e) {}

  return paths;
}

/**
 * Loads cached lease from disk or database
 */
export async function loadCachedLease() {
  const leasePaths = getLeaseFilePaths();
  for (const fpath of leasePaths) {
    try {
      if (fs.existsSync(fpath)) {
        const content = fs.readFileSync(fpath, 'utf8').trim();
        if (content) {
          return JSON.parse(content);
        }
      }
    } catch (e) {}
  }

  // Check SQLite settings table fallback
  try {
    const row = await get("SELECT value FROM settings WHERE key = 'offline_license_lease'");
    if (row && row.value) {
      return JSON.parse(row.value);
    }
    const keyRow = await get("SELECT value FROM settings WHERE key = 'license_key'");
    if (keyRow && keyRow.value) {
      return { licenseKey: keyRow.value };
    }
  } catch (e) {}

  return null;
}

/**
 * Saves offline lease cache to disk and SQLite
 */
export async function saveCachedLease(leaseData) {
  const jsonStr = JSON.stringify(leaseData, null, 2);
  const leasePaths = getLeaseFilePaths();

  for (const fpath of leasePaths) {
    try {
      const dir = path.dirname(fpath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fpath, jsonStr, 'utf8');
    } catch (e) {}
  }

  try {
    await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (1, 'offline_license_lease', ?)", [jsonStr]);
    if (leaseData.licenseKey) {
      await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (1, 'license_key', ?)", [leaseData.licenseKey]);
    }
    if (leaseData.lastRunTimestamp) {
      await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (1, 'license_last_run', ?)", [String(leaseData.lastRunTimestamp)]);
    }
  } catch (e) {}
}

/**
 * Verifies cryptographic license key against hardware node-lock and expiration
 * 
 * @param {string} licenseKey The WALIC token or license string
 * @param {string} [machineId] Machine ID to check against (defaults to current hardware ID)
 * @param {Object} [options]
 * @param {number} [options.lastRunTimestamp] Last recorded run timestamp for anti-clock-rollback
 * @param {number} [options.currentTime] Simulated current time for testing
 * @returns {{ valid: boolean, payload?: object, isGracePeriod?: boolean, daysRemaining?: number, error?: string }}
 */
export function verifyLicense(licenseKey, machineId = getMachineId(), options = {}) {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return { valid: false, error: 'LICENSE_MISSING: No license key provided.' };
  }

  const cleanKey = licenseKey.trim();
  const now = options.currentTime !== undefined ? options.currentTime : Date.now();
  const lastRunTimestamp = options.lastRunTimestamp || 0;

  // 1. Anti-Clock-Tampering: Check if current system clock was rolled back behind last recorded run
  if (lastRunTimestamp > 0 && now < (lastRunTimestamp - 60000)) {
    return {
      valid: false,
      error: `CLOCK_ROLLBACK_DETECTED: System clock (${new Date(now).toISOString()}) is earlier than last recorded run time (${new Date(lastRunTimestamp).toISOString()}).`
    };
  }

  // 2. WALIC Asymmetric Ed25519 Token Verification ONLY (Zero unauthenticated bypasses)
  if (!cleanKey.startsWith('WALIC.')) {
    return {
      valid: false,
      error: 'LICENSE_INVALID_FORMAT: Commercial license key must begin with WALIC.'
    };
  }

  const parts = cleanKey.split('.');
  if (parts.length !== 3) {
    return {
      valid: false,
      error: 'LICENSE_INVALID_FORMAT: Token must contain prefix, payload, and signature.'
    };
  }

  const [, b64Payload, b64Sig] = parts;

  let payload;
  let rawPayloadStr;
  try {
    rawPayloadStr = Buffer.from(b64Payload, 'base64url').toString('utf8');
    payload = JSON.parse(rawPayloadStr);
  } catch (err) {
    return {
      valid: false,
      error: `LICENSE_MALFORMED_PAYLOAD: Could not decode JSON payload: ${err.message}`
    };
  }

  let signatureBuf;
  try {
    signatureBuf = Buffer.from(b64Sig, 'base64url');
  } catch (err) {
    return {
      valid: false,
      error: `LICENSE_MALFORMED_SIGNATURE: Invalid base64 signature encoding.`
    };
  }

  // Cryptographic Signature Validation using Ed25519 Public Key
  let isSignatureValid = false;
  try {
    const canonicalPayload = canonicalJsonStringify(payload);
    isSignatureValid = crypto.verify(null, Buffer.from(canonicalPayload, 'utf8'), VENDOR_PUBLIC_KEY, signatureBuf);
    if (!isSignatureValid) {
      // Fallback: check raw payload string
      isSignatureValid = crypto.verify(null, Buffer.from(rawPayloadStr, 'utf8'), VENDOR_PUBLIC_KEY, signatureBuf);
    }
  } catch (err) {
    return {
      valid: false,
      error: `LICENSE_VERIFY_ERROR: Cryptographic verification error: ${err.message}`
    };
  }

  if (!isSignatureValid) {
    return {
      valid: false,
      error: 'LICENSE_INVALID_SIGNATURE: Digital signature does not match vendor authority.'
    };
  }

  // 4. Anti-Clock-Tampering: Check if clock is earlier than license issuance time
  const issuedAtStr = payload.issuedAt || payload.issued_at;
  if (issuedAtStr) {
    const issuedAtMs = new Date(issuedAtStr).getTime();
    if (!isNaN(issuedAtMs) && now < (issuedAtMs - 60000)) {
      return {
        valid: false,
        error: `CLOCK_ROLLBACK_DETECTED: System clock (${new Date(now).toISOString()}) is earlier than license issuance date (${issuedAtStr}).`
      };
    }
  }

  // 5. Hardware Node-Locking Enforcement
  const lockedMachineId = payload.nodeLockId || payload.machine_id || payload.machineId;
  if (lockedMachineId && lockedMachineId !== '*') {
    if (lockedMachineId.toUpperCase() !== machineId.toUpperCase()) {
      return {
        valid: false,
        error: `LICENSE_HARDWARE_MISMATCH: License is bound to hardware '${lockedMachineId}', but running on '${machineId}'.`
      };
    }
  }

  // 6. Expiration & 14-Day Offline Grace Period Logic
  const expiryDateStr = payload.expiryDate || payload.expires_at || payload.expiresAt;
  const gracePeriodDays = payload.gracePeriodDays !== undefined ? Number(payload.gracePeriodDays) : (Number(payload.grace_period_days) || 14);
  const gracePeriodMs = gracePeriodDays * 24 * 60 * 60 * 1000;

  let isGracePeriod = false;
  let daysRemaining = 365;

  if (expiryDateStr && expiryDateStr !== 'Lifetime') {
    const expiryMs = new Date(expiryDateStr).getTime();
    if (!isNaN(expiryMs)) {
      if (now <= expiryMs) {
        // Active and unexpired
        isGracePeriod = false;
        daysRemaining = Math.max(0, Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000)));
      } else if (now <= (expiryMs + gracePeriodMs)) {
        // Within offline grace period
        isGracePeriod = true;
        daysRemaining = Math.max(0, Math.ceil((expiryMs + gracePeriodMs - now) / (24 * 60 * 60 * 1000)));
      } else {
        // Fully expired past grace period
        return {
          valid: false,
          error: `LICENSE_EXPIRED: License expired on ${expiryDateStr} and the ${gracePeriodDays}-day grace period has elapsed.`
        };
      }
    }
  }

  return {
    valid: true,
    payload,
    isGracePeriod,
    daysRemaining
  };
}

/**
 * Activates a license key, binds to current machine, and caches the lease
 * 
 * @param {string} licenseKey 
 * @returns {Promise<{ success: boolean, license?: object, message?: string, error?: string }>}
 */
export async function activateLicense(licenseKey) {
  const machineId = getMachineId();
  const cachedLease = await loadCachedLease();
  const lastRunTimestamp = cachedLease?.lastRunTimestamp || 0;

  const verification = verifyLicense(licenseKey, machineId, { lastRunTimestamp });

  if (!verification.valid) {
    return {
      success: false,
      error: verification.error || 'License verification failed.'
    };
  }

  const now = Date.now();
  const leaseData = {
    licenseKey: licenseKey.trim(),
    payload: verification.payload,
    machineId,
    activatedAt: new Date(now).toISOString(),
    lastVerifiedAt: new Date(now).toISOString(),
    lastRunTimestamp: now,
    isGracePeriod: verification.isGracePeriod,
    daysRemaining: verification.daysRemaining
  };

  await saveCachedLease(leaseData);

  return {
    success: true,
    message: 'Desktop License successfully activated and bound to this hardware machine.',
    license: verification.payload,
    isGracePeriod: verification.isGracePeriod,
    daysRemaining: verification.daysRemaining,
    machineId
  };
}

/**
 * Retrieves current license status (cached offline lease or stored settings)
 * 
 * @returns {Promise<{ activated: boolean, machineId: string, license: object|null, isGracePeriod: boolean, daysRemaining: number, error?: string }>}
 */
export async function getLicenseStatus() {
  const machineId = getMachineId();
  const cachedLease = await loadCachedLease();

  if (!cachedLease || !cachedLease.licenseKey) {
    return {
      activated: false,
      machineId,
      license: null,
      isGracePeriod: false,
      daysRemaining: 0,
      error: 'No active license found. Please activate your license key.'
    };
  }

  const lastRun = cachedLease.lastRunTimestamp || 0;
  const verification = verifyLicense(cachedLease.licenseKey, machineId, { lastRunTimestamp: lastRun });

  if (!verification.valid) {
    return {
      activated: false,
      machineId,
      license: null,
      isGracePeriod: false,
      daysRemaining: 0,
      error: verification.error
    };
  }

  // Update last run timestamp for anti-clock-rollback tracking
  const now = Date.now();
  if (now > lastRun) {
    cachedLease.lastRunTimestamp = now;
    cachedLease.lastVerifiedAt = new Date(now).toISOString();
    await saveCachedLease(cachedLease);
  }

  return {
    activated: true,
    machineId,
    license: verification.payload,
    isGracePeriod: verification.isGracePeriod,
    daysRemaining: verification.daysRemaining
  };
}

/**
 * Backward compatibility wrapper for existing validation calls
 */
export async function validateLicenseKey(licenseKey, machineId = getMachineId()) {
  const cachedLease = await loadCachedLease();
  const lastRunTimestamp = cachedLease?.lastRunTimestamp || 0;
  const res = verifyLicense(licenseKey, machineId, { lastRunTimestamp });
  if (res.valid) {
    return {
      valid: true,
      licenseType: res.payload.licenseType || 'Pro Desktop',
      machineId,
      activatedAt: res.payload.issuedAt || new Date().toISOString(),
      expiresAt: res.payload.expiryDate || 'Lifetime',
      features: res.payload.features || [],
      isGracePeriod: res.isGracePeriod,
      daysRemaining: res.daysRemaining,
      details: res.payload
    };
  }
  return {
    valid: false,
    reason: res.error
  };
}

export {
  getMachineId
};

export default {
  getMachineId,
  verifyLicense,
  activateLicense,
  getLicenseStatus,
  validateLicenseKey,
  getLeaseFilePaths,
  loadCachedLease,
  saveCachedLease
};
