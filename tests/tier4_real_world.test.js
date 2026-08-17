import assert from 'node:assert';
import { createTestSuite, ensureTestUser } from './test_helper.js';
import { 
  parseSpintax, 
  calculateSmartDelayMs, 
  calculateHealthScore, 
  checkWarmupStatus,
  addNumberToBlacklist,
  isNumberBlacklisted,
  incrementDailySendCount,
  isNightQuietHours
} from '../backend/services/antiBanService.js';
import { run, all } from '../backend/database.js';

export const tier4Suite = createTestSuite('Tier 4: Real-World E2E Messaging Flow Scenarios');

// Scenario 1: High-Volume Campaign with Spintax & Rate Limiting Pipeline
tier4Suite.add('Tier 4 - Scenario 1: High-Volume Campaign with Spintax & Rate Limiting Pipeline', async () => {
  const userId = 801;
  await ensureTestUser(userId);

  const rawMessageTemplate = '{Hello|Hi|Greetings} {Valued Customer|Friend}, your order #{101|102|103} is ready!';
  const settings = {
    enable_smart_rate_limiter: 'true',
    min_delay_seconds: '5',
    max_delay_seconds: '10',
    burst_interval_messages: '3',
    burst_pause_seconds: '15'
  };

  const processedMessages = new Set();
  const delays = [];

  for (let msgIndex = 1; msgIndex <= 6; msgIndex++) {
    // Step 1: Parse Spintax
    const parsedMsg = parseSpintax(rawMessageTemplate, { enableSpintax: true, enableAutoEmoji: true });
    processedMessages.add(parsedMsg);

    // Step 2: Compute Smart Delay
    const delayInfo = calculateSmartDelayMs(settings, msgIndex);
    delays.push(delayInfo);

    // Step 3: Increment Daily Tracker
    await incrementDailySendCount(userId);
  }

  // Assertions
  assert.ok(processedMessages.size >= 2, 'Spintax should generate multiple unique message variations across batch');
  assert.strictEqual(delays[2].isRestPause, true, 'Message 3 should trigger micro-burst rest pause');
  assert.strictEqual(delays[5].isRestPause, true, 'Message 6 should trigger micro-burst rest pause');
  
  const warmup = await checkWarmupStatus(userId);
  assert.strictEqual(warmup.sentToday, 6, 'Daily send count should track all 6 dispatched messages');
});

// Scenario 2: Opt-Out Blacklist Protection Enforcement
tier4Suite.add('Tier 4 - Scenario 2: Opt-Out Blacklist Protection Enforcement Workflow', async () => {
  const userId = 802;
  await ensureTestUser(userId);

  const optOutPhone = '919111122223';
  const validPhone = '919111122224';

  // 1. Add optOutPhone to blacklist
  await addNumberToBlacklist(userId, optOutPhone, 'User replied STOP');

  // 2. Simulate campaign dispatch list
  const campaignContacts = [
    { name: 'User 1', phone: optOutPhone },
    { name: 'User 2', phone: validPhone }
  ];

  const dispatchResults = [];

  for (const contact of campaignContacts) {
    const blocked = await isNumberBlacklisted(userId, contact.phone);
    if (blocked) {
      dispatchResults.push({ phone: contact.phone, status: 'Skipped', reason: 'Blacklisted Opt-Out' });
    } else {
      const msg = parseSpintax('Hello {there|friend}!');
      await incrementDailySendCount(userId);
      dispatchResults.push({ phone: contact.phone, status: 'Sent', message: msg });
    }
  }

  // Assertions
  assert.strictEqual(dispatchResults[0].status, 'Skipped');
  assert.strictEqual(dispatchResults[0].reason, 'Blacklisted Opt-Out');
  assert.strictEqual(dispatchResults[1].status, 'Sent');
});

// Scenario 3: Warmup Daily Limit Escalation & Health Score Auto-Pause
tier4Suite.add('Tier 4 - Scenario 3: Warmup Daily Limit Escalation & Health Score Auto-Pause', async () => {
  const userId = 803;
  await ensureTestUser(userId);

  const settings = {
    enable_number_warmup: 'true',
    warmup_stage1_limit: '5',
    enable_health_monitoring: 'true',
    auto_pause_high_risk: 'true'
  };

  // Simulate 5 sends today to max out stage 1 limit
  for (let i = 0; i < 5; i++) {
    await incrementDailySendCount(userId);
  }

  // Check warmup status
  const warmup = await checkWarmupStatus(userId, settings);
  assert.strictEqual(warmup.sentToday, 5);
  assert.strictEqual(warmup.isExceeded, true, 'Warmup status should be exceeded after 5 sends');

  // Calculate health score under exceeded limit
  const health = await calculateHealthScore(userId, settings);

  assert.ok(health.healthScore <= 70, 'Health score should deduct points when warmup limit exceeded');
  assert.ok(health.deductions.some(d => d.includes('Exceeded daily warmup limit')), 'Deductions should explicitly report exceeded limit');
  assert.strictEqual(health.autoPause, true, 'Auto pause flag should be active to halt automation runner');
});

// Scenario 4: Night-Time Quiet Hours Guard Workflow
tier4Suite.add('Tier 4 - Scenario 4: Night-Time Quiet Hours Campaign Guard Workflow', async () => {
  const currentHour = new Date().getHours();
  // Set start hour to current hour and end hour to (currentHour + 2) % 24 to guarantee active match
  const nightSettingsActive = {
    enable_night_pause: 'true',
    night_pause_start_hour: String(currentHour),
    night_pause_end_hour: String((currentHour + 2) % 24)
  };

  const nightSettingsInactive = {
    enable_night_pause: 'false'
  };

  const isQuietActive = isNightQuietHours(nightSettingsActive);
  const isQuietInactive = isNightQuietHours(nightSettingsInactive);

  assert.strictEqual(isQuietActive, true, 'Quiet hours should evaluate to active during configured interval');
  assert.strictEqual(isQuietInactive, false, 'Quiet hours should evaluate to inactive when toggle disabled');
});

// Scenario 5: End-to-End Settings UI State & API Sync Verification
tier4Suite.add('Tier 4 - Scenario 5: End-to-End Settings UI State & API Sync Verification', async () => {
  const userId = 805;
  await ensureTestUser(userId);

  // 1. Save settings to DB
  const settingsToSave = [
    { key: 'enable_smart_rate_limiter', value: 'true' },
    { key: 'min_delay_seconds', value: '10' },
    { key: 'enable_number_warmup', value: 'true' }
  ];

  for (const s of settingsToSave) {
    await run(`
      INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)
    `, [userId, s.key, s.value]);
  }

  // 2. Retrieve settings & calculate health score
  const userSettings = await all('SELECT key, value FROM settings WHERE user_id = ?', [userId]);
  const settingsMap = {};
  userSettings.forEach(r => { settingsMap[r.key] = r.value; });

  const health = await calculateHealthScore(userId, settingsMap);
  const warmup = await checkWarmupStatus(userId, settingsMap);

  assert.strictEqual(settingsMap['enable_smart_rate_limiter'], 'true');
  assert.strictEqual(settingsMap['min_delay_seconds'], '10');
  assert.strictEqual(health.isEnabled, true);
  assert.strictEqual(warmup.isEnabled, true);
});
