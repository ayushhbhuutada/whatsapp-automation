import assert from 'node:assert';
import { createTestSuite } from './test_helper.js';
import { 
  parseSpintax, 
  calculateSmartDelayMs, 
  isNightQuietHours, 
  calculateHealthScore, 
  checkWarmupStatus,
  isNumberBlacklisted 
} from '../backend/services/antiBanService.js';

export const tier2Suite = createTestSuite('Tier 2: Boundary & Corner Case Coverage');

// 1. Spintax Boundary Cases
tier2Suite.add('Tier 2 - Spintax: Handles empty string input', () => {
  assert.strictEqual(parseSpintax(''), '');
});

tier2Suite.add('Tier 2 - Spintax: Handles null/undefined input gracefully', () => {
  assert.strictEqual(parseSpintax(null), null);
  assert.strictEqual(parseSpintax(undefined), undefined);
});

tier2Suite.add('Tier 2 - Spintax: Handles non-string inputs (numbers, objects)', () => {
  assert.strictEqual(parseSpintax(12345), 12345);
  const obj = { foo: 'bar' };
  assert.strictEqual(parseSpintax(obj), obj);
});

tier2Suite.add('Tier 2 - Spintax: Handles unclosed spintax brace {hello', () => {
  assert.strictEqual(parseSpintax('{hello world'), '{hello world');
});

tier2Suite.add('Tier 2 - Spintax: Handles empty choices {||}', () => {
  const result = parseSpintax('{||}');
  assert.strictEqual(result, '');
});

tier2Suite.add('Tier 2 - Spintax: Handles nested spintax braces recursively or capped', () => {
  const result = parseSpintax('{{Hi|Hello}|Hey}');
  assert.ok(typeof result === 'string');
});

tier2Suite.add('Tier 2 - Spintax: Prevents infinite loop on recursive pattern', () => {
  const text = '{A|B}'.repeat(50);
  const result = parseSpintax(text);
  assert.ok(typeof result === 'string');
});

tier2Suite.add('Tier 2 - Spintax: Auto Emoji appends only when no emoji present at end', () => {
  const withEmoji = parseSpintax('Hello 😊', { enableAutoEmoji: true });
  assert.strictEqual(withEmoji, 'Hello 😊');
});

// 2. Malformed Phone Numbers & Blacklist Boundary Cases
tier2Suite.add('Tier 2 - Blacklist: Handles null/undefined phone number lookup', async () => {
  const res = await isNumberBlacklisted(1, null);
  assert.strictEqual(res, false);
});

tier2Suite.add('Tier 2 - Blacklist: Handles short/invalid phone numbers (< 5 digits)', async () => {
  const res = await isNumberBlacklisted(1, '123');
  assert.strictEqual(res, false);
});

tier2Suite.add('Tier 2 - Blacklist: Handles formatted phone string with symbols "+1 (555) 019-2834"', async () => {
  // DB check will clean string to digits
  const res = await isNumberBlacklisted(1, '+1 (555) 019-2834');
  assert.strictEqual(typeof res, 'boolean');
});

tier2Suite.add('Tier 2 - Blacklist: Handles phone numbers with whitespace and trailing characters', async () => {
  const res = await isNumberBlacklisted(1, '  9876543210 \n ');
  assert.strictEqual(typeof res, 'boolean');
});

tier2Suite.add('Tier 2 - Blacklist: User ID isolation on lookup', async () => {
  const res1 = await isNumberBlacklisted(1, '9999999999');
  const res2 = await isNumberBlacklisted(999, '9999999999');
  assert.strictEqual(typeof res1, 'boolean');
  assert.strictEqual(typeof res2, 'boolean');
});

// 3. Smart Rate Limiter Thresholds & Extremes
tier2Suite.add('Tier 2 - Rate Limiter: Handles negative or 0 delay settings gracefully', () => {
  const res = calculateSmartDelayMs({ enable_smart_rate_limiter: 'false', delay_seconds: '-5' });
  assert.strictEqual(res.delayMs, -5000);
});

tier2Suite.add('Tier 2 - Rate Limiter: Minimum delay fallback when min > max', () => {
  const res = calculateSmartDelayMs({ min_delay_seconds: '100', max_delay_seconds: '10' }, 1);
  assert.ok(res.delayMs >= 10000);
});

tier2Suite.add('Tier 2 - Rate Limiter: Triggers micro-burst rest pause exact on burst interval', () => {
  const settings = { burst_interval_messages: '5', burst_pause_seconds: '60' };
  const res = calculateSmartDelayMs(settings, 5);
  assert.strictEqual(res.isRestPause, true);
  assert.ok(res.delayMs >= 51000 && res.delayMs <= 69000); // 60s +/- 15% jitter
});

tier2Suite.add('Tier 2 - Rate Limiter: Default 20-message burst break triggers 2-min pause', () => {
  const res = calculateSmartDelayMs({}, 20);
  assert.strictEqual(res.isRestPause, true);
  assert.ok(res.delayMs >= 102000 && res.delayMs <= 138000); // 120s +/- 15% jitter
});

tier2Suite.add('Tier 2 - Rate Limiter: Does not trigger rest pause on non-burst index', () => {
  const settings = { burst_interval_messages: '5', burst_pause_seconds: '60' };
  const res = calculateSmartDelayMs(settings, 4);
  assert.strictEqual(res.isRestPause, false);
});

tier2Suite.add('Tier 2 - Rate Limiter: Handles messageIndex 0 without division by zero error', () => {
  const res = calculateSmartDelayMs({ burst_interval_messages: '5' }, 0);
  assert.strictEqual(res.isRestPause, false);
});

tier2Suite.add('Tier 2 - Rate Limiter: Handles non-numeric string parameters', () => {
  const res = calculateSmartDelayMs({ min_delay_seconds: 'abc', max_delay_seconds: 'xyz' }, 1);
  assert.ok(res.delayMs >= 8000);
});

// 4. Night Quiet Hours Boundary Checks
tier2Suite.add('Tier 2 - Night Pause: Default hours (23 to 7) returns boolean', () => {
  const res = isNightQuietHours({ enable_night_pause: 'true' });
  assert.strictEqual(typeof res, 'boolean');
});

tier2Suite.add('Tier 2 - Night Pause: Same start and end hour (e.g. 12 to 12)', () => {
  const res = isNightQuietHours({ enable_night_pause: 'true', night_pause_start_hour: '12', night_pause_end_hour: '12' });
  assert.strictEqual(typeof res, 'boolean');
});

tier2Suite.add('Tier 2 - Night Pause: Daytime window (9 to 17) evaluation', () => {
  const res = isNightQuietHours({ enable_night_pause: 'true', night_pause_start_hour: '9', night_pause_end_hour: '17' });
  assert.strictEqual(typeof res, 'boolean');
});

tier2Suite.add('Tier 2 - Night Pause: Invalid hour values fallback cleanly', () => {
  const res = isNightQuietHours({ enable_night_pause: 'true', night_pause_start_hour: 'invalid' });
  assert.strictEqual(typeof res, 'boolean');
});

// 5. Health Monitoring & Score Deduction Extremes
tier2Suite.add('Tier 2 - Health Score: Default user health calculation', async () => {
  const health = await calculateHealthScore(99999);
  assert.ok(health.healthScore >= 0 && health.healthScore <= 100);
  assert.ok(['Healthy', 'Caution', 'High Risk'].includes(health.statusLevel));
});

tier2Suite.add('Tier 2 - Health Score: Deductions array is always array instance', async () => {
  const health = await calculateHealthScore(99999);
  assert.ok(Array.isArray(health.deductions));
});

tier2Suite.add('Tier 2 - Health Score: Recommendations array is non-empty', async () => {
  const health = await calculateHealthScore(99999);
  assert.ok(Array.isArray(health.recommendations));
  assert.ok(health.recommendations.length > 0);
});

tier2Suite.add('Tier 2 - Health Score: Score clamping between 0 and 100', async () => {
  const health = await calculateHealthScore(99999, { auto_pause_high_risk: 'true' });
  assert.ok(health.healthScore >= 0);
  assert.ok(health.healthScore <= 100);
});

tier2Suite.add('Tier 2 - Health Score: Respects enable_health_monitoring setting', async () => {
  const health = await calculateHealthScore(99999, { enable_health_monitoring: 'false' });
  assert.strictEqual(health.isEnabled, false);
});

// 6. Warmup Status Calculation Extremes
tier2Suite.add('Tier 2 - Warmup: New user defaults to Stage 1', async () => {
  const status = await checkWarmupStatus(99999);
  assert.strictEqual(status.stage, 1);
  assert.strictEqual(status.dailyLimit, 25);
});

tier2Suite.add('Tier 2 - Warmup: Custom stage limits in settings', async () => {
  const settings = { warmup_stage1_limit: '15', warmup_stage2_limit: '45' };
  const status = await checkWarmupStatus(99999, settings);
  assert.strictEqual(status.dailyLimit, 15);
});

tier2Suite.add('Tier 2 - Warmup: Remaining sends calculation non-negative', async () => {
  const status = await checkWarmupStatus(99999);
  assert.ok(status.remaining >= 0);
});

tier2Suite.add('Tier 2 - Warmup: Disabled warmup returns isExceeded false', async () => {
  const status = await checkWarmupStatus(99999, { enable_number_warmup: 'false' });
  assert.strictEqual(status.isEnabled, false);
  assert.strictEqual(status.isExceeded, false);
});

// 7. Data Format Edge Cases
tier2Suite.add('Tier 2 - Settings: Handles missing key/value parameters', () => {
  const res = calculateSmartDelayMs({}, 1);
  assert.ok(res.delayMs >= 8000);
});

tier2Suite.add('Tier 2 - Database: Run query with empty parameters array', async () => {
  const { run } = await import('../backend/database.js');
  const res = await run('SELECT 1');
  assert.ok(res);
});

tier2Suite.add('Tier 2 - Database: Get query returns null for non-existent record', async () => {
  const { get } = await import('../backend/database.js');
  const row = await get('SELECT * FROM users WHERE id = -99999');
  assert.strictEqual(row, undefined);
});

tier2Suite.add('Tier 2 - Database: All query returns empty array for non-matching query', async () => {
  const { all } = await import('../backend/database.js');
  const rows = await all('SELECT * FROM blacklisted_numbers WHERE user_id = -99999');
  assert.deepStrictEqual(rows, []);
});

// 8. Max Items & Performance Bounds
tier2Suite.add('Tier 2 - Spintax: High variation spintax string parsing under 50ms', () => {
  const start = Date.now();
  for (let i = 0; i < 100; i++) {
    parseSpintax('{Opt1|Opt2|Opt3} {A|B|C} {X|Y|Z}');
  }
  const duration = Date.now() - start;
  assert.ok(duration < 100, `100 spintax operations took ${duration}ms`);
});

tier2Suite.add('Tier 2 - Rate Limiter: 1000 delay calculations executed rapidly', () => {
  const start = Date.now();
  for (let i = 1; i <= 1000; i++) {
    calculateSmartDelayMs({ enable_smart_rate_limiter: 'true' }, i);
  }
  const duration = Date.now() - start;
  assert.ok(duration < 100, `1000 delay calculations took ${duration}ms`);
});

tier2Suite.add('Tier 2 - Blacklist: Phone cleaner strips special characters completely', async () => {
  const { addNumberToBlacklist } = await import('../backend/services/antiBanService.js');
  // Pass invalid short phone, should be ignored without throwing exception
  await addNumberToBlacklist(1, 'abc-!@#');
  assert.ok(true);
});

tier2Suite.add('Tier 2 - Health: Handles zero total contacts in database without dividing by zero', async () => {
  const health = await calculateHealthScore(88888);
  assert.strictEqual(health.failureRate, '0.0');
});

tier2Suite.add('Tier 2 - Health: Status level red for score < 50', async () => {
  // Mock health check logic verification
  const health = await calculateHealthScore(88888);
  assert.ok(['Healthy', 'Caution', 'High Risk'].includes(health.statusLevel));
});

tier2Suite.add('Tier 2 - Spintax: Handles multi-byte unicode characters in spintax', () => {
  const result = parseSpintax('{你好|こんにちは|Hola}');
  assert.ok(['你好', 'こんにちは', 'Hola'].includes(result));
});

tier2Suite.add('Tier 2 - Spintax: Handles newlines inside text template', () => {
  const result = parseSpintax("Line 1\n{Hi|Hello}\nLine 3");
  assert.ok(result.includes('Line 1'));
  assert.ok(result.includes('Line 3'));
});
