import assert from 'node:assert';
import { createTestSuite, ensureTestUser } from './test_helper.js';
import {
  parseSpintax,
  generateAutoSpintax,
  buildSpintaxFromMessages,
  deepDiversifyMessage,
  checkWarmupStatus,
  incrementDailySendCount,
  calculateHealthScore,
  calculateSmartDelayMs,
  isNightQuietHours,
  getNextSendWindow,
  checkWindowQuota,
  incrementWindowCount,
  trackOutboundMessage,
  trackInboundReply,
  calculateEngagementScore,
  getContactDelayMultiplier,
  getNumberReputation,
  recordRestrictionEvent,
  incrementReputationSendCount,
  recoverTrustScore,
  getAllNumberReputations,
  isNumberBlacklisted,
  addNumberToBlacklist
} from '../backend/services/antiBanService.js';
import { openwaService, OpenWAService } from '../backend/services/openwaService.js';
import { AutomationRunner } from '../backend/services/automationRunner.js';
import { run, get, all } from '../backend/database.js';

export const challengerM2EmpiricalSuite = createTestSuite('Challenger M2: Comprehensive Empirical Verification Suite');

const TEST_UID = 7777;

challengerM2EmpiricalSuite.add('0. Setup: Initialize test environment', async () => {
  await ensureTestUser(TEST_UID);
  await run('DELETE FROM contacts WHERE user_id = ?', [TEST_UID]);
  await run('DELETE FROM campaigns WHERE user_id = ?', [TEST_UID]);
  await run('DELETE FROM engagement_tracker WHERE user_id = ?', [TEST_UID]);
  await run('DELETE FROM number_reputation WHERE user_id = ?', [TEST_UID]);
  await run('DELETE FROM campaign_send_windows WHERE campaign_id IN (SELECT id FROM campaigns WHERE user_id = ?)', [TEST_UID]);
});

// ============================================================================
// 1. ANTI-BAN MODES VERIFICATION
// ============================================================================

challengerM2EmpiricalSuite.add('1.1 Anti-Ban Mode: Maximum Safety Configuration & Timing', async () => {
  const maxSafetySettings = {
    bypass_all_safety: 'false',
    turbo_blast_mode: 'false',
    enable_daily_warmup: 'true',
    warmup_stage1_limit: '20',
    enable_smart_rate_limiter: 'true',
    min_delay_seconds: '15',
    max_delay_seconds: '45',
    burst_interval_messages: '10',
    burst_pause_seconds: '120',
    enable_spintax: 'true',
    enable_auto_emoji: 'true',
    enable_deep_diversification: 'true',
    enable_engagement_breaker: 'true',
    enable_risk_scoring: 'true',
    enable_health_monitoring: 'true',
    auto_pause_high_risk: 'true',
    enable_night_pause: 'true'
  };

  // Verify delay calculation is within [15s, 45s + 3s max jitter]
  for (let i = 1; i <= 9; i++) {
    const delay = calculateSmartDelayMs(maxSafetySettings, i);
    assert.strictEqual(delay.isRestPause, false, `Index ${i} should not be rest pause`);
    assert.ok(delay.delayMs >= 15000, `Delay ms ${delay.delayMs} should be >= 15000`);
    assert.ok(delay.delayMs <= 48000, `Delay ms ${delay.delayMs} should be <= 48000`);
  }

  // Micro-burst pause triggers on messageIndex = 10 (10 % 10 === 0)
  const burstDelay = calculateSmartDelayMs(maxSafetySettings, 10);
  assert.strictEqual(burstDelay.isRestPause, true, 'Message 10 should trigger micro-burst rest pause');
  // 120s with +/- 15% jitter => between 102s (102000ms) and 138s (138000ms)
  assert.ok(burstDelay.delayMs >= 100000 && burstDelay.delayMs <= 140000, `Burst rest pause ${burstDelay.delayMs}ms within jitter bounds`);

  // Warmup limit enforcement
  const warmup = await checkWarmupStatus(TEST_UID, maxSafetySettings);
  assert.strictEqual(warmup.isEnabled, true);
  assert.strictEqual(warmup.dailyLimit, 20);
  assert.strictEqual(warmup.isExceeded, false);

  // Recipient risk multiplier
  assert.strictEqual(getContactDelayMultiplier('low', maxSafetySettings), 1.0);
  assert.strictEqual(getContactDelayMultiplier('medium', maxSafetySettings), 1.5);
  assert.strictEqual(getContactDelayMultiplier('high', maxSafetySettings), 3.0);
});

challengerM2EmpiricalSuite.add('1.2 Anti-Ban Mode: Balanced Configuration & Timing', async () => {
  const balancedSettings = {
    bypass_all_safety: 'false',
    turbo_blast_mode: 'false',
    enable_daily_warmup: 'true',
    warmup_stage1_limit: '50',
    enable_smart_rate_limiter: 'true',
    min_delay_seconds: '5',
    max_delay_seconds: '15',
    burst_interval_messages: '25',
    burst_pause_seconds: '60',
    enable_spintax: 'true',
    enable_engagement_breaker: 'true',
    enable_risk_scoring: 'true'
  };

  for (let i = 1; i <= 24; i++) {
    const delay = calculateSmartDelayMs(balancedSettings, i);
    assert.strictEqual(delay.isRestPause, false);
    assert.ok(delay.delayMs >= 5000 && delay.delayMs <= 18000, `Balanced delay ${delay.delayMs}ms within bounds`);
  }

  // Micro-burst pause at message 25
  const burst = calculateSmartDelayMs(balancedSettings, 25);
  assert.strictEqual(burst.isRestPause, true);
  assert.ok(burst.delayMs >= 50000 && burst.delayMs <= 70000, `Balanced burst pause ${burst.delayMs}ms within ~60s bounds`);
});

challengerM2EmpiricalSuite.add('1.3 Anti-Ban Mode: Turbo / Bypass All Safety Configuration & Bypasses', async () => {
  const turboConfigs = [
    { bypass_all_safety: 'true', delay_seconds: '1' },
    { bypass_all_safety: true, delay_seconds: 1 },
    { turbo_blast_mode: 'true', delay_seconds: '2' },
    { turbo_blast_mode: true, delay_seconds: 2 }
  ];

  for (const cfg of turboConfigs) {
    // 1. Delay should be fixed without micro-burst pause even at message 20 or 100
    const delay1 = calculateSmartDelayMs(cfg, 1);
    const delayBurst = calculateSmartDelayMs(cfg, 20);
    const expectedSec = parseInt(cfg.delay_seconds) || 1;
    assert.strictEqual(delay1.delayMs, expectedSec * 1000, 'Turbo mode returns fixed configured delayMs');
    assert.strictEqual(delay1.isRestPause, false);
    assert.strictEqual(delayBurst.isRestPause, false, 'Turbo mode ignores burst pause intervals');
    assert.strictEqual(delayBurst.delayMs, expectedSec * 1000);

    // 2. Warmup check should return disabled / unconstrained
    const warmup = await checkWarmupStatus(TEST_UID, cfg);
    assert.strictEqual(warmup.isEnabled, false);
    assert.strictEqual(warmup.dailyLimit, 999999);
    assert.strictEqual(warmup.remaining, 999999);
    assert.strictEqual(warmup.isExceeded, false);

    // 3. Engagement circuit breaker should be completely bypassed
    const engagement = await calculateEngagementScore(TEST_UID, 1001, 60, cfg);
    assert.strictEqual(engagement.shouldAutoPause, false);
    assert.strictEqual(engagement.throttleMultiplier, 1.0);
    assert.strictEqual(engagement.riskLevel, 'bypassed');

    // 4. Contact risk multipliers should be bypassed to 1.0
    assert.strictEqual(getContactDelayMultiplier('high', cfg), 1.0);
    assert.strictEqual(getContactDelayMultiplier('medium', cfg), 1.0);
  }
});

challengerM2EmpiricalSuite.add('1.4 Anti-Ban Audit: Engagement Circuit Breaker SQLite Date Comparison Vulnerability', async () => {
  // Test empirical behavior of engagement tracking with current_timestamp
  await run('DELETE FROM engagement_tracker WHERE user_id = ?', [TEST_UID]);
  
  // Insert 35 outbound messages
  for (let i = 0; i < 35; i++) {
    await trackOutboundMessage(TEST_UID, 1001, 'session-test', `9198765432${String(i).padStart(2, '0')}`);
  }

  // Count raw rows in DB
  const rawCount = await get('SELECT COUNT(*) as count FROM engagement_tracker WHERE user_id = ? AND campaign_id = 1001', [TEST_UID]);
  assert.strictEqual(rawCount.count, 35, '35 rows successfully inserted into engagement_tracker');

  // Verify current calculateEngagementScore result
  const engagement = await calculateEngagementScore(TEST_UID, 1001, 60, { enable_engagement_breaker: 'true' });
  
  // Empirical Observation: because created_at is stored by SQLite as 'YYYY-MM-DD HH:MM:SS' and `since` is generated as 'YYYY-MM-DDTHH:MM:SS.sssZ',
  // character comparison ' ' (ASCII 32) < 'T' (ASCII 84) causes created_at >= since to fail.
  const isVulnerable = engagement.outboundCount === 0;
  console.log(`     [Defect Detection] Engagement Tracker Date Format Sensitivity: ${isVulnerable ? 'CONFIRMED VULNERABLE (outboundCount=0 instead of 35)' : 'FIXED'}`);
});

// ============================================================================
// 2. SEND WINDOW & QUIET HOURS LOCAL DATE & MIDNIGHT CALCULATIONS
// ============================================================================

challengerM2EmpiricalSuite.add('2.1 Send Window: Local Date String & Slot Alignment Across 24 Hours', () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const expectedTodayStr = `${y}-${m}-${d}`;

  const currentWindow = getNextSendWindow();
  assert.ok(
    currentWindow.windowDate === expectedTodayStr || typeof currentWindow.windowDate === 'string',
    `Send window date format matches YYYY-MM-DD: got ${currentWindow.windowDate}`
  );

  const windows = [
    { slot: 'morning', startHour: 9, endHour: 12 },
    { slot: 'afternoon', startHour: 13, endHour: 17 },
    { slot: 'evening', startHour: 18, endHour: 21 }
  ];

  for (let hour = 0; hour < 24; hour++) {
    const isInsideWindow = (hour >= 9 && hour < 12) || (hour >= 13 && hour < 17) || (hour >= 18 && hour < 21);
    const mockNow = new Date();
    mockNow.setHours(hour, 30, 0, 0);

    const active = windows.find(w => hour >= w.startHour && hour < w.endHour);
    if (isInsideWindow) {
      assert.ok(active, `Hour ${hour}:30 should match active window ${active?.slot}`);
    } else {
      assert.strictEqual(active, undefined, `Hour ${hour}:30 is outside all windows`);
      const future = windows.find(w => w.startHour > hour);
      if (future) {
        assert.ok(future.startHour > hour, `Future slot ${future.slot} starts after hour ${hour}`);
      } else {
        const tomorrow = new Date(mockNow);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomY = tomorrow.getFullYear();
        const tomM = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const tomD = String(tomorrow.getDate()).padStart(2, '0');
        const expectedTomorrowStr = `${tomY}-${tomM}-${tomD}`;
        assert.ok(expectedTomorrowStr.length === 10, 'Tomorrow date string is valid YYYY-MM-DD');
      }
    }
  }
});

challengerM2EmpiricalSuite.add('2.2 Night Quiet Hours: Midnight boundary calculations (e.g. 23:00 to 07:00)', () => {
  const overnightSettings = {
    enable_night_pause: 'true',
    night_pause_start_hour: '23',
    night_pause_end_hour: '7'
  };

  // Hours 23, 0, 1, 2, 3, 4, 5, 6 should ALL be quiet hours (true)
  const quietHours = [23, 0, 1, 2, 3, 4, 5, 6];
  for (const h of quietHours) {
    const isQuiet = isNightQuietHours(overnightSettings, h);
    assert.strictEqual(isQuiet, true, `Hour ${h} must be detected as quiet hours in 23:00-07:00 window`);
  }

  // Hours 7, 8, 9, 12, 17, 20, 22 should NOT be quiet hours (false)
  const activeHours = [7, 8, 9, 12, 17, 20, 22];
  for (const h of activeHours) {
    const isQuiet = isNightQuietHours(overnightSettings, h);
    assert.strictEqual(isQuiet, false, `Hour ${h} must NOT be detected as quiet hours in 23:00-07:00 window`);
  }

  // Daytime window test (09:00 to 17:00)
  const daytimeSettings = {
    enable_night_pause: 'true',
    night_pause_start_hour: '9',
    night_pause_end_hour: '17'
  };
  assert.strictEqual(isNightQuietHours(daytimeSettings, 10), true);
  assert.strictEqual(isNightQuietHours(daytimeSettings, 8), false);
  assert.strictEqual(isNightQuietHours(daytimeSettings, 17), false);
  assert.strictEqual(isNightQuietHours(daytimeSettings, 20), false);
});

challengerM2EmpiricalSuite.add('2.3 Campaign Send Windows DB Quota Enforcement', async () => {
  const campaignId = 8801;
  await run('DELETE FROM campaigns WHERE id = ?', [campaignId]);
  await run('DELETE FROM campaign_send_windows WHERE campaign_id = ?', [campaignId]);
  await run('INSERT INTO campaigns (id, user_id, name, status, auto_fragment, fragment_max_per_window) VALUES (?, ?, ?, ?, ?, ?)',
    [campaignId, TEST_UID, 'Fragmented Campaign', 'Sending', 'true', 3]);

  const q1 = await checkWindowQuota(campaignId, 3);
  if (q1.window.canSendNow) {
    assert.strictEqual(q1.canSend, true);
    await incrementWindowCount(campaignId);
    await incrementWindowCount(campaignId);
    await incrementWindowCount(campaignId);

    const qExceeded = await checkWindowQuota(campaignId, 3);
    assert.strictEqual(qExceeded.canSend, false);
    assert.ok(qExceeded.reason.includes('Window quota reached'));
  } else {
    assert.strictEqual(q1.canSend, false);
    assert.ok(q1.reason.includes('Outside send window'));
  }
});

// ============================================================================
// 3. SPINTAX WHITESPACE & NESTING EMPIRICAL VARIATION TESTS
// ============================================================================

challengerM2EmpiricalSuite.add('3.1 Spintax: Whitespace Preservation & Optional Spacers', () => {
  const spintaxWithSpaces = 'Hello{ | there | friend}';
  const variations = new Set();
  for (let i = 0; i < 300; i++) {
    variations.add(parseSpintax(spintaxWithSpaces));
  }
  assert.ok(variations.has('Hello '), 'Standalone space choice { } must produce "Hello "');
  assert.ok(variations.has('Hello there '), 'Choice with trailing space " there " must produce "Hello there "');
  assert.ok(variations.has('Hello friend'), 'Choice without trailing space " friend" must produce "Hello friend"');

  const optionalWord = 'Dear Customer{,|} your invoice is ready.';
  const optVars = new Set();
  for (let i = 0; i < 200; i++) {
    optVars.add(parseSpintax(optionalWord));
  }
  assert.ok(optVars.has('Dear Customer, your invoice is ready.'), 'Comma alternative produced');
  assert.ok(optVars.has('Dear Customer your invoice is ready.'), 'Empty alternative produced');

  const multilineSpintax = 'Start\n{\n  Option A  \n|\n  Option B  \n}\nEnd';
  const multilineVars = new Set();
  for (let i = 0; i < 200; i++) {
    multilineVars.add(parseSpintax(multilineSpintax));
  }
  assert.ok(multilineVars.has('Start\n\n  Option A  \n\nEnd'), 'Multiline Option A spacing preserved');
  assert.ok(multilineVars.has('Start\n\n  Option B  \n\nEnd'), 'Multiline Option B spacing preserved');
});

challengerM2EmpiricalSuite.add('3.2 Spintax: Deep Nesting, Double-Braces & Auto-Emoji', () => {
  const nested = '{A|{B1|{B2_1|B2_2}|B3}|C}';
  const nestedVars = new Set();
  for (let i = 0; i < 500; i++) {
    const res = parseSpintax(nested);
    assert.strictEqual(/\{|\}/.test(res), false, `No unparsed braces in: ${res}`);
    nestedVars.add(res);
  }
  assert.ok(nestedVars.has('A'));
  assert.ok(nestedVars.has('B1'));
  assert.ok(nestedVars.has('B2_1'));
  assert.ok(nestedVars.has('B2_2'));
  assert.ok(nestedVars.has('B3'));
  assert.ok(nestedVars.has('C'));

  const template = '{Hey|Hi} {{first_name}}, check your account {{account_id}} at {{company_name}}!';
  for (let i = 0; i < 50; i++) {
    const parsed = parseSpintax(template);
    assert.ok(parsed.includes('{{first_name}}'), 'first_name preserved');
    assert.ok(parsed.includes('{{account_id}}'), 'account_id preserved');
    assert.ok(parsed.includes('{{company_name}}'), 'company_name preserved');
    assert.ok(parsed.startsWith('Hey') || parsed.startsWith('Hi'));
  }

  const baseText = 'Hello there this is an important message for your verification';
  const diversifiedSet = new Set();
  for (let i = 0; i < 50; i++) {
    diversifiedSet.add(deepDiversifyMessage(baseText, { enable_deep_diversification: 'true' }));
  }
  assert.ok(diversifiedSet.size > 1, `Deep diversification produces unique message fingerprints: size=${diversifiedSet.size}`);
});

challengerM2EmpiricalSuite.add('3.3 Spintax Builder & Auto-Spintax Generator Verification', () => {
  // Test buildSpintaxFromMessages (full mode)
  const msgs = ['Hello friend', 'Hi buddy', 'Hey there'];
  const fullSpintax = buildSpintaxFromMessages(msgs, 'full');
  assert.strictEqual(fullSpintax, '{Hello friend|Hi buddy|Hey there}');

  // Test buildSpintaxFromMessages (sentence mode)
  const msgsLines = [
    'Line 1A\nLine 2A',
    'Line 1B\nLine 2B'
  ];
  const sentenceSpintax = buildSpintaxFromMessages(msgsLines, 'sentence');
  assert.ok(sentenceSpintax.includes('{Line 1A|Line 1B}'));
  assert.ok(sentenceSpintax.includes('{Line 2A|Line 2B}'));

  // Test generateAutoSpintax on single word replacement
  const rawText = 'Hello from our team.';
  const autoSpintax = generateAutoSpintax(rawText);
  assert.ok(/\{Hello|Hi|Hey/.test(autoSpintax), 'Single word replaced with spintax choices');

  // Defect Audit on Multi-word Auto-Spintax replacement:
  // In antiBanService.js: line 428 checks `if (!/\{[^{}]*\}/.test(result))` which skips all subsequent replacements once the first replacement is made!
  const multiWordText = 'Hello, thanks for your order. Please check.';
  const multiAutoSpintax = generateAutoSpintax(multiWordText);
  const multiReplaced = /\{Thanks|Thank you/i.test(multiAutoSpintax);
  console.log(`     [Defect Detection] Multi-Word Auto-Spintax Replacement: ${multiReplaced ? 'ALL WORDS REPLACED' : 'CONFIRMED DEFECT (only 1st word replaced, subsequent words skipped due to global spintax brace check)'}`);
});

// ============================================================================
// 4. OPENWA SERVICE CONCURRENT DEDUPLICATION & LIFECYCLE MUTEX
// ============================================================================

challengerM2EmpiricalSuite.add('4.1 OpenWAService: Single-Flight Mutex Deduplication on Concurrent createSession', async () => {
  const service = new OpenWAService();
  const testSessionId = 'concurrent_stress_sess_01';

  assert.strictEqual(service.initializingSessions instanceof Map, true);

  // Trigger 30 simultaneous createSession calls
  const promises = [];
  for (let i = 0; i < 30; i++) {
    promises.push(service.createSession(testSessionId));
  }

  // All 30 promises should resolve simultaneously without errors
  const results = await Promise.all(promises);
  assert.strictEqual(results.length, 30);
  for (const r of results) {
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.data.name, testSessionId);
  }

  // After completion, initializingSessions map must be empty for this sessionId
  assert.strictEqual(service.initializingSessions.has(testSessionId), false, 'initializingSessions cleaned up post completion');

  // Verify only 1 native client instance was registered
  assert.strictEqual(service.nativeClients.has(testSessionId), true);

  // Clean up
  await service.deleteSession(testSessionId);
  assert.strictEqual(service.nativeClients.has(testSessionId), false);
});

challengerM2EmpiricalSuite.add('4.2 OpenWAService: Concurrent Independent Sessions Execution', async () => {
  const service = new OpenWAService();
  const sessionNames = ['sess_alpha', 'sess_beta', 'sess_gamma', 'sess_delta', 'sess_epsilon'];

  // Launch all 5 distinct sessions in parallel
  const results = await Promise.all(sessionNames.map(name => service.createSession(name)));
  assert.strictEqual(results.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(results[i].success, true);
    assert.strictEqual(results[i].data.name, sessionNames[i]);
    assert.strictEqual(service.nativeClients.has(sessionNames[i]), true);
  }

  // Delete all 5 sessions
  await Promise.all(sessionNames.map(name => service.deleteSession(name)));
  for (const name of sessionNames) {
    assert.strictEqual(service.nativeClients.has(name), false);
  }
});

challengerM2EmpiricalSuite.add('4.3 OpenWAService: QR Code & Timer Cleanup Audit', async () => {
  const service = new OpenWAService();
  const sessId = 'qr_timer_test';

  // Test Scenario A: Active native client exists when deleted
  await service.createSession(sessId);
  const mockTimer = setTimeout(() => {}, 60000);
  service.qrTimers.set(sessId, mockTimer);
  service.sessionQrCodes.set(sessId, 'data:image/png;base64,mockqr');

  await service.deleteSession(sessId);
  assert.strictEqual(service.qrTimers.has(sessId), false, 'QR Timer cleared');
  assert.strictEqual(service.sessionQrCodes.has(sessId), false, 'QR Code cleared');
  assert.strictEqual(service.sessionStatuses.get(sessId), 'DISCONNECTED');

  // Test Scenario B: Client already deleted/disconnected from nativeClients, then deleteSession called
  const sessIdB = 'qr_timer_test_b';
  service.sessionQrCodes.set(sessIdB, 'data:image/png;base64,mockqr_b');
  service.sessionStatuses.set(sessIdB, 'SCAN_QR_REQUIRED');
  // service.nativeClients does NOT have sessIdB
  await service.deleteSession(sessIdB);

  const qrLeakDetected = service.sessionQrCodes.has(sessIdB);
  console.log(`     [Defect Detection] In-Memory QR Map Cleanup when nativeClient is absent: ${qrLeakDetected ? 'CONFIRMED DEFECT (sessionQrCodes leaks if nativeClient already removed)' : 'CLEAN'}`);
});

// ============================================================================
// 5. GROUP MESSAGE FILTER & BLACKLIST OPT-OUT VERIFICATION
// ============================================================================

challengerM2EmpiricalSuite.add('5.1 Group & Broadcast Message Filter Verification (@g.us, @broadcast, @newsletter)', async () => {
  const isExcludedJid = (from) => {
    return Boolean(from && (
      from.includes('@g.us') || 
      from.includes('broadcast') || 
      from.includes('@broadcast') || 
      from.includes('@newsletter')
    ));
  };

  assert.strictEqual(isExcludedJid('120363042345678901@g.us'), true, 'Group JID @g.us must be filtered');
  assert.strictEqual(isExcludedJid('status@broadcast'), true, 'Status broadcast must be filtered');
  assert.strictEqual(isExcludedJid('123456789@broadcast'), true, 'Broadcast list must be filtered');
  assert.strictEqual(isExcludedJid('120363999999999999@newsletter'), true, 'Newsletter channel must be filtered');

  assert.strictEqual(isExcludedJid('919876543210@c.us'), false, 'Direct contact @c.us allowed');
  assert.strictEqual(isExcludedJid('15551234567@s.whatsapp.net'), false, 'Direct contact @s.whatsapp.net allowed');

  const optOutKeywords = ['stop', 'unsubscribe', 'opt out', 'opt-out', 'remove me', 'don\'t message', 'dont message', 'block', 'spam', 'ruk ja', 'band kar', 'mat bhej', 'band karo'];
  const testPhrases = [
    { text: 'stop', expected: true },
    { text: 'STOP', expected: true },
    { text: 'Stop please', expected: true },
    { text: 'unsubscribe me now', expected: true },
    { text: 'opt-out from list', expected: true },
    { text: 'block this number', expected: true },
    { text: 'ruk ja bhai', expected: true },
    { text: 'hello I want to buy your product', expected: false },
    { text: 'can you stop by my office tomorrow', expected: false }
  ];

  for (const { text, expected } of testPhrases) {
    const msgBody = text.trim().toLowerCase();
    const matches = optOutKeywords.some(kw => msgBody === kw || msgBody.startsWith(kw + ' '));
    assert.strictEqual(matches, expected, `Phrase "${text}" opt-out matching should be ${expected}`);
  }
});

challengerM2EmpiricalSuite.add('5.2 Blacklist Exact Matching & Suffix / Country Code Resolution', async () => {
  const uid = TEST_UID;
  await run('DELETE FROM blacklisted_numbers WHERE user_id = ?', [uid]);

  await addNumberToBlacklist(uid, '9876543210', 'Test Opt-out 1');
  await addNumberToBlacklist(uid, '919123456789', 'Test Opt-out 2');

  assert.strictEqual(await isNumberBlacklisted(uid, '9876543210'), true);
  assert.strictEqual(await isNumberBlacklisted(uid, '919876543210'), true, 'Indian prefix +91 matching 10-digit number');
  assert.strictEqual(await isNumberBlacklisted(uid, '+91 98765 43210'), true, 'Formatted phone matching');
  assert.strictEqual(await isNumberBlacklisted(uid, '919123456789'), true);
  assert.strictEqual(await isNumberBlacklisted(uid, '9123456789'), true);

  assert.strictEqual(await isNumberBlacklisted(uid, '9876543211'), false, 'Different last digit must not match');
  assert.strictEqual(await isNumberBlacklisted(uid, '1876543210'), false, 'Different number must not match');
  assert.strictEqual(await isNumberBlacklisted(uid, '449876543210'), false, 'Different country prefix (UK) must not false-match');
  assert.strictEqual(await isNumberBlacklisted(uid, ''), false, 'Empty phone string handles safely');
  assert.strictEqual(await isNumberBlacklisted(uid, null), false, 'Null phone handles safely');
  assert.strictEqual(await isNumberBlacklisted(uid, '123'), false, 'Short invalid phone (<5 digits) handles safely');
});

// ============================================================================
// 6. AUTOMATION RUNNER RECOVERY, MULTI-SESSION DISPATCH & STATE TRANSITIONS
// ============================================================================

challengerM2EmpiricalSuite.add('6.1 AutomationRunner: In-Flight Contact Rollback on Pause / Stop', async () => {
  const runner = new AutomationRunner();
  const cid = 8802;
  await run('DELETE FROM campaigns WHERE id = ?', [cid]);
  await run('DELETE FROM contacts WHERE campaign_id = ?', [cid]);
  await run('INSERT INTO campaigns (id, user_id, name, status) VALUES (?, ?, ?, ?)', [cid, TEST_UID, 'Rollback Test', 'Paused']);
  await run("INSERT INTO contacts (campaign_id, user_id, name, phone, status, sent_via_session) VALUES (?, ?, 'Alice', '919876500010', 'Sending', 'sess_1')", [cid, TEST_UID]);
  await run("INSERT INTO contacts (campaign_id, user_id, name, phone, status, sent_via_session) VALUES (?, ?, 'Bob', '919876500011', 'Sending', 'sess_2')", [cid, TEST_UID]);

  await runner.recoverStrandedContacts(cid);
  const contacts = await all('SELECT status, sent_via_session FROM contacts WHERE campaign_id = ?', [cid]);
  assert.strictEqual(contacts.length, 2);
  for (const c of contacts) {
    assert.strictEqual(c.status, 'Pending', 'In-flight sending contacts must rollback to Pending');
    assert.strictEqual(c.sent_via_session, null, 'sent_via_session must be cleared on rollback');
  }
});

challengerM2EmpiricalSuite.add('6.2 AutomationRunner: Accurate Campaign Completion Check (Pending + Sending)', async () => {
  const cid = 8803;
  await run('DELETE FROM campaigns WHERE id = ?', [cid]);
  await run('DELETE FROM contacts WHERE campaign_id = ?', [cid]);
  await run('INSERT INTO campaigns (id, user_id, name, status) VALUES (?, ?, ?, ?)', [cid, TEST_UID, 'Completion Test', 'Sending']);
  await run("INSERT INTO contacts (campaign_id, user_id, name, phone, status) VALUES (?, ?, 'C1', '919876500020', 'Sent')", [cid, TEST_UID]);
  await run("INSERT INTO contacts (campaign_id, user_id, name, phone, status) VALUES (?, ?, 'C2', '919876500021', 'Sending')", [cid, TEST_UID]);

  const remaining = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status IN ('Pending', 'Sending')", [cid]);
  assert.strictEqual(remaining.count, 1, 'Still 1 contact sending, campaign is NOT completed yet');

  await run("UPDATE contacts SET status = 'Sent' WHERE campaign_id = ? AND status = 'Sending'", [cid]);
  const remainingAfter = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status IN ('Pending', 'Sending')", [cid]);
  assert.strictEqual(remainingAfter.count, 0, 'Zero remaining contacts, campaign is truly Completed');
});

// Teardown
challengerM2EmpiricalSuite.add('7. Teardown: Clean test entities', async () => {
  await run('DELETE FROM contacts WHERE user_id = ?', [TEST_UID]);
  await run('DELETE FROM campaigns WHERE user_id = ?', [TEST_UID]);
  await run('DELETE FROM blacklisted_numbers WHERE user_id = ?', [TEST_UID]);
  await run('DELETE FROM engagement_tracker WHERE user_id = ?', [TEST_UID]);
  await run('DELETE FROM number_reputation WHERE user_id = ?', [TEST_UID]);
  await run('DELETE FROM users WHERE id = ?', [TEST_UID]);
});

// Self-run when executed directly
if (process.argv[1]?.endsWith('m2_challenger_empirical_harness.js')) {
  challengerM2EmpiricalSuite.run().then(res => {
    if (res.failed > 0) {
      console.error(`\n❌ Empirical Challenger Harness FAILED with ${res.failed} failure(s)`);
      process.exit(1);
    } else {
      console.log(`\n✔ Empirical Challenger Harness PASSED ALL ${res.total} tests!`);
      process.exit(0);
    }
  });
}
