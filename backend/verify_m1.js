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
import assert from 'assert';

async function verifyAll() {
  console.log('=== STARTING MILESTONE 1 BACKEND VERIFICATION ===\n');

  // 1. Verify Database Tables
  console.log('--- 1. Testing Database Schema & Tables ---');
  const tables = await all("SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames = tables.map(t => t.name);
  console.log('Found tables:', tableNames);
  assert(tableNames.includes('blacklisted_numbers'), 'blacklisted_numbers table missing!');
  assert(tableNames.includes('daily_send_tracker'), 'daily_send_tracker table missing!');
  console.log('✅ Tables blacklisted_numbers and daily_send_tracker exist.\n');

  // 2. Verify Seeded Anti-Ban Settings
  console.log('--- 2. Testing Default Anti-Ban Settings Seeding ---');
  const settingsRows = await all("SELECT key, value FROM settings WHERE user_id = 1");
  const settingsMap = {};
  settingsRows.forEach(r => { settingsMap[r.key] = r.value; });
  
  const expectedKeys = [
    'daily_limit', 'warmup_stage1_limit', 'warmup_stage2_limit', 'warmup_stage3_limit', 'warmup_stage4_limit',
    'min_delay', 'min_delay_seconds', 'max_delay', 'max_delay_seconds',
    'warmup_enabled', 'enable_number_warmup',
    'auto_pause_health', 'auto_pause_high_risk',
    'enable_spintax', 'enable_auto_emoji', 'enable_health_monitoring', 'enable_smart_rate_limiter',
    'burst_interval_messages', 'burst_pause_seconds', 'enable_unsubscribe_protection'
  ];

  for (const key of expectedKeys) {
    assert(key in settingsMap, `Setting key '${key}' missing in settings table!`);
  }
  console.log(`✅ All ${expectedKeys.length} anti-ban settings keys successfully seeded.\n`);

  // 3. Verify Anti-Ban Service Functions
  console.log('--- 3. Testing Anti-Ban Service Functions ---');

  // Spintax Parsing test
  const spintaxTemplate = '{Hello|Hi|Greetings} {world|friend}!';
  const parsed1 = parseSpintax(spintaxTemplate, { enableSpintax: true });
  console.log(`Spintax Input: "${spintaxTemplate}" -> Output: "${parsed1}"`);
  assert(!parsed1.includes('{') && !parsed1.includes('}'), 'Spintax tags failed to parse!');

  // Spintax multiple iterations test (regex statefulness test)
  for (let i = 0; i < 10; i++) {
    const res = parseSpintax('{A|B} {C|D} {E|F}', { enableSpintax: true });
    assert(!res.includes('{') && !res.includes('}'), `Spintax failed on iteration ${i}: ${res}`);
  }
  console.log('✅ Spintax engine regex state test passed (10 consecutive iterations with 0 skipped tags).');

  // Warmup Status test
  const warmupStatus = await checkWarmupStatus(1, settingsMap);
  console.log('Warmup Status:', warmupStatus);
  assert(warmupStatus.isEnabled === true, 'Warmup status should be enabled');
  assert(warmupStatus.dailyLimit >= 10, 'Warmup daily limit should be >= 10');
  console.log('✅ Warmup status calculation passed.');

  // Increment Daily Send Count test
  await incrementDailySendCount(1);
  const updatedWarmup = await checkWarmupStatus(1, settingsMap);
  console.log('Updated Warmup Sent Today:', updatedWarmup.sentToday);
  assert(updatedWarmup.sentToday >= 1, 'Daily send tracker increment failed');
  console.log('✅ Daily send count increment passed.');

  // Health Score test (Empty contacts table test)
  const health = await calculateHealthScore(1, settingsMap);
  console.log('Health Score:', health);
  assert(health.success === true, 'Health score response missing success: true');
  assert(typeof health.healthScore === 'number' && !isNaN(health.healthScore), 'Health score must be a valid number');
  console.log('✅ Health score calculation passed.');

  // Smart Delay test
  const delayNormal = calculateSmartDelayMs(settingsMap, 1);
  console.log('Smart Delay (Normal msg 1):', delayNormal);
  assert(typeof delayNormal.delayMs === 'number' && delayNormal.delayMs > 0, 'Smart delay failed');

  const delayBurst = calculateSmartDelayMs(settingsMap, 10);
  console.log('Smart Delay (Burst msg 10):', delayBurst);
  assert(delayBurst.isRestPause === true, 'Smart delay failed to trigger micro-burst rest pause on msg 10');
  console.log('✅ Smart rate limiter & micro-burst rest pause passed.');

  // Blacklist Opt-Out test
  const testPhone = '9876543210';
  await addNumberToBlacklist(1, testPhone, 'Test Opt-Out');
  
  const isBlacklistedClean = await isNumberBlacklisted(1, '9876543210');
  const isBlacklistedWithCountry = await isNumberBlacklisted(1, '+919876543210');
  console.log(`Blacklist lookup for 9876543210: ${isBlacklistedClean}`);
  console.log(`Blacklist lookup for +919876543210: ${isBlacklistedWithCountry}`);
  assert(isBlacklistedClean === true, 'Clean number blacklist check failed');
  assert(isBlacklistedWithCountry === true, 'Country code number blacklist check failed');
  console.log('✅ Blacklist opt-out & country code matching passed.\n');

  console.log('=== ALL MILESTONE 1 VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
}

verifyAll().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exitCode = 1;
});
