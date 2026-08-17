import db, { run, get, all } from './database.js';
import {
  parseSpintax,
  checkWarmupStatus,
  incrementDailySendCount,
  calculateHealthScore,
  calculateSmartDelayMs,
  isNumberBlacklisted,
  addNumberToBlacklist
} from './services/antiBanService.js';

async function runChallengerHarness() {
  console.log('====================================================');
  console.log('   CHALLENGER EMPIRICAL HARNESS FOR MILESTONE 1');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;
  const findings = [];

  function test(name, condition, detail) {
    if (condition) {
      passed++;
      console.log(`✅ [PASS] ${name}`);
    } else {
      failed++;
      findings.push({ name, detail });
      console.error(`❌ [FAIL] ${name} - ${detail}`);
    }
  }

  // --- 1. SPINTAX ENGINE EXTENDED STRESS ---
  console.log('\n--- 1. Spintax Engine Extended Stress ---');
  
  // 1.1: 150 tags in a single message
  const tags150 = Array.from({ length: 150 }, (_, i) => `{opt_${i}_A|opt_${i}_B|opt_${i}_C}`).join(' ');
  const parsed150 = parseSpintax(tags150, { enableSpintax: true });
  const unparsed150Match = /\{[^{}]+\}/.test(parsed150);
  test('150 Parallel Spintax Tags', !unparsed150Match, unparsed150Match ? `Unparsed tags remained: ${parsed150.slice(0, 100)}` : 'Parsed all 150 tags cleanly.');

  // 1.2: 50-level deep nesting
  let nest50 = 'core_val';
  for (let i = 50; i >= 1; i--) {
    nest50 = `{level_${i}|${nest50}}`;
  }
  const parsedNest50 = parseSpintax(nest50, { enableSpintax: true });
  const hasBrackets50 = /[\{\}]/.test(parsedNest50);
  test('50-Level Deep Spintax Nesting', !hasBrackets50, hasBrackets50 ? `Output contains unparsed brackets: ${parsedNest50}` : `Successfully unrolled 50 levels: ${parsedNest50}`);

  // 1.3: Combination of 50 parallel tags with 5 nested tags each
  let comboInput = [];
  for (let i = 0; i < 50; i++) {
    comboInput.push(`{head_${i}|{mid_${i}_1|{deep_${i}|leaf_${i}}}}`);
  }
  const parsedCombo = parseSpintax(comboInput.join(' '), { enableSpintax: true });
  const hasComboBrackets = /[\{\}]/.test(parsedCombo);
  test('50 Parallel x 4-Level Nested Spintax', !hasComboBrackets, hasComboBrackets ? `Brackets remaining: ${parsedCombo.slice(0, 100)}` : 'Cleanly resolved complex combo.');

  // 1.4: Auto-Emoji test
  const emojiParsed = parseSpintax('Hello world', { enableSpintax: true, enableAutoEmoji: true });
  const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(emojiParsed);
  test('Auto Emoji Appended', hasEmoji, `Output: ${emojiParsed}`);

  // --- 2. COUNTRY-AWARE BLACKLIST LOOKUP & INTERNATIONAL NUMBERS ---
  console.log('\n--- 2. Country-Aware Blacklist Lookups Across International Formats ---');

  const testUserA = 7001;
  const testUserB = 7002;
  await run('DELETE FROM users WHERE id IN (?, ?)', [testUserA, testUserB]);
  await run('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [testUserA, 'Challenger A', 'chA@test.com', 'h']);
  await run('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [testUserB, 'Challenger B', 'chB@test.com', 'h']);
  await run('DELETE FROM blacklisted_numbers WHERE user_id IN (?, ?)', [testUserA, testUserB]);

  // Seed User A with Indian number 9876543210 (stored as clean 919876543210)
  await addNumberToBlacklist(testUserA, '+91 98765 43210', 'Opt-out India');
  // Seed User B with US number 19876543210
  await addNumberToBlacklist(testUserB, '+1 (987) 654-3210', 'Opt-out US');

  // Test User A queries
  const isBl_A_E164 = await isNumberBlacklisted(testUserA, '+919876543210');
  const isBl_A_Local = await isNumberBlacklisted(testUserA, '9876543210');
  const isBl_A_US = await isNumberBlacklisted(testUserA, '+19876543210'); // US prefix 1 vs Indian 91
  const isBl_A_UK = await isNumberBlacklisted(testUserA, '+449876543210'); // UK prefix 44 vs Indian 91

  test('User A Indian E.164 Matched', isBl_A_E164 === true, `Expected true, got ${isBl_A_E164}`);
  test('User A Indian Local 10-digit Matched', isBl_A_Local === true, `Expected true, got ${isBl_A_Local}`);
  test('User A Cross-Country US Number NOT Matched', isBl_A_US === false, `Expected false for +19876543210, got ${isBl_A_US}`);
  test('User A Cross-Country UK Number NOT Matched', isBl_A_UK === false, `Expected false for +449876543210, got ${isBl_A_UK}`);

  // Test User B queries (US number +19876543210)
  const isBl_B_US = await isNumberBlacklisted(testUserB, '+19876543210');
  const isBl_B_India = await isNumberBlacklisted(testUserB, '+919876543210');

  test('User B US Number Matched', isBl_B_US === true, `Expected true for +19876543210, got ${isBl_B_US}`);
  test('User B Cross-Country India Number NOT Matched', isBl_B_India === false, `Expected false for +919876543210, got ${isBl_B_India}`);

  // Multi-tenant isolation test: User A querying User B's number
  const isBl_A_Querying_B = await isNumberBlacklisted(testUserA, '+19876543210');
  test('Multi-Tenant Isolation (User A does not see User B blacklist)', isBl_A_Querying_B === false, `Expected false, got ${isBl_A_Querying_B}`);

  // Formatting variants
  await addNumberToBlacklist(testUserA, '+44 7911 123456', 'Opt-out UK');
  const ukCheck1 = await isNumberBlacklisted(testUserA, '+44-7911-123456');
  const ukCheck2 = await isNumberBlacklisted(testUserA, '447911123456');
  test('UK Number Formatting Variants', ukCheck1 && ukCheck2, `ukCheck1=${ukCheck1}, ukCheck2=${ukCheck2}`);

  // Short / invalid inputs
  const shortCheck = await isNumberBlacklisted(testUserA, '1234');
  test('Short Number Safeguard (< 5 digits)', shortCheck === false, `Expected false, got ${shortCheck}`);

  // Cleanup
  await run('DELETE FROM blacklisted_numbers WHERE user_id IN (?, ?)', [testUserA, testUserB]);

  // --- 3. NULL SETTINGS & DEFENSIVE PARAMETER SAFETY ---
  console.log('\n--- 3. Null Settings & Defensive Parameter Safety ---');

  let nullWarmup, nullHealth, nullDelay, nullNight, nullSpintax;

  try {
    nullWarmup = await checkWarmupStatus(testUserA, null);
    test('checkWarmupStatus(null) Null Safety', nullWarmup && typeof nullWarmup === 'object', 'Returned valid object when null settings passed.');
  } catch (e) {
    test('checkWarmupStatus(null) Null Safety', false, `Threw error: ${e.message}`);
  }

  try {
    nullHealth = await calculateHealthScore(testUserA, null);
    test('calculateHealthScore(null) Null Safety', nullHealth && nullHealth.success === true, 'Returned success response with null settings.');
  } catch (e) {
    test('calculateHealthScore(null) Null Safety', false, `Threw error: ${e.message}`);
  }

  try {
    nullDelay = calculateSmartDelayMs(null, 5);
    test('calculateSmartDelayMs(null) Null Safety', nullDelay && typeof nullDelay.delayMs === 'number', `Returned delayMs=${nullDelay?.delayMs}`);
  } catch (e) {
    test('calculateSmartDelayMs(null) Null Safety', false, `Threw error: ${e.message}`);
  }

  try {
    nullSpintax = parseSpintax('{A|B}', null);
    test('parseSpintax(text, null) Null Safety', nullSpintax === 'A' || nullSpintax === 'B', `Returned parsed spintax: ${nullSpintax}`);
  } catch (e) {
    test('parseSpintax(text, null) Null Safety', false, `Threw error: ${e.message}`);
  }

  // --- 4. DATABASE INTEGRITY & SCHEMAS ---
  console.log('\n--- 4. Database Schema & Composite Primary Key Verification ---');

  // Verify settings table composite key (user_id, key)
  try {
    await run('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)', [101, 'daily_limit', '30']);
    await run('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)', [102, 'daily_limit', '60']);

    const s101 = await get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [101, 'daily_limit']);
    const s102 = await get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [102, 'daily_limit']);

    const compositeOk = s101?.value === '30' && s102?.value === '60';
    test('Settings Composite Primary Key (user_id, key) Isolation', compositeOk, `User 101: ${s101?.value}, User 102: ${s102?.value}`);

    await run('DELETE FROM settings WHERE user_id IN (101, 102)');
  } catch (e) {
    test('Settings Composite Primary Key (user_id, key) Isolation', false, `Failed: ${e.message}`);
  }

  // Cleanup test users
  await run('DELETE FROM users WHERE id IN (?, ?)', [testUserA, testUserB]);

  // --- HARNESS SUMMARY ---
  console.log('\n====================================================');
  console.log(`CHALLENGER STRESS HARNESS COMPLETE`);
  console.log(`Passed: ${passed} | Failed: ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    console.error('CHALLENGE FINDINGS:', JSON.stringify(findings, null, 2));
    process.exitCode = 1;
  }
}

runChallengerHarness().catch(err => {
  console.error('Fatal error during challenger harness:', err);
  process.exitCode = 1;
});
