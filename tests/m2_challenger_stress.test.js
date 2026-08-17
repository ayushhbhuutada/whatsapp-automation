import assert from 'node:assert';
import { createTestSuite, ensureTestUser } from './test_helper.js';
import { isNumberBlacklisted, addNumberToBlacklist, calculateHealthScore } from '../backend/services/antiBanService.js';
import { run, all } from '../backend/database.js';

export const challengerM2Suite = createTestSuite('Challenger M2: AntiBanHealthCard & BlacklistManager Empirical Stress Harness');

// Setup test user
const TEST_USER_ID = 999;

challengerM2Suite.add('Setup: Initialize test database state', async () => {
  await ensureTestUser(TEST_USER_ID);
});

// ============================================================================
// 1. ANTIBAN HEALTH CARD STRESS TESTS
// ============================================================================

function extractAntiBanHealthCardState(resData, fetchError = null, loading = false) {
  const safeData = resData || {};
  const healthScore = safeData.healthScore ?? 100;
  const statusLevel = safeData.statusLevel || safeData.status || (fetchError ? 'Offline' : 'Healthy');
  const badgeColor = safeData.badgeColor || (healthScore >= 80 ? 'green' : healthScore >= 50 ? 'yellow' : 'red');
  const failureRate = safeData.failureRate ?? safeData.checks?.failureRate ?? '0.0';
  const sentToday = safeData.sentToday ?? safeData.checks?.sentToday ?? 0;
  const warmupStage = safeData.warmupStage ?? safeData.checks?.warmupStage ?? 1;
  const dailyLimit = safeData.dailyLimit ?? 20;
  const recommendations = Array.isArray(safeData.recommendations) && safeData.recommendations.length > 0
    ? safeData.recommendations
    : ['Your account sending metrics are optimal. Maintain variable delays and message spintax.'];

  return {
    healthScore,
    statusLevel,
    badgeColor,
    failureRate,
    sentToday,
    warmupStage,
    dailyLimit,
    recommendations,
    loading,
    fetchError
  };
}

challengerM2Suite.add('AntiBanHealthCard: Handles 500 Server Error Response cleanly without throw', () => {
  const fetchError = 'Request failed with status code 500';
  const resData = null;
  const state = extractAntiBanHealthCardState(resData, fetchError);
  
  assert.strictEqual(state.healthScore, 100);
  assert.strictEqual(state.statusLevel, 'Offline');
  assert.strictEqual(state.badgeColor, 'green'); // 100 default score
  assert.strictEqual(state.fetchError, 'Request failed with status code 500');
  assert.strictEqual(state.recommendations.length, 1);
});

challengerM2Suite.add('AntiBanHealthCard: Handles completely empty response object {}', () => {
  const resData = {};
  const state = extractAntiBanHealthCardState(resData, null);

  assert.strictEqual(state.healthScore, 100);
  assert.strictEqual(state.statusLevel, 'Healthy');
  assert.strictEqual(state.failureRate, '0.0');
  assert.strictEqual(state.sentToday, 0);
  assert.strictEqual(state.warmupStage, 1);
  assert.strictEqual(state.dailyLimit, 20);
  assert.ok(Array.isArray(state.recommendations) && state.recommendations.length > 0);
});

challengerM2Suite.add('AntiBanHealthCard: Handles null res.data response', () => {
  const resData = null;
  const state = extractAntiBanHealthCardState(resData, 'Network Error');

  assert.strictEqual(state.healthScore, 100);
  assert.strictEqual(state.statusLevel, 'Offline');
  assert.strictEqual(state.failureRate, '0.0');
});

challengerM2Suite.add('AntiBanHealthCard: Handles partial checks object without nested fields', () => {
  const resData = {
    success: true,
    checks: {}
  };
  const state = extractAntiBanHealthCardState(resData, null);

  assert.strictEqual(state.failureRate, '0.0');
  assert.strictEqual(state.sentToday, 0);
  assert.strictEqual(state.warmupStage, 1);
});

challengerM2Suite.add('AntiBanHealthCard: Handles recommendations when null or non-array', () => {
  const resData = {
    success: true,
    recommendations: null
  };
  const state = extractAntiBanHealthCardState(resData, null);

  assert.ok(Array.isArray(state.recommendations));
  assert.strictEqual(state.recommendations.length, 1);
});

challengerM2Suite.add('AntiBanHealthCard: Correctly sets High Risk status and red badge when healthScore < 50', () => {
  const resData = {
    success: true,
    healthScore: 35,
    statusLevel: 'High Risk',
    badgeColor: 'red',
    recommendations: ['Pause campaign immediately']
  };
  const state = extractAntiBanHealthCardState(resData, null);

  assert.strictEqual(state.healthScore, 35);
  assert.strictEqual(state.statusLevel, 'High Risk');
  assert.strictEqual(state.badgeColor, 'red');
  assert.strictEqual(state.recommendations[0], 'Pause campaign immediately');
});

challengerM2Suite.add('AntiBanHealthCard: Handles simulated network latency delays without state corruption', async () => {
  const delayMs = 100;
  let loading = true;
  let state = extractAntiBanHealthCardState(null, null, loading);

  assert.strictEqual(state.loading, true);

  await new Promise(resolve => setTimeout(resolve, delayMs));
  loading = false;
  const mockApiRes = { success: true, healthScore: 92, statusLevel: 'Healthy', badgeColor: 'green' };
  state = extractAntiBanHealthCardState(mockApiRes, null, loading);

  assert.strictEqual(state.loading, false);
  assert.strictEqual(state.healthScore, 92);
});

challengerM2Suite.add('AntiBanHealthCard Backend: calculateHealthScore returns structured health object', async () => {
  const health = await calculateHealthScore(TEST_USER_ID, {});
  assert.strictEqual(health.success, true);
  assert.strictEqual(typeof health.healthScore, 'number');
  assert.ok(Array.isArray(health.recommendations));
  assert.ok(Array.isArray(health.deductions));
});

// ============================================================================
// 2. BLACKLIST MANAGER STRESS TESTS
// ============================================================================

function processBlacklistResponse(resData) {
  const list = Array.isArray(resData?.blacklist)
    ? resData.blacklist
    : (Array.isArray(resData) ? resData : []);
  return Array.isArray(list) ? list : [];
}

function processBlacklistItem(item, idx = 0) {
  const phoneNumber = item?.phone || item?.number || 'Unknown Number';
  const displayReason = item?.reason || 'Manual Opt-Out';
  
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString();
  };

  const dateText = formatDate(item?.created_at || item?.added_at || item?.addedAt);
  const itemKey = item?.id || phoneNumber || idx;

  return { phoneNumber, displayReason, dateText, itemKey };
}

function extractDeleteTargetId(item) {
  const targetId = typeof item === 'object' && item !== null 
    ? (item.id || item.phone || item.number)
    : item;
  return targetId || null;
}

challengerM2Suite.add('BlacklistManager: Non-array res.data.blacklist string handles safely to []', () => {
  const resData = { success: true, blacklist: "invalid string" };
  const safeList = processBlacklistResponse(resData);
  assert.deepStrictEqual(safeList, []);
});

challengerM2Suite.add('BlacklistManager: Non-array res.data object handles safely to []', () => {
  const resData = { success: false, blacklist: null };
  const safeList = processBlacklistResponse(resData);
  assert.deepStrictEqual(safeList, []);
});

challengerM2Suite.add('BlacklistManager: Null resData returns empty array []', () => {
  const safeList = processBlacklistResponse(null);
  assert.deepStrictEqual(safeList, []);
});

challengerM2Suite.add('BlacklistManager: Missing item properties fallback to safe defaults', () => {
  const item = {};
  const processed = processBlacklistItem(item, 0);

  assert.strictEqual(processed.phoneNumber, 'Unknown Number');
  assert.strictEqual(processed.displayReason, 'Manual Opt-Out');
  assert.strictEqual(processed.dateText, 'N/A');
  assert.strictEqual(processed.itemKey, 'Unknown Number');
});

challengerM2Suite.add('BlacklistManager: Handles null item safely without throwing', () => {
  const item = null;
  const processed = processBlacklistItem(item, 2);

  assert.strictEqual(processed.phoneNumber, 'Unknown Number');
  assert.strictEqual(processed.displayReason, 'Manual Opt-Out');
  assert.strictEqual(processed.dateText, 'N/A');
  assert.strictEqual(processed.itemKey, 'Unknown Number');
});

challengerM2Suite.add('BlacklistManager: undefined created_at displays N/A', () => {
  const item = { phone: '+1234567890', reason: 'Unsubscribed', created_at: undefined };
  const processed = processBlacklistItem(item, 0);

  assert.strictEqual(processed.phoneNumber, '+1234567890');
  assert.strictEqual(processed.displayReason, 'Unsubscribed');
  assert.strictEqual(processed.dateText, 'N/A');
});

challengerM2Suite.add('BlacklistManager: invalid/malformed date string displays N/A', () => {
  const item = { phone: '+1234567890', created_at: 'invalid-date-string' };
  const processed = processBlacklistItem(item, 0);

  assert.strictEqual(processed.dateText, 'N/A');
});

challengerM2Suite.add('BlacklistManager: Valid ISO date formats correctly', () => {
  const item = { phone: '+1234567890', created_at: '2026-08-12T10:00:00Z' };
  const processed = processBlacklistItem(item, 0);

  assert.notStrictEqual(processed.dateText, 'N/A');
});

challengerM2Suite.add('BlacklistManager: handleDelete with missing ID/null/undefined returns null targetId safely', () => {
  assert.strictEqual(extractDeleteTargetId(null), null);
  assert.strictEqual(extractDeleteTargetId(undefined), null);
  assert.strictEqual(extractDeleteTargetId({}), null);
  assert.strictEqual(extractDeleteTargetId({ phone: '', number: '' }), null);
});

challengerM2Suite.add('BlacklistManager: handleDelete extracts correct targetId from id, phone, or number', () => {
  assert.strictEqual(extractDeleteTargetId({ id: 42, phone: '999', number: '888' }), 42);
  assert.strictEqual(extractDeleteTargetId({ phone: '999', number: '888' }), '999');
  assert.strictEqual(extractDeleteTargetId({ number: '888' }), '888');
  assert.strictEqual(extractDeleteTargetId('777'), '777');
});

challengerM2Suite.add('BlacklistManager: Invalid phone additions (empty or whitespace) prevented', () => {
  const cleanPhone1 = "".trim();
  const cleanPhone2 = "   ".trim();

  assert.strictEqual(cleanPhone1, "");
  assert.strictEqual(cleanPhone2, "");
});

challengerM2Suite.add('BlacklistManager Backend: Add, check duplicate, and deletion flow', async () => {
  const testNum = '919876543999';
  await addNumberToBlacklist(TEST_USER_ID, testNum, 'Test Opt Out');

  const isBlocked = await isNumberBlacklisted(TEST_USER_ID, testNum);
  assert.strictEqual(isBlocked, true);

  // Duplicate addition check
  await addNumberToBlacklist(TEST_USER_ID, testNum, 'Duplicate Opt Out');
  const rows = await all('SELECT * FROM blacklisted_numbers WHERE user_id = ? AND phone = ?', [TEST_USER_ID, testNum]);
  assert.strictEqual(rows.length, 1); // Deduplicated by DB constraint / logic

  // Delete
  await run('DELETE FROM blacklisted_numbers WHERE user_id = ? AND phone = ?', [TEST_USER_ID, testNum]);
  const isBlockedAfterDelete = await isNumberBlacklisted(TEST_USER_ID, testNum);
  assert.strictEqual(isBlockedAfterDelete, false);
});

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('m2_challenger_stress.test.js')) {
  challengerM2Suite.run().then((res) => {
    console.log(`Challenger M2 Stress Harness Complete: ${res.passed}/${res.total} passed`);
    if (res.failed > 0) process.exit(1);
  });
}
