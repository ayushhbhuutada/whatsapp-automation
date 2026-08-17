import crypto from 'node:crypto';

// Official Vendor Ed25519 Keypair for WhatsApp Automation Suite
export const VENDOR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAX1ree9Gaacxt5fDO81UGyju9N517xBmfmBnCDau4YqY=
-----END PUBLIC KEY-----`;

export const VENDOR_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIP7O+FPjfm3xSwJjDMMee8FDlN0jCSNBQtQgBK2R8iZH
-----END PRIVATE KEY-----`;

/**
 * Encodes a buffer or string to Base64URL
 */
export function toBase64Url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64url');
}

/**
 * Decodes a Base64URL string to Buffer
 */
export function fromBase64Url(str) {
  return Buffer.from(str, 'base64url');
}

/**
 * Deterministic JSON serializer to ensure signature stability
 */
export function canonicalJsonStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => canonicalJsonStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`);
  return `{${pairs.join(',')}}`;
}

/**
 * Generates a new fresh Ed25519 keypair
 */
export function generateVendorKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
}

/**
 * Signs a canonical license payload using Ed25519 private key
 * @param {Object} payload 
 * @param {string} [privateKeyPem] 
 * @returns {string} Token formatted as WALIC.<b64url_payload>.<b64url_sig>
 */
export function signPayload(payload, privateKeyPem = VENDOR_PRIVATE_KEY) {
  const canonicalJson = canonicalJsonStringify(payload);
  const dataBuffer = Buffer.from(canonicalJson, 'utf8');
  const signature = crypto.sign(null, dataBuffer, privateKeyPem);

  const b64Payload = toBase64Url(canonicalJson);
  const b64Sig = toBase64Url(signature);

  return `WALIC.${b64Payload}.${b64Sig}`;
}

/**
 * Creates and signs a standard commercial license key
 * @param {Object} options
 * @param {string} options.customer Client name / company
 * @param {string} [options.licenseType="Pro Desktop"] License tier ('Pro Desktop', 'Enterprise Desktop')
 * @param {string|Date|number} [options.expiryDate] Expiration date string/ISO/timestamp (defaults to 1 year from now)
 * @param {Array<string>} [options.features] Enabled features list
 * @param {string} options.nodeLockId Target Machine ID (e.g. WA-WIN-XXXX-XXXX-XXXX-XXXX)
 * @param {string|Date|number} [options.issuedAt] Issue timestamp (defaults to Date.now())
 * @param {number} [options.gracePeriodDays=14] Offline grace period in days
 * @param {number} [options.maxSessions=10] Max WhatsApp sessions allowed
 * @param {string} [privateKeyPem]
 * @returns {string} WALIC token
 */
export function createLicenseKey(options = {}, privateKeyPem = VENDOR_PRIVATE_KEY) {
  const now = Date.now();
  const oneYearLater = new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString();

  const customer = options.customer || options.client_name || 'Commercial Licensee';
  const licenseType = options.licenseType || options.plan_tier || 'Pro Desktop';
  const expiryDate = options.expiryDate || options.expires_at || oneYearLater;
  const features = options.features || [
    'unlimited_campaigns',
    'anti_ban_warmup',
    'spintax_engine',
    'multi_device_sessions',
    'scheduled_broadcasting',
    'audience_hub_import'
  ];
  const nodeLockId = options.nodeLockId || options.machine_id || options.machineId || '*';
  const issuedAt = options.issuedAt || options.issued_at || new Date(now).toISOString();
  const gracePeriodDays = options.gracePeriodDays !== undefined ? options.gracePeriodDays : (options.grace_period_days || 14);
  const maxSessions = options.maxSessions || options.max_sessions || 10;

  const payload = {
    customer,
    licenseType,
    expiryDate: typeof expiryDate === 'object' && expiryDate.toISOString ? expiryDate.toISOString() : String(expiryDate),
    features,
    nodeLockId,
    issuedAt: typeof issuedAt === 'object' && issuedAt.toISOString ? issuedAt.toISOString() : String(issuedAt),
    gracePeriodDays: Number(gracePeriodDays),
    maxSessions: Number(maxSessions),
    version: '1.0'
  };

  return signPayload(payload, privateKeyPem);
}

/**
 * Creates an expired license for testing
 */
export function createExpiredLicense(options = {}, privateKeyPem = VENDOR_PRIVATE_KEY) {
  const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const issuedDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  return createLicenseKey({
    ...options,
    issuedAt: issuedDate,
    expiryDate: pastDate,
    gracePeriodDays: 7
  }, privateKeyPem);
}

/**
 * Creates a license with an invalid/tampered signature for testing
 */
export function createTamperedLicense(options = {}, privateKeyPem = VENDOR_PRIVATE_KEY) {
  const validToken = createLicenseKey(options, privateKeyPem);
  const parts = validToken.split('.');
  // Corrupt signature part
  const corruptedSig = parts[2].substring(0, parts[2].length - 4) + 'AAAA';
  return `${parts[0]}.${parts[1]}.${corruptedSig}`;
}

export default {
  VENDOR_PUBLIC_KEY,
  VENDOR_PRIVATE_KEY,
  toBase64Url,
  fromBase64Url,
  canonicalJsonStringify,
  generateVendorKeyPair,
  signPayload,
  createLicenseKey,
  createExpiredLicense,
  createTamperedLicense
};
