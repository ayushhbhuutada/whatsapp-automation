import assert from 'node:assert';
import { createTestSuite, ensureTestUser } from './test_helper.js';
import { 
  parseSpintax, 
  calculateSmartDelayMs, 
  calculateHealthScore, 
  checkWarmupStatus,
  addNumberToBlacklist,
  isNumberBlacklisted 
} from '../backend/services/antiBanService.js';
import { run } from '../backend/database.js';

export const tier3Suite = createTestSuite('Tier 3: Cross-Feature Pairwise Integration');

// Pairwise 1: Spintax Engine + Blacklist Filter
tier3Suite.add('Tier 3 - Interaction 1: Spintax parsing with Blacklisted number check', async () => {
  const userId = 777;
  await ensureTestUser(userId);
  const testPhone = '919876500001';
  
  // Add phone to blacklist
  await addNumberToBlacklist(userId, testPhone, 'Opt-out test');
  
  // Message template
  const rawMessage = '{Hello|Hi} customer!';
  const parsedMessage = parseSpintax(rawMessage);
  
  const isBlocked = await isNumberBlacklisted(userId, testPhone);
  assert.strictEqual(isBlocked, true, 'Phone should be identified as blacklisted');
  assert.ok(['Hello customer!', 'Hi customer!'].includes(parsedMessage), 'Spintax should still parse message text');
});

// Pairwise 2: Smart Rate Limiting + Warmup Stage Limits
tier3Suite.add('Tier 3 - Interaction 2: Rate Limiting delay adjustment when Warmup stage active', async () => {
  const userId = 778;
  await ensureTestUser(userId);
  const warmupSettings = { enable_number_warmup: 'true', warmup_stage1_limit: '20' };
  
  const warmupStatus = await checkWarmupStatus(userId, warmupSettings);
  const rateLimitConfig = { enable_smart_rate_limiter: 'true', burst_interval_messages: '10' };
  
  // Calculate delay for 10th message (burst trigger)
  const delay = calculateSmartDelayMs(rateLimitConfig, 10);
  
  assert.strictEqual(warmupStatus.dailyLimit, 20);
  assert.strictEqual(delay.isRestPause, true);
  assert.ok(delay.delayMs > 10000, 'Rest pause delay should exceed baseline delay');
});

// Pairwise 3: Health Score System + Auto-Pause Activation
tier3Suite.add('Tier 3 - Interaction 3: Health Monitoring score reduction triggers Auto-Pause state', async () => {
  const userId = 779;
  await ensureTestUser(userId);
  
  // Seed database with failed contact records to inflate failure rate
  await run(`
    INSERT INTO contacts (user_id, name, phone, status)
    VALUES 
      (?, 'Contact 1', '919000000001', 'Failed'),
      (?, 'Contact 2', '919000000002', 'Failed'),
      (?, 'Contact 3', '919000000003', 'Failed'),
      (?, 'Contact 4', '919000000004', 'Failed')
  `, [userId, userId, userId, userId]);
  
  const health = await calculateHealthScore(userId, { auto_pause_high_risk: 'true' });
  
  assert.ok(health.healthScore < 100, 'Health score should deduct for high failure rate');
  assert.strictEqual(health.autoPause, true, 'Auto pause flag should be active');
  assert.ok(health.deductions.length > 0, 'Deductions should log failure rate warning');
});

// Pairwise 4: Blacklist Opt-Out + Daily Send Tracker
tier3Suite.add('Tier 3 - Interaction 4: Blacklisted contact is skipped and daily tracker remains unaltered', async () => {
  const userId = 780;
  await ensureTestUser(userId);
  const blacklistedPhone = '919876500002';
  await addNumberToBlacklist(userId, blacklistedPhone);
  
  const initialWarmup = await checkWarmupStatus(userId);
  const isBlocked = await isNumberBlacklisted(userId, blacklistedPhone);
  
  assert.strictEqual(isBlocked, true);
  // Verify send count did not increment automatically without send execution
  const postWarmup = await checkWarmupStatus(userId);
  assert.strictEqual(postWarmup.sentToday, initialWarmup.sentToday);
});

// Pairwise 5: Spintax Engine + Auto-Emoji + Smart Delay Rest Pause
tier3Suite.add('Tier 3 - Interaction 5: Spintax with Auto-Emoji formatting alongside Rest Pause', () => {
  const template = '{Good morning|Greetings} team';
  const parsed = parseSpintax(template, { enableSpintax: true, enableAutoEmoji: true });
  
  const delayInfo = calculateSmartDelayMs({ burst_interval_messages: '2', burst_pause_seconds: '30' }, 2);
  
  assert.match(parsed, /(Good morning|Greetings) team/);
  assert.strictEqual(delayInfo.isRestPause, true);
  assert.ok(delayInfo.pauseSeconds >= 25 && delayInfo.pauseSeconds <= 35);
});

// Pairwise 6: Night Quiet Hours + Health Score Monitor
tier3Suite.add('Tier 3 - Interaction 6: Night Quiet Hours status independently verified alongside Health Score', async () => {
  const userId = 781;
  await ensureTestUser(userId);
  const settings = { enable_night_pause: 'false', enable_health_monitoring: 'true' };
  
  const isNight = (await import('../backend/services/antiBanService.js')).isNightQuietHours(settings);
  const health = await calculateHealthScore(userId, settings);
  
  assert.strictEqual(isNight, false);
  assert.strictEqual(health.isEnabled, true);
});

// Pairwise 7: Warmup Daily Limit Exceeded + Health Score Risk Escalation
tier3Suite.add('Tier 3 - Interaction 7: Exceeding warmup daily limit drops health score to High Risk / Caution', async () => {
  const userId = 782;
  await ensureTestUser(userId);
  const todayStr = new Date().toISOString().split('T')[0];
  
  // Set send tracker to exceeded limit
  await run(`
    INSERT INTO daily_send_tracker (user_id, date_str, sent_count)
    VALUES (?, ?, 100)
    ON CONFLICT(user_id, date_str) DO UPDATE SET sent_count = 100
  `, [userId, todayStr]);
  
  const health = await calculateHealthScore(userId, { enable_number_warmup: 'true', warmup_stage1_limit: '20' });
  
  assert.ok(health.healthScore <= 70, `Health score ${health.healthScore} should be reduced due to exceeded limit`);
  assert.ok(health.deductions.some(d => d.includes('Exceeded daily warmup limit')));
});

// Pairwise 8: Blacklist Removal + Re-Checking Contact Dispatch Eligibility
tier3Suite.add('Tier 3 - Interaction 8: Removing phone from Blacklist restores message dispatch eligibility', async () => {
  const userId = 783;
  await ensureTestUser(userId);
  const phone = '919876500009';
  
  await addNumberToBlacklist(userId, phone, 'Temporary opt-out');
  const blockedBefore = await isNumberBlacklisted(userId, phone);
  assert.strictEqual(blockedBefore, true);
  
  // Remove from blacklist in database
  await run('DELETE FROM blacklisted_numbers WHERE user_id = ? AND phone = ?', [userId, phone]);
  const blockedAfter = await isNumberBlacklisted(userId, phone);
  assert.strictEqual(blockedAfter, false, 'Phone should no longer be blacklisted after removal');
});

// Pairwise 9: Smart Rate Limiter Disabled Fallback + Fixed Delay
tier3Suite.add('Tier 3 - Interaction 9: Smart Rate Limiter disabled uses exact fixed delay parameter', () => {
  const settings = { enable_smart_rate_limiter: 'false', delay_seconds: '12' };
  const res = calculateSmartDelayMs(settings, 10);
  assert.strictEqual(res.delayMs, 12000);
  assert.strictEqual(res.isRestPause, false);
});
