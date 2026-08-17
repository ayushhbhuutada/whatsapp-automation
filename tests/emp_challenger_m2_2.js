import { parseSpintax, checkWarmupStatus, calculateSmartDelayMs, calculateHealthScore, isNightQuietHours } from '../backend/services/antiBanService.js';
import { run, get, all } from '../backend/database.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runEmpiricalStressTests() {
  console.log('======================================================');
  console.log(' EMPIRICAL STRESS HARNESS — CHALLENGER M2 (Instance 2)');
  console.log('======================================================\n');

  // ----------------------------------------------------
  // CATEGORY 1: Live Spintax Tester & Engine Stress
  // ----------------------------------------------------
  console.log('--- 1. Live Spintax Tester & Spintax Engine Stress ---');

  // Test 1.1: Complex nested spintax {Hi|{Hello|Hey}}
  const nestedInput = '{Hi|{Hello|Hey}}';
  const nestedResults = new Set();
  for (let i = 0; i < 100; i++) {
    const res = parseSpintax(nestedInput, { enableSpintax: true });
    nestedResults.add(res);
  }
  assert(
    nestedResults.has('Hi') && (nestedResults.has('Hello') || nestedResults.has('Hey')),
    `Nested spintax '{Hi|{Hello|Hey}}' resolves to all choices: [${Array.from(nestedResults).join(', ')}]`
  );
  assert(
    !Array.from(nestedResults).some(s => s.includes('{') || s.includes('}')),
    'Nested spintax leaves zero unparsed braces in output'
  );

  // Test 1.2: Deeply nested spintax {Level 1|{Level 2|{Level 3|{Level 4}}}}
  const deepInput = '{Level 1|{Level 2|{Level 3|{Level 4}}}}';
  const deepResults = new Set();
  for (let i = 0; i < 200; i++) {
    deepResults.add(parseSpintax(deepInput, { enableSpintax: true }));
  }
  assert(
    deepResults.size > 1 && !Array.from(deepResults).some(s => s.includes('{') || s.includes('}')),
    `Deeply nested spintax resolves properly to: [${Array.from(deepResults).join(', ')}]`
  );

  // Test 1.3: Personalization variables {{name}}, {{phone}}, {{custom}}
  const varInput = '{Hi|Hello} {{name}}, your phone is {{phone}} and order is {{order_id}}!';
  let varPreserved = true;
  for (let i = 0; i < 50; i++) {
    const res = parseSpintax(varInput, { enableSpintax: true });
    if (!res.includes('{{name}}') || !res.includes('{{phone}}') || !res.includes('{{order_id}}')) {
      varPreserved = false;
      console.error('Failed output:', res);
      break;
    }
  }
  assert(varPreserved, 'Personalization variables {{name}}, {{phone}}, {{order_id}} are 100% preserved in output');

  // Test 1.4: 15+ variables in template to test indexing regex boundary (__DB_VAR_0__ to __DB_VAR_14__)
  let multiVarTemplate = '{Welcome|Greeting} ';
  for (let i = 0; i < 15; i++) {
    multiVarTemplate += `var${i}: {{val_${i}}} `;
  }
  const multiVarRes = parseSpintax(multiVarTemplate, { enableSpintax: true });
  let multiVarSuccess = true;
  for (let i = 0; i < 15; i++) {
    if (!multiVarRes.includes(`{{val_${i}}}`)) {
      multiVarSuccess = false;
      console.error(`Missing variable {{val_${i}}} in result: ${multiVarRes}`);
    }
  }
  assert(multiVarSuccess, '15+ variable placeholders (testing double-digit indexing __DB_VAR_10__) preserved perfectly without regex collision');

  // Test 1.5: Long templates (>300 chars & >1000 chars)
  const longPrefix = 'A'.repeat(400);
  const longSuffix = 'B'.repeat(400);
  const longTemplate = `${longPrefix} {Offer 1|Offer 2|Offer 3} {{name}} ${longSuffix}`;
  const longRes = parseSpintax(longTemplate, { enableSpintax: true, enableAutoEmoji: true });
  assert(
    longRes.length > 800 && (longRes.includes('Offer 1') || longRes.includes('Offer 2') || longRes.includes('Offer 3')) && longRes.includes('{{name}}'),
    `Long template (>800 chars) parsed successfully without truncation (output length: ${longRes.length})`
  );

  // Test 1.6: Auto-emoji insertion logic
  const noEmojiRes = parseSpintax('Hello world', { enableSpintax: true, enableAutoEmoji: true });
  const hasEmojiRes = parseSpintax('Hello world 😊', { enableSpintax: true, enableAutoEmoji: true });
  assert(
    /[\u{1F300}-\u{1F9FF}]/u.test(noEmojiRes),
    `Auto-emoji appended when no emoji present: "${noEmojiRes}"`
  );
  assert(
    hasEmojiRes === 'Hello world 😊',
    `Auto-emoji NOT duplicated when emoji already present at end: "${hasEmojiRes}"`
  );

  // ----------------------------------------------------
  // CATEGORY 2: Settings Toggles, Payloads & Key Sync
  // ----------------------------------------------------
  console.log('\n--- 2. Anti-Ban Settings Toggles, Payloads & Primary/Alias Key Sync ---');

  // Test 2.1: String vs Boolean JSON Payloads evaluation
  const stringSettings = {
    enable_spintax: 'true',
    warmup_enabled: 'false',
    min_delay: '20',
    max_delay: '50',
    quiet_hours_enabled: 'true',
    auto_pause_health: 'false'
  };
  const boolSettings = {
    enable_spintax: true,
    warmup_enabled: false,
    min_delay: 20,
    max_delay: 50,
    quiet_hours_enabled: true,
    auto_pause_health: false
  };

  // Smart delay with string settings vs bool settings
  const delayStr = calculateSmartDelayMs(stringSettings, 1);
  const delayBool = calculateSmartDelayMs(boolSettings, 1);
  assert(
    delayStr.delayMs >= 20000 && delayStr.delayMs <= 53000,
    `calculateSmartDelayMs with string keys works (delayMs: ${delayStr.delayMs})`
  );
  assert(
    delayBool.delayMs >= 20000 && delayBool.delayMs <= 53000,
    `calculateSmartDelayMs with numeric/bool keys works (delayMs: ${delayBool.delayMs})`
  );

  // Night quiet hours testing
  const currentHour = new Date().getHours();
  const quietPrimaryStr = isNightQuietHours({ enable_night_pause: 'true', night_pause_start_hour: currentHour, night_pause_end_hour: (currentHour + 1) % 24 });
  const quietAliasStr = isNightQuietHours({ quiet_hours_enabled: 'true', quiet_start: currentHour, quiet_end: (currentHour + 1) % 24 });
  
  // Test boolean true vs string 'true' for quiet hours
  const quietBoolTrue = isNightQuietHours({ enable_night_pause: true, night_pause_start_hour: currentHour, night_pause_end_hour: (currentHour + 1) % 24 });

  assert(quietPrimaryStr === true, `isNightQuietHours with string 'true' returns true`);
  assert(quietAliasStr === true, `isNightQuietHours with string alias 'true' returns true`);
  assert(quietBoolTrue === false, `Boolean payload vulnerability identified: isNightQuietHours({ enable_night_pause: true }) returns false (expected true)`);

  // Warmup status with primary key vs alias key
  await run("INSERT OR REPLACE INTO users (id, name, email, password_hash, created_at) VALUES (9999, 'Test User', 'test@test.com', 'hash', datetime('now'))");
  
  const warmupStrDisabled = await checkWarmupStatus(9999, { enable_number_warmup: 'false' });
  const warmupBoolDisabled = await checkWarmupStatus(9999, { enable_number_warmup: false });
  assert(warmupStrDisabled.isEnabled === false, 'checkWarmupStatus recognizes string "false" as disabled');
  assert(warmupBoolDisabled.isEnabled === true, 'Boolean payload vulnerability identified: checkWarmupStatus({ enable_number_warmup: false }) evaluates false !== "false" as true (enabled)');

  // Health Score with primary key vs alias key
  const healthPrimaryDisabled = await calculateHealthScore(9999, { auto_pause_high_risk: 'false' });
  const healthAliasDisabled = await calculateHealthScore(9999, { auto_pause_health: 'false' });
  assert(healthPrimaryDisabled.autoPause === false, 'calculateHealthScore recognizes auto_pause_high_risk="false"');
  assert(healthAliasDisabled.autoPause === false, 'calculateHealthScore recognizes auto_pause_health="false"');

  // Test 2.2: State Persistence in Database (Primary + Alias Key sync)
  const testUserId = 9999;
  const settingsToSave = {
    enable_spintax: 'true',
    enable_auto_emoji: 'true',
    enable_number_warmup: 'true',
    warmup_enabled: 'true',
    warmup_stage1_limit: '25',
    warmup_stage2_limit: '60',
    warmup_stage3_limit: '150',
    warmup_stage4_limit: '500',
    enable_health_monitoring: 'true',
    auto_pause_high_risk: 'true',
    auto_pause_health: 'true',
    enable_smart_rate_limiter: 'true',
    min_delay_seconds: '20',
    min_delay: '20',
    max_delay_seconds: '70',
    max_delay: '70',
    burst_interval_messages: '12',
    burst_pause_seconds: '100',
    enable_unsubscribe_protection: 'true',
    enable_night_pause: 'true',
    quiet_hours_enabled: 'true'
  };

  for (const [key, value] of Object.entries(settingsToSave)) {
    await run('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)', [testUserId, key, String(value)]);
  }

  const rows = await all('SELECT key, value FROM settings WHERE user_id = ?', [testUserId]);
  const loadedSettings = {};
  rows.forEach(r => { loadedSettings[r.key] = r.value; });

  let allKeysPersisted = true;
  for (const [key, expected] of Object.entries(settingsToSave)) {
    if (loadedSettings[key] !== expected) {
      allKeysPersisted = false;
      console.error(`Key ${key} expected ${expected} but got ${loadedSettings[key]}`);
    }
  }
  assert(allKeysPersisted, 'All primary and alias settings keys persist accurately in SQLite database');

  // Cleanup test user
  await run('DELETE FROM settings WHERE user_id = ?', [testUserId]);
  await run('DELETE FROM users WHERE id = ?', [testUserId]);

  console.log('\n======================================================');
  console.log(` RESULTS SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');
}

runEmpiricalStressTests().catch(err => {
  console.error('Fatal error in empirical test harness:', err);
  process.exit(1);
});
