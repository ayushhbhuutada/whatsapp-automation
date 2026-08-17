import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import express from '../backend/node_modules/express/index.js';
import { createTestSuite } from './test_helper.js';
import {
  getMachineId,
  getHardwareProfile,
  getHardwareFingerprint
} from '../backend/services/hardwareIdService.js';
import {
  verifyLicense,
  activateLicense,
  getLicenseStatus,
  validateLicenseKey,
  getLeaseFilePaths,
  loadCachedLease,
  saveCachedLease
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
  canonicalJsonStringify,
  toBase64Url,
  fromBase64Url,
  VENDOR_PUBLIC_KEY,
  VENDOR_PRIVATE_KEY
} from '../backend/utils/licenseGenerator.js';
import licenseRoutes from '../backend/routes.js';

export const challengerM1Suite = createTestSuite('Challenger M1: Security, Hardware Node-Locking & Licensing Adversarial Stress Harness');

const currentMachineId = getMachineId();

// ============================================================================
// 1. HARDWARE ID DETERMINISM & CONCURRENCY STRESS
// ============================================================================

challengerM1Suite.add('Hardware ID: Determinism over 100 consecutive iterations', () => {
  const baseId = getMachineId();
  const idRegex = /^WA-WIN-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;
  assert.match(baseId, idRegex, `Base Machine ID '${baseId}' does not match expected format`);

  for (let i = 0; i < 100; i++) {
    const nextId = getMachineId();
    assert.strictEqual(nextId, baseId, `Hardware ID diverged on iteration ${i}: expected ${baseId}, got ${nextId}`);
  }
});

challengerM1Suite.add('Hardware ID: 50 concurrent asynchronous calls under high load', async () => {
  const baseId = getMachineId();
  const workers = Array.from({ length: 50 }, async (_, idx) => {
    const id = getMachineId();
    const profile = getHardwareProfile();
    const fp = getHardwareFingerprint();
    return { idx, id, profileId: profile.machineId, fpId: fp.machineId, hash: profile.hash };
  });

  const results = await Promise.all(workers);
  assert.strictEqual(results.length, 50);

  const baseHash = getHardwareProfile().hash;
  for (const r of results) {
    assert.strictEqual(r.id, baseId, `Worker ${r.idx} got mismatched machine ID`);
    assert.strictEqual(r.profileId, baseId, `Worker ${r.idx} got mismatched profile machine ID`);
    assert.strictEqual(r.fpId, baseId, `Worker ${r.idx} got mismatched fingerprint machine ID`);
    assert.strictEqual(r.hash, baseHash, `Worker ${r.idx} got mismatched SHA-256 hash`);
  }
});

challengerM1Suite.add('Hardware ID: Cache bypass with refresh flag produces deterministic output', () => {
  const profile1 = getHardwareProfile({ refresh: true });
  const profile2 = getHardwareProfile({ refresh: true });

  assert.strictEqual(profile1.machineId, profile2.machineId);
  assert.strictEqual(profile1.hash, profile2.hash);
  assert.strictEqual(profile1.rawFingerprint, profile2.rawFingerprint);
  assert.strictEqual(profile1.rawFingerprint.split(':::').length, 5, 'Raw fingerprint must contain 5 factors');
});

challengerM1Suite.add('Hardware ID: 4-factor composite Windows attributes & MAC are populated', () => {
  const p = getHardwareProfile();
  assert(p.uuid && typeof p.uuid === 'string' && p.uuid.length > 0, 'Motherboard UUID missing');
  assert(p.cpu && typeof p.cpu === 'string' && p.cpu.length > 0, 'CPU identifier missing');
  assert(p.disk && typeof p.disk === 'string' && p.disk.length > 0, 'Disk serial missing');
  assert(p.machineGuid && typeof p.machineGuid === 'string' && p.machineGuid.length > 0, 'Machine GUID missing');
  assert(p.mac && typeof p.mac === 'string' && p.mac.length > 0, 'MAC address missing');
  assert.strictEqual(p.hash.length, 64, 'SHA-256 HMAC must be exactly 64 hex characters');
});

// ============================================================================
// 2. ED25519 TOKEN FORGERY & CRYPTOGRAPHIC TAMPERING
// ============================================================================

challengerM1Suite.add('Ed25519 Forgery: Bit-flipping across 32 raw signature byte positions', () => {
  const token = createLicenseKey({
    customer: 'Security Audit Corp',
    licenseType: 'Pro Desktop',
    nodeLockId: currentMachineId
  });

  const parts = token.split('.');
  assert.strictEqual(parts.length, 3);
  const rawSigBuf = Buffer.from(parts[2], 'base64url');
  assert.strictEqual(rawSigBuf.length, 64, 'Ed25519 signature must be exactly 64 bytes');

  // Test mutating every alternate byte in the 64-byte signature
  for (let byteOffset = 0; byteOffset < 64; byteOffset += 2) {
    const mutatedSigBuf = Buffer.from(rawSigBuf);
    mutatedSigBuf[byteOffset] ^= 0x01; // Flip lowest bit
    const mutatedToken = `${parts[0]}.${parts[1]}.${mutatedSigBuf.toString('base64url')}`;

    const res = verifyLicense(mutatedToken, currentMachineId);
    assert.strictEqual(res.valid, false, `Mutated signature at byte offset ${byteOffset} was erroneously accepted`);
    assert(
      res.error.includes('LICENSE_INVALID_SIGNATURE') || res.error.includes('LICENSE_VERIFY_ERROR'),
      `Unexpected error for byte offset ${byteOffset}: ${res.error}`
    );
  }
});

challengerM1Suite.add('Ed25519 Forgery: Attacker unauthorized rogue keypair signature rejection', () => {
  // Generate an attacker-owned Ed25519 keypair
  const attackerKeypair = crypto.generateKeyPairSync('ed25519');
  const attackerPrivatePem = attackerKeypair.privateKey.export({ type: 'pkcs8', format: 'pem' });

  const payload = {
    customer: 'Attacker Rogue Entity',
    licenseType: 'Enterprise Desktop',
    expiryDate: '2099-12-31T23:59:59.000Z',
    features: ['unlimited_campaigns', 'root_admin_bypass'],
    nodeLockId: currentMachineId,
    issuedAt: new Date().toISOString(),
    gracePeriodDays: 30,
    maxSessions: 1000,
    version: '1.0'
  };

  const rogueToken = signPayload(payload, attackerPrivatePem);
  const verifyRes = verifyLicense(rogueToken, currentMachineId);

  assert.strictEqual(verifyRes.valid, false, 'Token signed with unapproved Ed25519 keypair must be rejected');
  assert(verifyRes.error.includes('LICENSE_INVALID_SIGNATURE'), `Expected invalid signature error, got: ${verifyRes.error}`);
});

challengerM1Suite.add('Ed25519 Forgery: Payload privilege escalation & field tampering attacks', () => {
  const originalToken = createLicenseKey({
    customer: 'Normal Licensee',
    licenseType: 'Pro Desktop',
    nodeLockId: currentMachineId,
    maxSessions: 2,
    features: ['basic_campaigns']
  });

  const [prefix, b64Payload, b64Sig] = originalToken.split('.');
  const decodedPayload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));

  const attacks = [
    { name: 'Feature Escalation', mutate: (p) => { p.features.push('admin_exploit', 'unlimited_campaigns'); } },
    { name: 'Max Sessions Boost', mutate: (p) => { p.maxSessions = 999999; } },
    { name: 'Tier Escalation', mutate: (p) => { p.licenseType = 'Enterprise Desktop'; } },
    { name: 'Expiry Extension', mutate: (p) => { p.expiryDate = '2099-01-01T00:00:00.000Z'; } },
    { name: 'Grace Period Extension', mutate: (p) => { p.gracePeriodDays = 365; } }
  ];

  for (const attack of attacks) {
    const payloadCopy = JSON.parse(JSON.stringify(decodedPayload));
    attack.mutate(payloadCopy);
    const forgedB64Payload = Buffer.from(JSON.stringify(payloadCopy)).toString('base64url');
    const forgedToken = `${prefix}.${forgedB64Payload}.${b64Sig}`;

    const res = verifyLicense(forgedToken, currentMachineId);
    assert.strictEqual(res.valid, false, `Attack '${attack.name}' was erroneously accepted`);
    assert(res.error.includes('LICENSE_INVALID_SIGNATURE'), `Attack '${attack.name}' failed with unexpected error: ${res.error}`);
  }
});

challengerM1Suite.add('Ed25519 Node-Locking: Strict machine ID binding, substrings, and mutators', () => {
  const validToken = createLicenseKey({
    customer: 'Hardware Bound User',
    nodeLockId: currentMachineId
  });

  // 1. Foreign machine ID
  const foreignId = 'WA-WIN-DEAD-BEEF-CAFE-1234';
  const resForeign = verifyLicense(validToken, foreignId);
  assert.strictEqual(resForeign.valid, false);
  assert(resForeign.error.includes('LICENSE_HARDWARE_MISMATCH'));

  // 2. Substring machine ID
  const substringId = currentMachineId.substring(0, currentMachineId.length - 4);
  const resSub = verifyLicense(validToken, substringId);
  assert.strictEqual(resSub.valid, false);
  assert(resSub.error.includes('LICENSE_HARDWARE_MISMATCH'));

  // 3. Off-by-one character mutation
  const lastChar = currentMachineId.slice(-1);
  const mutatedChar = lastChar === 'A' ? 'B' : 'A';
  const offByOneId = currentMachineId.slice(0, -1) + mutatedChar;
  const resOffByOne = verifyLicense(validToken, offByOneId);
  assert.strictEqual(resOffByOne.valid, false);
  assert(resOffByOne.error.includes('LICENSE_HARDWARE_MISMATCH'));

  // 4. Case-insensitivity check (license with lowercase vs uppercase current machine)
  const resCase = verifyLicense(validToken, currentMachineId.toLowerCase());
  assert.strictEqual(resCase.valid, true, `Hardware verification should be case-insensitive: ${resCase.error}`);

  // 5. Wildcard validation
  const wildcardToken = createLicenseKey({ customer: 'Wildcard', nodeLockId: '*' });
  const resWildcard = verifyLicense(wildcardToken, foreignId);
  assert.strictEqual(resWildcard.valid, true);

  // 6. Malformed wildcard token (e.g. '*wildcard')
  const pseudoWildcardToken = createLicenseKey({ customer: 'Pseudo Wildcard', nodeLockId: '*wildcard' });
  const resPseudo = verifyLicense(pseudoWildcardToken, foreignId);
  assert.strictEqual(resPseudo.valid, false);
  assert(resPseudo.error.includes('LICENSE_HARDWARE_MISMATCH'));
});

challengerM1Suite.add('Ed25519 Token Parser: Structural corruptions & malformed token inputs', () => {
  const malformedInputs = [
    { label: 'Empty string', val: '', expected: 'LICENSE_MISSING' },
    { label: 'Whitespace string', val: '   \t\n  ', expected: 'LICENSE_MISSING' },
    { label: 'Null value', val: null, expected: 'LICENSE_MISSING' },
    { label: 'Undefined value', val: undefined, expected: 'LICENSE_MISSING' },
    { label: 'Number value', val: 12345, expected: 'LICENSE_MISSING' },
    { label: 'Object value', val: { token: 'foo' }, expected: 'LICENSE_MISSING' },
    { label: 'Non-WALIC prefix', val: 'BEARER.b64payload.b64sig', expected: 'LICENSE_INVALID_FORMAT' },
    { label: 'Only 1 dot', val: 'WALIC.part1', expected: 'LICENSE_INVALID_FORMAT' },
    { label: '4 dot parts', val: 'WALIC.part1.part2.part3', expected: 'LICENSE_INVALID_FORMAT' },
    { label: 'Non-base64url payload characters', val: 'WALIC.@@@invalid###.c2lnbmF0dXJl', expected: 'LICENSE_MALFORMED_PAYLOAD' },
    { label: 'Non-JSON payload string', val: `WALIC.${Buffer.from('not json text').toString('base64url')}.c2lnbmF0dXJl`, expected: 'LICENSE_MALFORMED_PAYLOAD' }
  ];

  for (const item of malformedInputs) {
    const res = verifyLicense(item.val, currentMachineId);
    assert.strictEqual(res.valid, false, `Malformed token [${item.label}] was not rejected`);
    assert(
      res.error.includes(item.expected) || res.error.includes('LICENSE_'),
      `Malformed token [${item.label}] gave unexpected error: ${res.error}`
    );
  }
});

challengerM1Suite.add('Ed25519 Forgery: Comprehensive legacy prefix bypass & forged raw keys rejection matrix', () => {
  const forgedKeys = [
    'WA-PRO-TEST-9999-8888',
    'WA-ENT-ENTERPRISE-UNLIMITED-2026',
    'WA-PRO-12345',
    'WA-ENT-ADMIN-ROOT',
    'WA-PRO-',
    'WA-ENT-',
    'wa-pro-lowercase-key',
    'Wa-Ent-MixedCase-Key',
    '  WA-PRO-WHITESPACE-PADDED  ',
    'WALIC.WA-PRO-FORGED-INLINE',
    'WALIC.WA-ENT-FORGED-INLINE',
    'ABCD-EFGH-IJKL-MNOP',
    'LICENSE_KEY_ROOT_123',
    'FREE_TIER_OVERRIDE',
    'WALIC..',
    'WALIC.eyJmb28iOiJiYXIifQ.',
    'WALIC..c2lnbmF0dXJl'
  ];

  for (const key of forgedKeys) {
    const res = verifyLicense(key, currentMachineId);
    assert.strictEqual(res.valid, false, `Forged/legacy key '${key}' was erroneously accepted as valid`);
    assert(
      res.error.includes('LICENSE_INVALID_FORMAT') ||
      res.error.includes('LICENSE_MALFORMED_') ||
      res.error.includes('LICENSE_INVALID_SIGNATURE') ||
      res.error.includes('LICENSE_MISSING'),
      `Key '${key}' failed with unexpected error: ${res.error}`
    );
  }
});

// ============================================================================
// 3. EXTREME FUTURE & PAST CLOCK TAMPERING SCENARIOS
// ============================================================================

challengerM1Suite.add('Clock Tampering: System clock rolled back before license issuance date', () => {
  const now = Date.now();
  const token = createLicenseKey({
    customer: 'Clock Test User',
    nodeLockId: currentMachineId,
    issuedAt: new Date(now).toISOString(),
    expiryDate: new Date(now + 30 * 86400000).toISOString()
  });

  // Scenario 1: Clock set 1 day before issuance
  const res1 = verifyLicense(token, currentMachineId, { currentTime: now - 86400000 });
  assert.strictEqual(res1.valid, false);
  assert(res1.error.includes('CLOCK_ROLLBACK_DETECTED'), `Expected CLOCK_ROLLBACK_DETECTED, got: ${res1.error}`);

  // Scenario 2: Clock set to Unix Epoch (1970-01-01)
  const resEpoch = verifyLicense(token, currentMachineId, { currentTime: 0 });
  assert.strictEqual(resEpoch.valid, false);
  assert(resEpoch.error.includes('CLOCK_ROLLBACK_DETECTED'), `Expected CLOCK_ROLLBACK_DETECTED for Epoch, got: ${resEpoch.error}`);

  // Scenario 3: Clock set to Year 2000
  const res2000 = verifyLicense(token, currentMachineId, { currentTime: new Date('2000-01-01T00:00:00Z').getTime() });
  assert.strictEqual(res2000.valid, false);
  assert(res2000.error.includes('CLOCK_ROLLBACK_DETECTED'), `Expected CLOCK_ROLLBACK_DETECTED for Year 2000, got: ${res2000.error}`);
});

challengerM1Suite.add('Clock Tampering: Anti-clock-rollback tracking against last recorded run time', () => {
  const now = Date.now();
  const token = createLicenseKey({
    customer: 'Last Run User',
    nodeLockId: currentMachineId,
    issuedAt: new Date(now - 10 * 86400000).toISOString(), // Issued 10 days ago
    expiryDate: new Date(now + 30 * 86400000).toISOString()
  });

  const lastRecordedRun = now - 1000; // Recorded 1s ago

  // 1. Clock rolled back 61 seconds behind lastRecordedRun (> 60s tolerance)
  const resRollback = verifyLicense(token, currentMachineId, {
    currentTime: lastRecordedRun - 61000,
    lastRunTimestamp: lastRecordedRun
  });
  assert.strictEqual(resRollback.valid, false);
  assert(resRollback.error.includes('CLOCK_ROLLBACK_DETECTED'), `Expected CLOCK_ROLLBACK_DETECTED, got: ${resRollback.error}`);

  // 2. Clock rolled back 30 seconds behind lastRecordedRun (within 60s clock skew window)
  const resSkew = verifyLicense(token, currentMachineId, {
    currentTime: lastRecordedRun - 30000,
    lastRunTimestamp: lastRecordedRun
  });
  assert.strictEqual(resSkew.valid, true, `Clock skew within 60s should be tolerated: ${resSkew.error}`);
});

challengerM1Suite.add('Clock Tampering: Extreme future clock jump (50 years ahead) expires license', () => {
  const now = Date.now();
  const token = createLicenseKey({
    customer: 'Future Leap User',
    nodeLockId: currentMachineId,
    issuedAt: new Date(now).toISOString(),
    expiryDate: new Date(now + 365 * 86400000).toISOString() // 1 year expiry
  });

  // Jump to Year 2076 (50 years in future)
  const fiftyYearsLater = now + (50 * 365 * 86400000);
  const res = verifyLicense(token, currentMachineId, { currentTime: fiftyYearsLater });

  assert.strictEqual(res.valid, false);
  assert(res.error.includes('LICENSE_EXPIRED'), `Expected LICENSE_EXPIRED, got: ${res.error}`);
});

challengerM1Suite.add('Clock Tampering: Offline grace period boundary precision tests', () => {
  const baseTime = 1800000000000; // Fixed epoch for mathematical precision
  const issuedTime = baseTime - (30 * 86400000);
  const expiryTime = baseTime;
  const graceDays = 14;
  const graceMs = graceDays * 86400000;

  const token = createLicenseKey({
    customer: 'Grace Precision User',
    nodeLockId: currentMachineId,
    issuedAt: new Date(issuedTime).toISOString(),
    expiryDate: new Date(expiryTime).toISOString(),
    gracePeriodDays: graceDays
  });

  // Case A: 1 millisecond before expiry -> active & valid
  const resBefore = verifyLicense(token, currentMachineId, { currentTime: expiryTime - 1 });
  assert.strictEqual(resBefore.valid, true);
  assert.strictEqual(resBefore.isGracePeriod, false);

  // Case B: Exactly at expiry -> active
  const resAtExpiry = verifyLicense(token, currentMachineId, { currentTime: expiryTime });
  assert.strictEqual(resAtExpiry.valid, true);
  assert.strictEqual(resAtExpiry.isGracePeriod, false);

  // Case C: 1 millisecond after expiry -> inside grace period
  const resInsideGrace = verifyLicense(token, currentMachineId, { currentTime: expiryTime + 1 });
  assert.strictEqual(resInsideGrace.valid, true);
  assert.strictEqual(resInsideGrace.isGracePeriod, true);
  assert.strictEqual(resInsideGrace.daysRemaining, 14);

  // Case D: 7 days after expiry -> inside grace period
  const resMidGrace = verifyLicense(token, currentMachineId, { currentTime: expiryTime + (7 * 86400000) });
  assert.strictEqual(resMidGrace.valid, true);
  assert.strictEqual(resMidGrace.isGracePeriod, true);
  assert.strictEqual(resMidGrace.daysRemaining, 7);

  // Case E: Exactly at end of grace period -> valid
  const resEndGrace = verifyLicense(token, currentMachineId, { currentTime: expiryTime + graceMs });
  assert.strictEqual(resEndGrace.valid, true);
  assert.strictEqual(resEndGrace.isGracePeriod, true);

  // Case F: 1 millisecond past grace period -> EXPIRED
  const resPastGrace = verifyLicense(token, currentMachineId, { currentTime: expiryTime + graceMs + 1 });
  assert.strictEqual(resPastGrace.valid, false);
  assert(resPastGrace.error.includes('LICENSE_EXPIRED'), `Expected LICENSE_EXPIRED, got: ${resPastGrace.error}`);
});

challengerM1Suite.add('Clock Tampering: Lifetime license immunity to future clock changes', () => {
  const token = createLicenseKey({
    customer: 'Lifetime Enterprise',
    nodeLockId: currentMachineId,
    expiryDate: 'Lifetime'
  });

  const extremeFuture = Date.now() + (100 * 365 * 86400000);
  const res = verifyLicense(token, currentMachineId, { currentTime: extremeFuture });

  assert.strictEqual(res.valid, true, `Lifetime license should never expire: ${res.error}`);
  assert.strictEqual(res.isGracePeriod, false);
});

// ============================================================================
// 4. ADVERSARIAL ATTACKS ON AES-256-GCM CIPHERTEXT
// ============================================================================

challengerM1Suite.add('AES-256-GCM: Roundtrip integrity with unicode, emojis, and large payload', () => {
  const testInputs = [
    'Simple ASCII token_12345',
    'Unicode & Multilingual: 🔐 WhatsApp Suite 2026! 汉字 العربية Привет',
    'Special characters: `~!@#$%^&*()_+=-{}[]|\\:;"\'<>,.?/\n\r\t',
    'X'.repeat(64 * 1024) // 64 KB large payload
  ];

  for (const plain of testInputs) {
    const enc = encryptField(plain, currentMachineId);
    assert(enc.startsWith('enc:v1:'));
    const dec = decryptField(enc, currentMachineId);
    assert.strictEqual(dec, plain, 'Decrypted text did not match original plaintext');
  }

  // Edge cases
  assert.strictEqual(encryptField('', currentMachineId), '');
  assert.strictEqual(encryptField(null, currentMachineId), null);
  assert.strictEqual(encryptField(undefined, currentMachineId), undefined);
  assert.strictEqual(decryptField('raw_unencrypted_text', currentMachineId), 'raw_unencrypted_text');
  assert.strictEqual(decryptField(null, currentMachineId), null);
});

challengerM1Suite.add('AES-256-GCM Attack: Ciphertext byte flipping & truncation', () => {
  const secret = 'Confidential_Database_Field_Credentials_12345';
  const encrypted = encryptField(secret, currentMachineId);
  const parts = encrypted.split(':');
  const ciphertextHex = parts[5];

  // 1. Flip first byte
  const flippedFirst = (parseInt(ciphertextHex.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0') + ciphertextHex.slice(2);
  const partsFirst = [...parts];
  partsFirst[5] = flippedFirst;
  assert.throws(
    () => decryptField(partsFirst.join(':'), currentMachineId),
    /Decryption failed|unable to authenticate/i,
    'Flipping first byte of ciphertext must fail authentication'
  );

  // 2. Flip middle byte
  const midPos = Math.floor(ciphertextHex.length / 4) * 2;
  const flippedMid = ciphertextHex.slice(0, midPos) +
    (parseInt(ciphertextHex.slice(midPos, midPos + 2), 16) ^ 0xff).toString(16).padStart(2, '0') +
    ciphertextHex.slice(midPos + 2);
  const partsMid = [...parts];
  partsMid[5] = flippedMid;
  assert.throws(
    () => decryptField(partsMid.join(':'), currentMachineId),
    /Decryption failed|unable to authenticate/i,
    'Flipping middle byte of ciphertext must fail authentication'
  );

  // 3. Truncate ciphertext
  const partsTrunc = [...parts];
  partsTrunc[5] = ciphertextHex.slice(0, -2);
  assert.throws(
    () => decryptField(partsTrunc.join(':'), currentMachineId),
    /Decryption failed|unable to authenticate/i,
    'Truncating ciphertext must fail authentication'
  );
});

challengerM1Suite.add('AES-256-GCM Attack: Authentication tag zeroing, bit-flipping, and truncation', () => {
  const secret = 'Authentication_Tag_Attack_Vector';
  const encrypted = encryptField(secret, currentMachineId);
  const parts = encrypted.split(':');

  // 1. Zero out authentication tag
  const partsZeroTag = [...parts];
  partsZeroTag[4] = '00'.repeat(16);
  assert.throws(
    () => decryptField(partsZeroTag.join(':'), currentMachineId),
    /Decryption failed|unable to authenticate/i,
    'Zeroed auth tag must fail GCM verification'
  );

  // 2. Flip bit in authentication tag
  const tagHex = parts[4];
  const flippedTag = (parseInt(tagHex.slice(0, 2), 16) ^ 0x01).toString(16).padStart(2, '0') + tagHex.slice(2);
  const partsFlippedTag = [...parts];
  partsFlippedTag[4] = flippedTag;
  assert.throws(
    () => decryptField(partsFlippedTag.join(':'), currentMachineId),
    /Decryption failed|unable to authenticate/i,
    'Flipped bit in auth tag must fail GCM verification'
  );

  // 3. Truncated authentication tag (8 bytes instead of 16)
  const partsTruncTag = [...parts];
  partsTruncTag[4] = tagHex.slice(0, 16);
  assert.throws(
    () => decryptField(partsTruncTag.join(':'), currentMachineId),
    /Decryption failed|unable to authenticate|Invalid auth tag length/i,
    'Truncated auth tag must fail GCM verification'
  );
});

challengerM1Suite.add('AES-256-GCM Attack: IV/Nonce tampering & bit-flipping', () => {
  const secret = 'IV_Nonce_Tampering_Test_Target';
  const encrypted = encryptField(secret, currentMachineId);
  const parts = encrypted.split(':');
  const ivHex = parts[3];

  // 1. Bit-flip IV
  const flippedIv = (parseInt(ivHex.slice(0, 2), 16) ^ 0x01).toString(16).padStart(2, '0') + ivHex.slice(2);
  const partsFlippedIv = [...parts];
  partsFlippedIv[3] = flippedIv;
  assert.throws(
    () => decryptField(partsFlippedIv.join(':'), currentMachineId),
    /Decryption failed|unable to authenticate/i,
    'Bit-flipped IV must fail GCM authentication'
  );

  // 2. All-zeroes IV
  const partsZeroIv = [...parts];
  partsZeroIv[3] = '00'.repeat(12);
  assert.throws(
    () => decryptField(partsZeroIv.join(':'), currentMachineId),
    /Decryption failed|unable to authenticate/i,
    'All-zeroes IV must fail GCM authentication'
  );
});

challengerM1Suite.add('AES-256-GCM Attack: Salt mutation & key derivation failure', () => {
  const secret = 'Salt_Mutation_Attack_Test';
  const encrypted = encryptField(secret, currentMachineId);
  const parts = encrypted.split(':');
  const saltHex = parts[2];

  // 1. Bit-flip Salt -> changes scrypt derived key -> decipher fails tag
  const flippedSalt = (parseInt(saltHex.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0') + saltHex.slice(2);
  const partsFlippedSalt = [...parts];
  partsFlippedSalt[2] = flippedSalt;
  assert.throws(
    () => decryptField(partsFlippedSalt.join(':'), currentMachineId),
    /Decryption failed|unable to authenticate/i,
    'Salt mutation must cause scrypt key mismatch and fail authentication'
  );
});

challengerM1Suite.add('AES-256-GCM Attack: Structural format mutations & version tampering', () => {
  const secret = 'Structural_Format_Mutation_Test';
  const encrypted = encryptField(secret, currentMachineId);
  const parts = encrypted.split(':');

  // 1. Unsupported version
  const partsV2 = [...parts];
  partsV2[1] = 'v2';
  assert.throws(
    () => decryptField(partsV2.join(':'), currentMachineId),
    /Unsupported encryption version: v2/,
    'Version v2 must be rejected'
  );

  // 2. Truncated parts (5 parts instead of 6)
  const parts5 = parts.slice(0, 5);
  assert.throws(
    () => decryptField(parts5.join(':'), currentMachineId),
    /Invalid encrypted field format. Expected 6 colon-separated parts./,
    '5 parts format must be rejected'
  );

  // 3. Extra parts (7 parts instead of 6)
  const parts7 = [...parts, 'extra_junk'];
  assert.throws(
    () => decryptField(parts7.join(':'), currentMachineId),
    /Invalid encrypted field format. Expected 6 colon-separated parts./,
    '7 parts format must be rejected'
  );

  // 4. Non-hex characters in salt
  const partsNonHex = [...parts];
  partsNonHex[2] = 'ZZ'.repeat(16);
  assert.throws(
    () => decryptField(partsNonHex.join(':'), currentMachineId),
    /Decryption failed|unable to authenticate/i,
    'Non-hex characters in salt must fail'
  );
});

challengerM1Suite.add('AES-256-GCM Attack: Exhaustive authentication tag truncation & byte length boundary matrix', () => {
  const secret = 'Auth_Tag_Byte_Length_Boundary_Test';
  const encrypted = encryptField(secret, currentMachineId);
  const parts = encrypted.split(':');
  const validTagHex = parts[4]; // 32 hex chars (16 bytes)

  const testLengths = [
    { bytes: 0, hex: '' },
    { bytes: 4, hex: validTagHex.slice(0, 8) },
    { bytes: 8, hex: validTagHex.slice(0, 16) }, // Node.js DEP0182 trigger test
    { bytes: 12, hex: validTagHex.slice(0, 24) },
    { bytes: 15, hex: validTagHex.slice(0, 30) },
    { bytes: 17, hex: validTagHex + 'aa' },
    { bytes: 32, hex: validTagHex.repeat(2) }
  ];

  for (const item of testLengths) {
    const mutatedParts = [...parts];
    mutatedParts[4] = item.hex;
    const mutatedStr = mutatedParts.join(':');

    assert.throws(
      () => decryptField(mutatedStr, currentMachineId),
      /Invalid authentication tag length|Decryption failed|unable to authenticate/i,
      `Tag length ${item.bytes} bytes (${item.hex.length} hex chars) must be rejected`
    );
  }
});

challengerM1Suite.add('AES-256-GCM Attack: Salt & IV length validation assertions', () => {
  const secret = 'Salt_IV_Length_Validation_Test';
  const encrypted = encryptField(secret, currentMachineId);
  const parts = encrypted.split(':');

  // Invalid Salt lengths (expected 16 bytes = 32 hex chars)
  const invalidSalts = ['', 'aabbcc', '00'.repeat(8), '00'.repeat(15), '00'.repeat(17), '00'.repeat(32)];
  for (const saltHex of invalidSalts) {
    const mutated = [...parts];
    mutated[2] = saltHex;
    assert.throws(
      () => decryptField(mutated.join(':'), currentMachineId),
      /Invalid salt length|Decryption failed|unable to authenticate/i,
      `Salt hex length ${saltHex.length} must be rejected`
    );
  }

  // Invalid IV lengths (expected 12 bytes = 24 hex chars)
  const invalidIVs = ['', 'aabb', '00'.repeat(8), '00'.repeat(11), '00'.repeat(13), '00'.repeat(16)];
  for (const ivHex of invalidIVs) {
    const mutated = [...parts];
    mutated[3] = ivHex;
    assert.throws(
      () => decryptField(mutated.join(':'), currentMachineId),
      /Invalid IV length|Decryption failed|unable to authenticate/i,
      `IV hex length ${ivHex.length} must be rejected`
    );
  }
});

challengerM1Suite.add('AES-256-GCM Attack: Exhaustive version tampering matrix (v0, v2, v1.1, v999, invalid)', () => {
  const secret = 'Version_Tampering_Matrix_Secret';
  const encrypted = encryptField(secret, currentMachineId);
  const parts = encrypted.split(':');

  const invalidVersions = ['v0', 'v2', 'v1.1', 'v999', '2', 'v3', 'beta', '', ' '];
  for (const ver of invalidVersions) {
    const mutated = [...parts];
    mutated[1] = ver;
    assert.throws(
      () => decryptField(mutated.join(':'), currentMachineId),
      /Unsupported encryption version/,
      `Version '${ver}' must throw Unsupported encryption version`
    );
  }
});

challengerM1Suite.add('AES-256-GCM: Hardware node-lock cross-machine decryption isolation', () => {
  const secret = 'Hardware_Bound_Secret_Payload_9988';
  const encrypted = encryptField(secret, currentMachineId);

  const foreignMachines = [
    'WA-WIN-0000-0000-0000-0000',
    'WA-WIN-FFFF-FFFF-FFFF-FFFF',
    'WA-WIN-1234-5678-9ABC-DEF0',
    'WA-WIN-DEAD-BEEF-CAFE-1234'
  ];

  for (const foreignId of foreignMachines) {
    assert.throws(
      () => decryptField(encrypted, foreignId),
      /Decryption failed|unable to authenticate/i,
      `Decryption on foreign machine '${foreignId}' must fail authentication`
    );
  }
});

// ============================================================================
// 5. LICENSING EXPRESS REST API ROUTES ADVERSARIAL FUZZING
// ============================================================================

challengerM1Suite.add('Licensing Routes: Malformed & adversarial payload fuzzing on REST endpoints', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', licenseRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  async function callApi(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: options.body !== undefined ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  try {
    // 1. GET /api/license/machine-id
    const resId = await callApi('/api/license/machine-id');
    assert.strictEqual(resId.status, 200);
    assert.strictEqual(resId.json.success, true);
    assert.strictEqual(resId.json.machineId, currentMachineId);

    // 2. GET /api/license/status
    const resStatus = await callApi('/api/license/status');
    assert.strictEqual(resStatus.status, 200);
    assert.strictEqual(resStatus.json.success, true);
    assert.strictEqual(resStatus.json.machineId, currentMachineId);

    // 3. POST /api/license/activate - Malformed inputs
    const fuzzPayloads = [
      { label: 'Empty body object {}', body: {}, expectedStatus: 400 },
      { label: 'Empty string key', body: { licenseKey: '' }, expectedStatus: 400 },
      { label: 'Whitespace key', body: { licenseKey: '   ' }, expectedStatus: 400 },
      { label: 'Null key', body: { licenseKey: null }, expectedStatus: 400 },
      { label: 'Numeric key', body: { licenseKey: 12345 }, expectedStatus: 400 },
      { label: 'Boolean key', body: { licenseKey: true }, expectedStatus: 400 },
      { label: 'Array key', body: { licenseKey: ['WALIC.foo.bar'] }, expectedStatus: 400 },
      { label: 'Nested object key', body: { licenseKey: { nested: 'token' } }, expectedStatus: 400 },
      { label: 'SQL Injection payload', body: { licenseKey: "WALIC.' OR '1'='1; DROP TABLE settings;--" }, expectedStatus: 400 },
      { label: 'XSS HTML injection', body: { licenseKey: "<script>alert('pwned')</script>" }, expectedStatus: 400 },
      { label: 'Forged tampered signature token', body: { licenseKey: createTamperedLicense({ customer: 'Attacker' }) }, expectedStatus: 400 },
      { label: 'Foreign node-lock token', body: { licenseKey: createLicenseKey({ customer: 'Foreign', nodeLockId: 'WA-WIN-9999-8888-7777-6666' }) }, expectedStatus: 400 },
      { label: 'Expired license token', body: { licenseKey: createExpiredLicense({ customer: 'Expired' }) }, expectedStatus: 400 },
      { label: 'Legacy WA-PRO prefix bypass attempt', body: { licenseKey: 'WA-PRO-TEST-9999-8888' }, expectedStatus: 400 },
      { label: 'Legacy WA-ENT prefix bypass attempt', body: { licenseKey: 'WA-ENT-ENTERPRISE-1234' }, expectedStatus: 400 }
    ];

    for (const item of fuzzPayloads) {
      const res = await callApi('/api/license/activate', { method: 'POST', body: item.body });
      assert.strictEqual(
        res.status,
        item.expectedStatus,
        `Fuzz test [${item.label}] expected HTTP ${item.expectedStatus}, got ${res.status}: ${JSON.stringify(res.json)}`
      );
      assert.strictEqual(res.json.success, false, `Fuzz test [${item.label}] should have success: false`);
    }

    // 4. POST /api/license/activate - Valid Key Activation
    const validActivationKey = createLicenseKey({
      customer: 'Commercial QA Enterprise',
      licenseType: 'Pro Desktop',
      nodeLockId: currentMachineId
    });

    const resValid = await callApi('/api/license/activate', {
      method: 'POST',
      body: { licenseKey: validActivationKey }
    });

    assert.strictEqual(resValid.status, 200, `Valid activation failed: ${JSON.stringify(resValid.json)}`);
    assert.strictEqual(resValid.json.success, true);
    assert.strictEqual(resValid.json.activated, true);
    assert.strictEqual(resValid.json.machineId, currentMachineId);
    assert.strictEqual(resValid.json.license.customer, 'Commercial QA Enterprise');

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

challengerM1Suite.add('Licensing Routes: Undefined / non-JSON / zero-header HTTP body stress on /api/license/activate', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', licenseRoutes);
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large' || err.status === 413) {
      return res.status(413).json({ error: 'Payload too large' });
    }
    res.status(err.status || 500).json({ error: err.message });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Raw request without Content-Type header and without body
    const resNoBody = await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST'
    });
    assert.strictEqual(resNoBody.status, 400, `Expected 400 for empty POST, got ${resNoBody.status}`);
    const jsonNoBody = await resNoBody.json();
    assert.strictEqual(jsonNoBody.success, false);
    assert.strictEqual(jsonNoBody.error, 'License key is required.');

    // 2. Content-Type: text/plain with raw non-JSON text
    const resText = await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'plain string key'
    });
    assert.strictEqual(resText.status, 400);
    const jsonText = await resText.json();
    assert.strictEqual(jsonText.success, false);
    assert.strictEqual(jsonText.error, 'License key is required.');

    // 3. Content-Type: application/x-www-form-urlencoded
    const resForm = await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'licenseKey=WALIC.fake.token'
    });
    assert.strictEqual(resForm.status, 400);

    // 4. Large 40KB key payload test (within body-parser 100kb limit) -> 400 Invalid format
    const resLargeKey = await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: 'WALIC.' + 'A'.repeat(40 * 1024) + '.sig' })
    });
    assert.strictEqual(resLargeKey.status, 400);
    const jsonLargeKey = await resLargeKey.json();
    assert.strictEqual(jsonLargeKey.success, false);

    // 5. Oversized 1MB payload (exceeds default Express 100kb limit) -> 413 Payload Too Large
    const resOversized = await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: 'WALIC.' + 'A'.repeat(1024 * 1024) + '.sig' })
    });
    assert.strictEqual(resOversized.status, 413, `Expected 413 for 1MB payload, got ${resOversized.status}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

challengerM1Suite.add('Licensing Routes: High-throughput concurrent fuzzing under stress load', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', licenseRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const validToken = createLicenseKey({
    customer: 'Concurrent Load Test Corp',
    licenseType: 'Pro Desktop',
    nodeLockId: currentMachineId
  });

  try {
    const concurrentRequests = Array.from({ length: 60 }, (_, idx) => {
      if (idx % 3 === 0) {
        // Valid activation
        return fetch(`${baseUrl}/api/license/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licenseKey: validToken })
        }).then(r => r.json().then(j => ({ idx, status: r.status, ok: r.status === 200 && j.success === true })));
      } else if (idx % 3 === 1) {
        // Malformed body
        return fetch(`${baseUrl}/api/license/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invalidField: 12345 })
        }).then(r => r.json().then(j => ({ idx, status: r.status, ok: r.status === 400 && j.success === false })));
      } else {
        // Forged prefix key
        return fetch(`${baseUrl}/api/license/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licenseKey: `WA-PRO-CRACKED-${idx}` })
        }).then(r => r.json().then(j => ({ idx, status: r.status, ok: r.status === 400 && j.success === false })));
      }
    });

    const results = await Promise.all(concurrentRequests);
    assert.strictEqual(results.length, 60);
    for (const r of results) {
      assert.strictEqual(r.ok, true, `Concurrent request ${r.idx} failed with status ${r.status}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Self-executing harness support
if (process.argv[1] && process.argv[1].includes('m1_challenger_adversarial.test.js')) {
  challengerM1Suite.run().then(res => {
    if (res.failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }).catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}

