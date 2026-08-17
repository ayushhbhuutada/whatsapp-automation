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

async function runStressTests() {
  console.log('====================================================');
  console.log('   EMPIRICAL STRESS TEST SUITE: MILESTONE 1');
  console.log('   antiBanService.js & database.js Verification');
  console.log('====================================================\n');

  const results = {
    spintax: { passed: 0, failed: 0, details: [] },
    warmup: { passed: 0, failed: 0, details: [] },
    blacklist: { passed: 0, failed: 0, details: [] },
    healthScore: { passed: 0, failed: 0, details: [] },
    edgeCases: { passed: 0, failed: 0, details: [] }
  };

  // Helper logging
  function assertTest(category, name, condition, message) {
    if (condition) {
      results[category].passed++;
      results[category].details.push({ name, status: 'PASS', message });
      console.log(`  [PASS] ${name}`);
    } else {
      results[category].failed++;
      results[category].details.push({ name, status: 'FAIL', message });
      console.log(`  [FAIL] ${name} -> ${message}`);
    }
  }

  // =========================================================================
  // GROUP 1: SPINTAX PARSER ENGINE STRESS TESTS
  // =========================================================================
  console.log('--- Group 1: Spintax Parser Engine Stress Tests ---');

  // Test 1.1: 100 Multi-Choice Variations in a single template
  const choices100 = [];
  for (let i = 0; i < 100; i++) {
    choices100.push(`{tag${i}_optA|tag${i}_optB|tag${i}_optC}`);
  }
  const spintax100Input = choices100.join(' ');
  const spintax100Output = parseSpintax(spintax100Input, { enableSpintax: true });
  const hasRemainingBrackets100 = /\{[^{}]+\}/.test(spintax100Output);
  
  assertTest(
    'spintax',
    'Spintax 100 Multi-Choice Variations Test',
    !hasRemainingBrackets100,
    hasRemainingBrackets100 
      ? `Failed: Unparsed spintax tags remain in output. Max iterations loop limit hit! Sample unparsed: ${spintax100Output.substring(0, 100)}...` 
      : 'All 100 spintax tags parsed cleanly.'
  );

  // Test 1.2: Deeply Nested Spintax (10 levels deep)
  let nestedInput = 'base';
  for (let i = 10; i >= 1; i--) {
    nestedInput = `{level${i}_A|${nestedInput}}`;
  }
  const nestedOutput = parseSpintax(nestedInput, { enableSpintax: true });
  const hasNestedBrackets = /\{|\}/.test(nestedOutput);
  assertTest(
    'spintax',
    'Spintax 10-Level Deep Nesting Test',
    !hasNestedBrackets,
    hasNestedBrackets ? `Failed: Output contains brackets: "${nestedOutput}"` : `Parsed nested output: "${nestedOutput}"`
  );

  // Test 1.3: Deeply Nested Spintax (25 levels deep - checking maxIterations limit)
  let deep25Input = 'core';
  for (let i = 25; i >= 1; i--) {
    deep25Input = `{nest${i}|${deep25Input}}`;
  }
  const deep25Output = parseSpintax(deep25Input, { enableSpintax: true });
  const hasDeep25Brackets = /\{|\}/.test(deep25Output);
  assertTest(
    'spintax',
    'Spintax 25-Level Deep Nesting Test',
    !hasDeep25Brackets,
    hasDeep25Brackets ? `Failed: Output contains brackets: "${deep25Output}"` : 'Parsed 25-level nested spintax.'
  );

  // Test 1.4: Performance & Infinite Loop Check (1,000 runs)
  const startTime = Date.now();
  let loopCount = 0;
  for (let i = 0; i < 1000; i++) {
    const res = parseSpintax('{Hello|Hi|Hey} {dear|valued} {customer|client|friend}!', { enableSpintax: true });
    if (res) loopCount++;
  }
  const elapsedMs = Date.now() - startTime;
  assertTest(
    'spintax',
    'Spintax Performance & Infinite Loop Harness (1000 iterations)',
    loopCount === 1000 && elapsedMs < 2000,
    `Completed 1000 iterations in ${elapsedMs}ms.`
  );

  // Test 1.5: Edge cases & malformed spintax
  const emptyRes = parseSpintax('', { enableSpintax: true });
  const nullRes = parseSpintax(null, { enableSpintax: true });
  const numberRes = parseSpintax(12345, { enableSpintax: true });
  const unclosedRes = parseSpintax('Hello {friend|user', { enableSpintax: true });
  assertTest(
    'spintax',
    'Spintax Edge Cases (null/empty/unclosed)',
    emptyRes === '' && nullRes === null && numberRes === 12345 && unclosedRes === 'Hello {friend|user',
    'Spintax handles invalid/unclosed inputs without throwing exceptions.'
  );

  console.log('');

  // =========================================================================
  // GROUP 2: WARMUP DATE STATUS & FORMAT STRESS TESTS
  // =========================================================================
  console.log('--- Group 2: Warmup Date Status & Format Stress Tests ---');

  // Setup test user in database with different created_at formats
  const testUserId = 9999;
  await run('DELETE FROM users WHERE id = ?', [testUserId]);
  await run('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', [
    testUserId, 'Stress Test User', 'stress@test.com', 'hash', '2026-08-01 12:00:00'
  ]);

  const defaultSettings = {
    enable_number_warmup: 'true',
    warmup_enabled: 'true',
    warmup_stage1_limit: '20',
    warmup_stage2_limit: '50',
    warmup_stage3_limit: '100',
    warmup_stage4_limit: '250'
  };

  // Test 2.1: SQLite format string ('YYYY-MM-DD HH:MM:SS')
  await run('UPDATE users SET created_at = ? WHERE id = ?', ['2026-08-01 12:00:00', testUserId]);
  const sqliteWarmup = await checkWarmupStatus(testUserId, defaultSettings);
  assertTest(
    'warmup',
    'Warmup Date: SQLite Format ("2026-08-01 12:00:00")',
    !isNaN(sqliteWarmup.ageInDays) && sqliteWarmup.ageInDays >= 1,
    `Calculated ageInDays = ${sqliteWarmup.ageInDays}, stage = ${sqliteWarmup.stage}`
  );

  // Test 2.2: Standard ISO 8601 string ('YYYY-MM-DDTHH:MM:SS.sssZ')
  await run('UPDATE users SET created_at = ? WHERE id = ?', ['2026-08-01T12:00:00.000Z', testUserId]);
  const isoWarmup = await checkWarmupStatus(testUserId, defaultSettings);
  assertTest(
    'warmup',
    'Warmup Date: ISO Format ("2026-08-01T12:00:00.000Z")',
    !isNaN(isoWarmup.ageInDays) && isoWarmup.ageInDays >= 1,
    `Calculated ageInDays = ${isoWarmup.ageInDays}, stage = ${isoWarmup.stage}`
  );

  // Test 2.3: Date with timezone offset ('2026-08-01 12:00:00+05:30')
  await run('UPDATE users SET created_at = ? WHERE id = ?', ['2026-08-01 12:00:00+05:30', testUserId]);
  const tzWarmup = await checkWarmupStatus(testUserId, defaultSettings);
  assertTest(
    'warmup',
    'Warmup Date: Timezone Offset Format ("2026-08-01 12:00:00+05:30")',
    !isNaN(tzWarmup.ageInDays) && tzWarmup.ageInDays >= 1,
    `Calculated ageInDays = ${tzWarmup.ageInDays}, stage = ${tzWarmup.stage}`
  );

  // Test 2.4: Invalid Date string ('invalid-date-string')
  await run('UPDATE users SET created_at = ? WHERE id = ?', ['invalid-date-string', testUserId]);
  const invalidWarmup = await checkWarmupStatus(testUserId, defaultSettings);
  assertTest(
    'warmup',
    'Warmup Date: Invalid Date String Fallback',
    !isNaN(invalidWarmup.ageInDays) && invalidWarmup.ageInDays === 1,
    `Gracefully fell back to ageInDays = 1, stage = 1.`
  );

  // Test 2.5: Future created_at Date ('2030-01-01 00:00:00')
  await run('UPDATE users SET created_at = ? WHERE id = ?', ['2030-01-01 00:00:00', testUserId]);
  const futureWarmup = await checkWarmupStatus(testUserId, defaultSettings);
  assertTest(
    'warmup',
    'Warmup Date: Future Date Fallback',
    futureWarmup.ageInDays === 1 && futureWarmup.stage === 1,
    `Future date handled with ageInDays = 1.`
  );

  // Test 2.6: Stage Progression (15 days ago -> Stage 4)
  const fifteenDaysAgo = new Date(Date.now() - 16 * 86400000).toISOString();
  await run('UPDATE users SET created_at = ? WHERE id = ?', [fifteenDaysAgo, testUserId]);
  const stage4Warmup = await checkWarmupStatus(testUserId, defaultSettings);
  assertTest(
    'warmup',
    'Warmup Stage 4 Progression (Account age > 15 days)',
    stage4Warmup.stage === 4 && stage4Warmup.dailyLimit === 250,
    `Correctly calculated Stage 4 (limit: ${stage4Warmup.dailyLimit}).`
  );

  // Clean up user
  await run('DELETE FROM users WHERE id = ?', [testUserId]);

  console.log('');

  // =========================================================================
  // GROUP 3: BLACKLIST LOOKUP & PHONE FORMATTING VARIATIONS
  // =========================================================================
  console.log('--- Group 3: Blacklist Lookup & Phone Formatting Stress Tests ---');

  const blUserId = 8888;
  await run('DELETE FROM users WHERE id IN (?, ?)', [8888, 8889]);
  await run('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [8888, 'BL User 1', 'bl1@test.com', 'hash']);
  await run('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [8889, 'BL User 2', 'bl2@test.com', 'hash']);
  await run('DELETE FROM blacklisted_numbers WHERE user_id IN (?, ?)', [8888, 8889]);

  // Insert standard blacklisted number: '919876543210'
  await addNumberToBlacklist(blUserId, '+91 98765 43210', 'Test Blacklist');

  // Test 3.1: Formatting Variations lookup for +919876543210
  const formatsToTest = [
    { label: 'Full E.164 (+919876543210)', phone: '+919876543210' },
    { label: 'Without Plus (919876543210)', phone: '919876543210' },
    { label: '10-Digit Local (9876543210)', phone: '9876543210' },
    { label: 'Spaces (+91 98765 43210)', phone: '+91 98765 43210' },
    { label: 'Dashes (+91-98765-43210)', phone: '+91-98765-43210' },
    { label: 'Parentheses ((987) 654-3210)', phone: '(987) 654-3210' }
  ];

  for (const item of formatsToTest) {
    const isBl = await isNumberBlacklisted(blUserId, item.phone);
    assertTest(
      'blacklist',
      `Blacklist Lookup: ${item.label}`,
      isBl === true,
      isBl ? `Matched blacklisted number.` : `Failed to match blacklisted number for input "${item.phone}".`
    );
  }

  // Test 3.2: Reverse Case — DB stored 10-digit number '9876543210'
  const blUserId2 = 8889;
  await run('DELETE FROM blacklisted_numbers WHERE user_id = ?', [blUserId2]);
  await addNumberToBlacklist(blUserId2, '9876543210', '10-digit raw');

  const revIsBl1 = await isNumberBlacklisted(blUserId2, '+919876543210');
  const revIsBl2 = await isNumberBlacklisted(blUserId2, '919876543210');
  const revIsBl3 = await isNumberBlacklisted(blUserId2, '9876543210');
  assertTest(
    'blacklist',
    'Reverse Blacklist Matching (DB has 10-digit, query has country code)',
    revIsBl1 && revIsBl2 && revIsBl3,
    `Query +919876543210 matched DB record 9876543210.`
  );

  // Test 3.3: False Positive & Substring Collision Checks
  const nonBlacklistedPhone = '919111111111';
  const isNonBl = await isNumberBlacklisted(blUserId, nonBlacklistedPhone);
  assertTest(
    'blacklist',
    'Blacklist Non-Match Verification',
    isNonBl === false,
    `Clean non-blacklisted number correctly returned false.`
  );

  // Test 3.4: Substring Collision Test (Differs by country code / prefix)
  // DB has 9876543210. Query 19876543210 (US country code 1 + 9876543210) vs 919876543210 (India 91 + 9876543210)
  // What if DB has 9876543210 and query is 19876543210?
  const usQueryIsBl = await isNumberBlacklisted(blUserId2, '19876543210');
  assertTest(
    'blacklist',
    'Blacklist Substring Collision Check (19876543210 vs 9876543210)',
    usQueryIsBl === false,
    `Last 10 digits match returns ${usQueryIsBl}`
  );

  // Test 3.5: Null, Empty, Short Numbers
  const short1 = await isNumberBlacklisted(blUserId, '123');
  const short2 = await isNumberBlacklisted(blUserId, '9999');
  const nullBl = await isNumberBlacklisted(blUserId, null);
  const undefBl = await isNumberBlacklisted(blUserId, undefined);
  assertTest(
    'blacklist',
    'Blacklist Edge Inputs (Short numbers, null, undefined)',
    short1 === false && short2 === false && nullBl === false && undefBl === false,
    'Handled null/short inputs safely without DB errors.'
  );

  // Clean up blacklist
  await run('DELETE FROM blacklisted_numbers WHERE user_id IN (?, ?)', [blUserId, blUserId2]);

  console.log('');

  // =========================================================================
  // GROUP 4: HEALTH SCORE CALCULATION & EDGE CASES
  // =========================================================================
  console.log('--- Group 4: Health Score Calculation & Edge Cases ---');

  const hsUserId = 7777;
  await run('DELETE FROM users WHERE id = ?', [hsUserId]);
  await run('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [hsUserId, 'Health User', 'health@test.com', 'hash']);
  await run('DELETE FROM campaigns WHERE user_id = ?', [hsUserId]);
  await run("INSERT INTO campaigns (id, user_id, name, status) VALUES (7777, ?, 'Stress Campaign', 'Pending')", [hsUserId]);
  // Clear contacts for user
  await run('DELETE FROM contacts WHERE user_id = ?', [hsUserId]);

  // Test 4.1: 0 Contacts in Database (Fresh user)
  const health0 = await calculateHealthScore(hsUserId, defaultSettings);
  assertTest(
    'healthScore',
    'Health Score: 0 Contacts (Fresh User)',
    health0.success === true && health0.healthScore === 100 && health0.statusLevel === 'Healthy',
    `Health score = ${health0.healthScore}, failureRate = ${health0.failureRate}%`
  );

  // Test 4.2: 100% Failures (0 Sent, 50 Failed)
  await run('DELETE FROM contacts WHERE user_id = ?', [hsUserId]);
  for (let i = 0; i < 50; i++) {
    await run(`
      INSERT INTO contacts (user_id, campaign_id, name, phone, status)
      VALUES (?, 7777, ?, ?, 'Failed')
    `, [hsUserId, `Contact ${i}`, `9190000000${i.toString().padStart(2, '0')}`]);
  }
  const health100Fail = await calculateHealthScore(hsUserId, defaultSettings);
  assertTest(
    'healthScore',
    'Health Score: 100% Delivery Failures',
    health100Fail.success === true && health100Fail.healthScore <= 60 && health100Fail.failureRate === '100.0',
    `Health score dropped to ${health100Fail.healthScore}, failureRate = ${health100Fail.failureRate}%, deductions: ${health100Fail.deductions.join('; ')}`
  );

  // Test 4.3: 0% Failures (50 Sent, 0 Failed)
  await run('DELETE FROM contacts WHERE user_id = ?', [hsUserId]);
  for (let i = 0; i < 50; i++) {
    await run(`
      INSERT INTO contacts (user_id, campaign_id, name, phone, status)
      VALUES (?, 7777, ?, ?, 'Sent')
    `, [hsUserId, `Contact ${i}`, `9190000000${i.toString().padStart(2, '0')}`]);
  }
  const health0Fail = await calculateHealthScore(hsUserId, defaultSettings);
  assertTest(
    'healthScore',
    'Health Score: 0% Failure Rate (50 Sent)',
    health0Fail.success === true && health0Fail.healthScore === 100 && health0Fail.failureRate === '0.0',
    `Health score = ${health0Fail.healthScore}, status = ${health0Fail.statusLevel}`
  );

  // Test 4.4: 50% Failures (25 Sent, 25 Failed)
  await run('DELETE FROM contacts WHERE user_id = ?', [hsUserId]);
  for (let i = 0; i < 25; i++) {
    await run(`INSERT INTO contacts (user_id, campaign_id, name, phone, status) VALUES (?, 7777, ?, ?, 'Sent')`, [hsUserId, `C_Sent_${i}`, `91900001${i}`]);
    await run(`INSERT INTO contacts (user_id, campaign_id, name, phone, status) VALUES (?, 7777, ?, ?, 'Failed')`, [hsUserId, `C_Fail_${i}`, `91900002${i}`]);
  }
  const health50Fail = await calculateHealthScore(hsUserId, defaultSettings);
  assertTest(
    'healthScore',
    'Health Score: 50% Failure Rate',
    health50Fail.success === true && health50Fail.healthScore === 60 && health50Fail.failureRate === '50.0',
    `Health score = ${health50Fail.healthScore}, deductions = ${health50Fail.deductions.join('; ')}`
  );

  // Test 4.5: Missing / Empty Settings Object
  let emptySettingsPassed = false;
  let emptySettingsResult = null;
  try {
    emptySettingsResult = await calculateHealthScore(hsUserId, {});
    emptySettingsPassed = emptySettingsResult && emptySettingsResult.success === true;
  } catch (err) {
    emptySettingsPassed = false;
  }
  assertTest(
    'healthScore',
    'Health Score: Empty Settings Object ({})',
    emptySettingsPassed,
    emptySettingsPassed ? `Handled empty settings object correctly.` : `Failed when empty settings object passed.`
  );

  // Test 4.6: Null / Undefined Settings Object
  let nullSettingsPassed = false;
  let nullSettingsError = null;
  try {
    await calculateHealthScore(hsUserId, null);
    nullSettingsPassed = true;
  } catch (err) {
    nullSettingsPassed = false;
    nullSettingsError = err.message;
  }
  assertTest(
    'healthScore',
    'Health Score: Null Settings Parameter Handling',
    nullSettingsPassed,
    nullSettingsPassed ? `Handled null settings without exception.` : `CRASHED with TypeError when null passed: ${nullSettingsError}`
  );

  // Clean up health score contacts
  await run('DELETE FROM contacts WHERE user_id = ?', [hsUserId]);

  console.log('');

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  console.log('====================================================');
  console.log('             STRESS TEST RESULTS SUMMARY            ');
  console.log('====================================================');

  let totalPassed = 0;
  let totalFailed = 0;

  for (const [cat, data] of Object.entries(results)) {
    totalPassed += data.passed;
    totalFailed += data.failed;
    console.log(`Category [${cat.toUpperCase()}]: ${data.passed} Passed, ${data.failed} Failed`);
  }

  console.log('----------------------------------------------------');
  console.log(`TOTAL: ${totalPassed} Passed, ${totalFailed} Failed out of ${totalPassed + totalFailed} tests.`);
  console.log('====================================================\n');

  return { totalPassed, totalFailed, results };
}

runStressTests().then(res => {
  if (res.totalFailed > 0) {
    console.log(`⚠️ Stress test completed with ${res.totalFailed} failure(s).`);
  } else {
    console.log('🎉 ALL STRESS TESTS PASSED WITH 0 FAILURES!');
  }
}).catch(err => {
  console.error('Fatal error during stress test execution:', err);
  process.exitCode = 1;
});
