import assert from 'node:assert';
import http from 'node:http';
import express from '../backend/node_modules/express/index.js';
import { getMachineId, getHardwareProfile, getHardwareFingerprint } from '../backend/services/hardwareIdService.js';
import {
  verifyLicense,
  activateLicense,
  getLicenseStatus,
  validateLicenseKey,
  getLeaseFilePaths,
  loadCachedLease
} from '../backend/services/licenseService.js';
import {
  encryptField,
  decryptField,
  encryptData,
  decryptData
} from '../backend/services/cryptoDbService.js';
import {
  createLicenseKey,
  createExpiredLicense,
  createTamperedLicense,
  generateVendorKeyPair,
  signPayload,
  VENDOR_PUBLIC_KEY,
  VENDOR_PRIVATE_KEY
} from '../backend/utils/licenseGenerator.js';
import licenseRoutes from '../backend/routes.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('   MILESTONE 1: SECURITY, NODE-LOCKING & LICENSING TEST SUITE   ');
  console.log('================================================================\n');

  // ================================================================
  // 1. HARDWARE NODE-LOCKING & MACHINE ID GENERATION
  // ================================================================
  console.log('--- 1. Hardware Node-Locking & Determinism ---');

  const currentMachineId = getMachineId();
  console.log(`  Hardware Machine ID: ${currentMachineId}`);

  test('Machine ID format matches WA-WIN-XXXX-XXXX-XXXX-XXXX', () => {
    const idRegex = /^WA-WIN-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;
    assert.match(currentMachineId, idRegex, `Machine ID '${currentMachineId}' does not match expected format`);
  });

  test('Machine ID generation is 100% deterministic across 50 consecutive runs', () => {
    for (let i = 0; i < 50; i++) {
      const iterId = getMachineId();
      assert.strictEqual(iterId, currentMachineId, `Mismatch on iteration ${i}: expected ${currentMachineId}, got ${iterId}`);
    }
  });

  test('Hardware profile contains all 4 factors + MAC address', () => {
    const profile = getHardwareProfile();
    assert(profile.uuid && typeof profile.uuid === 'string', 'Motherboard UUID missing');
    assert(profile.cpu && typeof profile.cpu === 'string', 'CPU identifier missing');
    assert(profile.disk && typeof profile.disk === 'string', 'Disk serial missing');
    assert(profile.machineGuid && typeof profile.machineGuid === 'string', 'Machine GUID missing');
    assert(profile.mac && typeof profile.mac === 'string', 'MAC address missing');
    assert(profile.rawFingerprint && profile.rawFingerprint.includes(':::'), 'Raw fingerprint format invalid');
    assert(profile.hash && profile.hash.length === 64, 'SHA-256 hash length must be 64 hex characters');
  });

  test('Hardware profile alias getHardwareFingerprint() returns consistent data', () => {
    const fp = getHardwareFingerprint();
    assert.strictEqual(fp.machineId, currentMachineId);
    assert.strictEqual(fp.hash, getHardwareProfile().hash);
  });

  // ================================================================
  // 2. ED25519 ASYMMETRIC DIGITAL SIGNATURE & LICENSE VERIFICATION
  // ================================================================
  console.log('\n--- 2. Ed25519 Digital Signature & Licensing Security ---');

  const validToken = createLicenseKey({
    customer: 'Enterprise Global Corp',
    licenseType: 'Enterprise Desktop',
    nodeLockId: currentMachineId,
    maxSessions: 25,
    features: ['unlimited_campaigns', 'spintax_engine', 'anti_ban_warmup', 'scheduled_broadcasting']
  });

  test('Valid Ed25519 signed license token verifies successfully', () => {
    const res = verifyLicense(validToken, currentMachineId);
    assert.strictEqual(res.valid, true, `Expected valid: true, got ${res.valid} (${res.error})`);
    assert.strictEqual(res.payload.customer, 'Enterprise Global Corp');
    assert.strictEqual(res.payload.licenseType, 'Enterprise Desktop');
    assert.strictEqual(res.payload.nodeLockId, currentMachineId);
    assert.strictEqual(res.isGracePeriod, false);
    assert(res.daysRemaining > 300, `Expected > 300 days remaining, got ${res.daysRemaining}`);
  });

  test('Unauthenticated legacy prefix keys (WA-PRO-*, WA-ENT-*) are strictly rejected without digital signature', () => {
    const probeKeys = [
      'WA-PRO-UNAUTHORIZED-HACKER-KEY-1234',
      'WA-ENT-FORGED-ENTERPRISE-KEY-9999',
      'WA-PRO-FREE-LICENSE',
      'WA-ENT-CRACKED'
    ];
    for (const key of probeKeys) {
      const res = verifyLicense(key, currentMachineId);
      assert.strictEqual(res.valid, false, `Unsigned key '${key}' must be rejected`);
      assert(res.error.includes('LICENSE_INVALID_FORMAT'), `Expected format error for key '${key}', got: ${res.error}`);
    }
  });

  test('Tampered digital signature is rejected with LICENSE_INVALID_SIGNATURE', () => {
    const tamperedToken = createTamperedLicense({
      customer: 'Enterprise Global Corp',
      nodeLockId: currentMachineId
    });
    const res = verifyLicense(tamperedToken, currentMachineId);
    assert.strictEqual(res.valid, false, 'Tampered token should be rejected');
    assert(res.error.includes('LICENSE_INVALID_SIGNATURE'), `Expected invalid signature error, got: ${res.error}`);
  });

  test('Tampered payload data (elevated features) is rejected', () => {
    const parts = validToken.split('.');
    const decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    decodedPayload.maxSessions = 9999; // Attacker attempts to modify payload
    const modifiedPayloadB64 = Buffer.from(JSON.stringify(decodedPayload)).toString('base64url');
    const forgedToken = `${parts[0]}.${modifiedPayloadB64}.${parts[2]}`;

    const res = verifyLicense(forgedToken, currentMachineId);
    assert.strictEqual(res.valid, false, 'Forged payload with original signature must be rejected');
    assert(res.error.includes('LICENSE_INVALID_SIGNATURE'), `Expected invalid signature error, got: ${res.error}`);
  });

  test('Mismatched Hardware Machine ID is rejected with LICENSE_HARDWARE_MISMATCH', () => {
    const foreignMachineId = 'WA-WIN-DEAD-BEEF-CAFE-1234';
    const foreignToken = createLicenseKey({
      customer: 'Foreign User',
      nodeLockId: foreignMachineId
    });
    const res = verifyLicense(foreignToken, currentMachineId);
    assert.strictEqual(res.valid, false, 'Foreign machine token must be rejected');
    assert(res.error.includes('LICENSE_HARDWARE_MISMATCH'), `Expected hardware mismatch error, got: ${res.error}`);
  });

  test('Wildcard nodeLockId (*) is accepted on any machine', () => {
    const wildcardToken = createLicenseKey({
      customer: 'Universal Multi-Machine License',
      nodeLockId: '*'
    });
    const res = verifyLicense(wildcardToken, currentMachineId);
    assert.strictEqual(res.valid, true, `Wildcard license should be valid: ${res.error}`);
    assert.strictEqual(res.payload.nodeLockId, '*');
  });

  test('Expired license past grace period is rejected with LICENSE_EXPIRED', () => {
    const expiredToken = createExpiredLicense({
      customer: 'Expired Account',
      nodeLockId: currentMachineId
    });
    const res = verifyLicense(expiredToken, currentMachineId);
    assert.strictEqual(res.valid, false, 'Expired license must be rejected');
    assert(res.error.includes('LICENSE_EXPIRED'), `Expected expired error, got: ${res.error}`);
  });

  test('License within 14-day offline grace period remains valid with isGracePeriod=true', () => {
    const now = Date.now();
    // Expired 5 days ago, grace period is 14 days -> 9 days of grace remaining
    const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    const issuedAt = new Date(now - 35 * 24 * 60 * 60 * 1000).toISOString();
    const graceToken = createLicenseKey({
      customer: 'Grace Period User',
      nodeLockId: currentMachineId,
      issuedAt,
      expiryDate: fiveDaysAgo,
      gracePeriodDays: 14
    });

    const res = verifyLicense(graceToken, currentMachineId, { currentTime: now });
    assert.strictEqual(res.valid, true, `Grace period license should remain valid: ${res.error}`);
    assert.strictEqual(res.isGracePeriod, true, 'License should be flagged as isGracePeriod: true');
    assert(res.daysRemaining >= 8 && res.daysRemaining <= 10, `Expected ~9 days remaining, got ${res.daysRemaining}`);
  });

  test('Anti-Clock-Tampering: Rejects if system clock is earlier than license issuance date', () => {
    const futureIssuedToken = createLicenseKey({
      customer: 'Future User',
      nodeLockId: currentMachineId,
      issuedAt: new Date(Date.now() + 86400000).toISOString() // Issued tomorrow
    });
    const res = verifyLicense(futureIssuedToken, currentMachineId, { currentTime: Date.now() });
    assert.strictEqual(res.valid, false, 'Future issuance date should be rejected');
    assert(res.error.includes('CLOCK_ROLLBACK_DETECTED'), `Expected clock rollback error, got: ${res.error}`);
  });

  test('Anti-Clock-Tampering: Rejects if system clock is rolled back behind last recorded run time', () => {
    const recordedLastRun = Date.now();
    const rolledBackClock = recordedLastRun - (2 * 86400000); // 2 days in the past
    const res = verifyLicense(validToken, currentMachineId, {
      currentTime: rolledBackClock,
      lastRunTimestamp: recordedLastRun
    });
    assert.strictEqual(res.valid, false, 'Clock rolled back past last recorded run must be rejected');
    assert(res.error.includes('CLOCK_ROLLBACK_DETECTED'), `Expected clock rollback error, got: ${res.error}`);
  });

  // ================================================================
  // 3. OFFLINE LEASE CACHING & ACTIVATION WORKFLOW
  // ================================================================
  console.log('\n--- 3. Offline Lease Caching & Activation Workflow ---');

  await asyncTest('activateLicense stores offline lease and binds to machine', async () => {
    const activateRes = await activateLicense(validToken);
    assert.strictEqual(activateRes.success, true, `Activation failed: ${activateRes.error}`);
    assert.strictEqual(activateRes.machineId, currentMachineId);
    assert.strictEqual(activateRes.license.customer, 'Enterprise Global Corp');

    // Verify cached lease file exists and contains valid license
    const lease = await loadCachedLease();
    assert(lease !== null, 'Offline cached lease should exist');
    assert.strictEqual(lease.licenseKey, validToken);
    assert.strictEqual(lease.machineId, currentMachineId);
  });

  await asyncTest('getLicenseStatus returns active status and details from cached lease', async () => {
    const status = await getLicenseStatus();
    assert.strictEqual(status.activated, true, `Expected activated: true, got ${status.activated}`);
    assert.strictEqual(status.machineId, currentMachineId);
    assert.strictEqual(status.license.customer, 'Enterprise Global Corp');
    assert.strictEqual(status.isGracePeriod, false);
    assert(status.daysRemaining > 300);
  });

  await asyncTest('validateLicenseKey backward compatibility wrapper passes', async () => {
    const valRes = await validateLicenseKey(validToken, currentMachineId);
    assert.strictEqual(valRes.valid, true);
    assert.strictEqual(valRes.licenseType, 'Enterprise Desktop');
    assert.strictEqual(valRes.machineId, currentMachineId);
  });

  // ================================================================
  // 4. AES-256-GCM DATABASE FIELD ENCRYPTION & DECRYPTION
  // ================================================================
  console.log('\n--- 4. AES-256-GCM Hardware-Bound Database Field Encryption ---');

  const sensitiveSample = 'Confidential_Contact_Phone_+19876543210_Token_xyz987';
  let encryptedText = '';

  test('encryptField produces enc:v1:<salt>:<iv>:<tag>:<ciphertext> format', () => {
    encryptedText = encryptField(sensitiveSample, currentMachineId);
    console.log(`  Sample Encrypted Field: ${encryptedText.slice(0, 50)}...`);
    const parts = encryptedText.split(':');
    assert.strictEqual(parts.length, 6, 'Encrypted format must have 6 colon-separated parts');
    assert.strictEqual(parts[0], 'enc');
    assert.strictEqual(parts[1], 'v1');
    assert.strictEqual(parts[2].length, 32, 'Salt hex must be 32 chars (16 bytes)');
    assert.strictEqual(parts[3].length, 24, 'IV hex must be 24 chars (12 bytes)');
    assert.strictEqual(parts[4].length, 32, 'Auth Tag hex must be 32 chars (16 bytes)');
    assert(parts[5].length > 0, 'Ciphertext must not be empty');
  });

  test('decryptField recovers identical plaintext using matching machine ID', () => {
    const decrypted = decryptField(encryptedText, currentMachineId);
    assert.strictEqual(decrypted, sensitiveSample, `Decrypted text mismatch: ${decrypted}`);
  });

  test('Cross-machine decryption failure: different machine ID throws authentication error', () => {
    const wrongMachineId = 'WA-WIN-ATTACKER-9999-8888-7777';
    assert.throws(
      () => decryptField(encryptedText, wrongMachineId),
      /Decryption failed|unable to authenticate data/i,
      'Decryption on different hardware machine must throw authentication error'
    );
  });

  test('Corrupted authentication tag throws authentication error', () => {
    const parts = encryptedText.split(':');
    // Corrupt tag
    parts[4] = '00'.repeat(16);
    const corruptedEncrypted = parts.join(':');
    assert.throws(
      () => decryptField(corruptedEncrypted, currentMachineId),
      /Decryption failed|unable to authenticate data/i,
      'Corrupted tag must fail AES-256-GCM authentication'
    );
  });

  test('Corrupted ciphertext throws authentication error', () => {
    const parts = encryptedText.split(':');
    // Corrupt ciphertext
    parts[5] = parts[5].substring(0, parts[5].length - 4) + 'ffff';
    const corruptedEncrypted = parts.join(':');
    assert.throws(
      () => decryptField(corruptedEncrypted, currentMachineId),
      /Decryption failed|unable to authenticate data/i,
      'Corrupted ciphertext must fail AES-256-GCM authentication'
    );
  });

  test('Plaintext and null inputs are handled gracefully', () => {
    assert.strictEqual(decryptField('regular_unencrypted_string', currentMachineId), 'regular_unencrypted_string');
    assert.strictEqual(decryptField(null, currentMachineId), null);
    assert.strictEqual(decryptField(undefined, currentMachineId), undefined);
    assert.strictEqual(encryptField(null, currentMachineId), null);
    assert.strictEqual(encryptField('', currentMachineId), '');
  });

  // ================================================================
  // 5. REST API ENDPOINT INTEGRATION (Express Routes)
  // ================================================================
  console.log('\n--- 5. Express Licensing REST API Endpoints ---');

  const app = express();
  app.use(express.json());
  app.use('/api', licenseRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  async function apiRequest(endpoint, options = {}) {
    const url = `${baseUrl}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  await asyncTest('GET /api/license/machine-id returns hardware machine ID', async () => {
    const res = await apiRequest('/api/license/machine-id');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.machineId, currentMachineId);
  });

  await asyncTest('GET /api/license/status returns activated status', async () => {
    const res = await apiRequest('/api/license/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.activated, true);
    assert.strictEqual(res.data.machineId, currentMachineId);
    assert(res.data.license !== null);
  });

  await asyncTest('POST /api/license/activate with valid key activates successfully', async () => {
    const newKey = createLicenseKey({
      customer: 'Acme Enterprises Live',
      licenseType: 'Pro Desktop',
      nodeLockId: currentMachineId
    });
    const res = await apiRequest('/api/license/activate', {
      method: 'POST',
      body: { licenseKey: newKey }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.activated, true);
    assert.strictEqual(res.data.license.customer, 'Acme Enterprises Live');
  });

  await asyncTest('POST /api/license/activate with invalid key returns 400 error', async () => {
    const res = await apiRequest('/api/license/activate', {
      method: 'POST',
      body: { licenseKey: 'WALIC.invalid.token' }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert(res.data.error.length > 0);
  });

  await asyncTest('POST /api/license/activate with empty key returns 400 error', async () => {
    const res = await apiRequest('/api/license/activate', {
      method: 'POST',
      body: {}
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.strictEqual(res.data.error, 'License key is required.');
  });

  server.close();
  server.unref();

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log('\n================================================================');
  console.log(`MILESTONE 1 SECURITY TEST SUITE RESULTS: Passed: ${passed} | Failed: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error('FAILURES:', JSON.stringify(failures, null, 2));
    setTimeout(() => process.exit(1), 50);
  } else {
    console.log('🎉 ALL MILESTONE 1 SECURITY & LICENSING TESTS PASSED 100%!\n');
    setTimeout(() => process.exit(0), 50);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal error executing test suite:', err);
  setTimeout(() => process.exit(1), 50);
});
