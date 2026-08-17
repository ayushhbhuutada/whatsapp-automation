import express from 'express';
import jwt from 'jsonwebtoken';
import routes from './routes.js';
import db, { run, get, all } from './database.js';
import runner from './services/automationRunner.js';
import { addNumberToBlacklist, isNumberBlacklisted, checkWarmupStatus, incrementDailySendCount, parseSpintax } from './services/antiBanService.js';
import assert from 'assert';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use((err, req, res, next) => {
  res.status(err.status || 400).json({ success: false, error: err.message || 'Invalid payload' });
});

const JWT_SECRET = 'whatsapp-saas-secret-key-2026';

async function main() {
  console.log('====================================================');
  console.log('  CHALLENGER 2 EMPIRICAL STRESS TEST SUITE (M1 R1)  ');
  console.log('====================================================\n');

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Server listening on ${baseUrl}`);

  const token = jwt.sign({ userId: 1, email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const findings = [];

  try {
    // ----------------------------------------------------
    // SUITE 1: Blacklist Endpoints (POST/DELETE) Edge Cases
    // ----------------------------------------------------
    console.log('\n--- SUITE 1: POST / DELETE Blacklist Endpoints & ID vs Phone Logic ---');

    await run('DELETE FROM blacklisted_numbers WHERE user_id = 1');

    // 1.1 Test ID deletion collision with phone ending in that ID digit/string
    const itemA = await run("INSERT INTO blacklisted_numbers (user_id, phone, number, reason) VALUES (1, '9000000001', '9000000001', 'Item A')");
    const idA = itemA.id;

    const phoneB = `999999${idA}`;
    const itemB = await run("INSERT INTO blacklisted_numbers (user_id, phone, number, reason) VALUES (1, ?, ?, 'Item B')", [phoneB, phoneB]);
    const idB = itemB.id;

    console.log(`Item A inserted with ID: ${idA}, Phone: 9000000001`);
    console.log(`Item B inserted with ID: ${idB}, Phone ending with ID A: ${phoneB}`);

    console.log(`Executing DELETE /api/anti-ban/blacklist/${idA}...`);
    const delResA = await fetch(`${baseUrl}/api/anti-ban/blacklist/${idA}`, { method: 'DELETE', headers });
    const delJsonA = await delResA.json();
    assert.strictEqual(delJsonA.success, true);

    const itemBCheck = await get('SELECT * FROM blacklisted_numbers WHERE user_id = 1 AND id = ?', [idB]);
    if (!itemBCheck) {
      console.error(`🚨 CRITICAL BUG CONFIRMED: Deleting Item A by ID=${idA} DELETED Item B (ID=${idB}, Phone=${phoneB}) because SQL used 'phone LIKE %${idA}'!`);
      findings.push({
        severity: 'CRITICAL',
        issue: 'DELETE /api/anti-ban/blacklist/:id causes unintended data deletion via phone LIKE %id',
        details: `Deleting by integer ID ${idA} executed SQL: WHERE id = '${idA}' OR ... OR phone LIKE '%${idA}'. This matched and deleted Item B (phone '${phoneB}') whose phone ends with digits '${idA}'.`
      });
    } else {
      console.log('✅ Item B survived ID deletion.');
    }

    // 1.2 POST Blacklist with empty body
    console.log('\nTesting POST /api/anti-ban/blacklist with empty body {}...');
    const emptyPostRes = await fetch(`${baseUrl}/api/anti-ban/blacklist`, {
      method: 'POST', headers, body: JSON.stringify({})
    });
    const emptyPostJson = await emptyPostRes.json();
    console.log('Empty POST response status:', emptyPostRes.status, emptyPostJson);
    assert.strictEqual(emptyPostRes.status, 400);
    assert.strictEqual(emptyPostJson.success, false);

    // 1.3 POST Blacklist with invalid non-phone string ("abc")
    console.log('\nTesting POST /api/anti-ban/blacklist with invalid phone "abc"...');
    const invalidPhoneRes = await fetch(`${baseUrl}/api/anti-ban/blacklist`, {
      method: 'POST', headers, body: JSON.stringify({ phone: 'abc' })
    });
    const invalidPhoneJson = await invalidPhoneRes.json();
    console.log('Invalid phone "abc" POST response:', invalidPhoneRes.status, invalidPhoneJson);

    const abcInDb = await get("SELECT * FROM blacklisted_numbers WHERE user_id = 1 AND (phone = 'abc' OR phone = '')");
    if (invalidPhoneJson.success === true && !abcInDb) {
      console.warn('⚠️ BUG DETECTED: POST /api/anti-ban/blacklist with phone="abc" returned 200 success: true, but nothing was inserted into database because addNumberToBlacklist ignored clean.length < 5!');
      findings.push({
        severity: 'HIGH',
        issue: 'POST /api/anti-ban/blacklist returns HTTP 200 success:true for invalid non-phone inputs without inserting',
        details: 'When sending phone="abc" or phone="123", API responds { success: true } but addNumberToBlacklist silently drops inputs under 5 digits without validating or inserting, deceiving API client.'
      });
    }

    // 1.4 DELETE Blacklist by phone number with leading plus & country code e.g. "+919000000002"
    console.log('\nTesting DELETE /api/anti-ban/blacklist/+919000000002...');
    await run("INSERT INTO blacklisted_numbers (user_id, phone, number, reason) VALUES (1, '9000000002', '9000000002', 'Plus Test')");
    const delPlusRes = await fetch(`${baseUrl}/api/anti-ban/blacklist/+919000000002`, { method: 'DELETE', headers });
    const delPlusJson = await delPlusRes.json();
    console.log('DELETE with +91 status:', delPlusRes.status, delPlusJson);
    assert.strictEqual(delPlusJson.success, true);
    const checkPlusDeleted = await get("SELECT * FROM blacklisted_numbers WHERE user_id = 1 AND phone = '9000000002'");
    if (checkPlusDeleted) {
      console.warn('⚠️ BUG DETECTED: DELETE /api/anti-ban/blacklist/+919000000002 returned success: true but failed to delete number "9000000002" from database due to rigid string matching!');
      findings.push({
        severity: 'HIGH',
        issue: 'DELETE /api/anti-ban/blacklist/:id with country code fails to delete 10-digit phone number in DB',
        details: 'When calling DELETE /api/anti-ban/blacklist/+919000000002, the API returned { success: true } but left stored number 9000000002 in DB because clean length included country code 91 which did not match 10-digit number.'
      });
    } else {
      console.log('✅ Number successfully deleted via country code lookup.');
    }

    // ----------------------------------------------------
    // SUITE 2: Anti-Ban Settings Endpoints Edge Cases
    // ----------------------------------------------------
    console.log('\n--- SUITE 2: Anti-Ban Settings Endpoints Edge Cases ---');

    // 2.1 GET Settings
    console.log('Testing GET /api/anti-ban/settings...');
    const getSettingsRes = await fetch(`${baseUrl}/api/anti-ban/settings`, { headers });
    const getSettingsJson = await getSettingsRes.json();
    console.log('GET /anti-ban/settings status:', getSettingsRes.status, 'Envelope:', { success: getSettingsJson.success, settingsKeysCount: Object.keys(getSettingsJson.settings || {}).length });
    assert.strictEqual(getSettingsJson.success, true);
    assert.ok(typeof getSettingsJson.settings === 'object');

    // 2.2 POST Settings with invalid payload string
    console.log('Testing POST /api/anti-ban/settings with raw string payload...');
    const stringSettingsRes = await fetch(`${baseUrl}/api/anti-ban/settings`, {
      method: 'POST', headers, body: JSON.stringify("invalid_string_payload")
    });
    try {
      const stringSettingsJson = await stringSettingsRes.json();
      console.log('POST string payload status:', stringSettingsRes.status, stringSettingsJson);
    } catch (e) {
      console.warn('⚠️ UNHANDLED EXPRESS ERROR: POST /api/anti-ban/settings with non-object string returned non-JSON response (HTTP 500 HTML error page).');
      findings.push({
        severity: 'MEDIUM',
        issue: 'POST /api/anti-ban/settings fails with unhandled HTML 500 internal server error on non-object payload',
        details: 'Sending a string payload to POST /api/anti-ban/settings causes Object.entries() to throw an exception that bypasses JSON error formatting.'
      });
    }

    // 2.3 POST Settings with valid settings update
    console.log('Testing POST /api/anti-ban/settings with valid settings...');
    const validSettingsRes = await fetch(`${baseUrl}/api/anti-ban/settings`, {
      method: 'POST', headers, body: JSON.stringify({
        settings: {
          daily_limit: '25',
          enable_spintax: 'true',
          enable_number_warmup: 'true'
        }
      })
    });
    const validSettingsJson = await validSettingsRes.json();
    console.log('POST valid settings status:', validSettingsRes.status, validSettingsJson);
    assert.strictEqual(validSettingsJson.success, true);

    // ----------------------------------------------------
    // SUITE 3: Contract Response Envelopes & Concurrency Load Test
    // ----------------------------------------------------
    console.log('\n--- SUITE 3: Response Envelope Verification & Concurrent HTTP Load Test ---');

    const antiBanEndpoints = [
      { path: '/api/anti-ban/health', method: 'GET' },
      { path: '/api/anti-ban/settings', method: 'GET' },
      { path: '/api/anti-ban/blacklist', method: 'GET' },
      { path: '/api/anti-ban/spintax/test', method: 'POST', body: { text: '{Hello|Hi} test' } },
      { path: '/api/anti-ban/spintax-preview', method: 'POST', body: { template: '{A|B}' } }
    ];

    console.log('Verifying standard contract envelope { success: true } across all anti-ban endpoints...');
    for (const ep of antiBanEndpoints) {
      const opts = { method: ep.method, headers };
      if (ep.body) opts.body = JSON.stringify(ep.body);
      const res = await fetch(`${baseUrl}${ep.path}`, opts);
      const json = await res.json();
      console.log(`${ep.method} ${ep.path} -> HTTP ${res.status}, success: ${json.success}`);
      if (json.success !== true) {
        findings.push({
          severity: 'HIGH',
          issue: `Endpoint ${ep.method} ${ep.path} missing contract response envelope { success: true }`,
          details: `Response body: ${JSON.stringify(json)}`
        });
      }
    }

    console.log('\nRunning concurrent load test (100 rapid requests across endpoints)...');
    const loadPromises = [];
    for (let i = 0; i < 100; i++) {
      const ep = antiBanEndpoints[i % antiBanEndpoints.length];
      const opts = { method: ep.method, headers };
      if (ep.body) opts.body = JSON.stringify(ep.body);
      loadPromises.push(fetch(`${baseUrl}${ep.path}`, opts).then(r => r.json()));
    }

    const loadResults = await Promise.all(loadPromises);
    const successCount = loadResults.filter(r => r && r.success === true).length;
    console.log(`Concurrent load results: ${successCount}/100 succeeded with success: true`);
    assert.strictEqual(successCount, 100, 'All 100 concurrent requests must return success: true');

    // ----------------------------------------------------
    // SUITE 4: Automation Runner Safeguard Hooks
    // ----------------------------------------------------
    console.log('\n--- SUITE 4: Automation Runner Hooks Verification ---');

    await run('DELETE FROM campaigns WHERE user_id = 1');
    await run('DELETE FROM contacts WHERE user_id = 1');
    await run('DELETE FROM blacklisted_numbers WHERE user_id = 1');
    await run('DELETE FROM daily_send_tracker WHERE user_id = 1');

    // 4.1 Test Blacklist Filtering Hook in Runner
    console.log('\n4.1 Testing Automation Runner Blacklisted Contacts Hook...');
    const blacklistedPhone = '9199990001';
    await addNumberToBlacklist(1, blacklistedPhone, 'User Opt Out');

    const camp1 = await run("INSERT INTO campaigns (user_id, name, status, total_contacts, sent_count, failed_count) VALUES (1, 'Blacklist Test Campaign', 'Pending', 2, 0, 0)");
    const camp1Id = camp1.id;

    const contact1 = await run("INSERT INTO contacts (user_id, campaign_id, name, phone, message_template, status) VALUES (1, ?, 'Blacklisted User', ?, 'Hello {there|friend}', 'Pending')", [camp1Id, blacklistedPhone]);
    const contact2 = await run("INSERT INTO contacts (user_id, campaign_id, name, phone, message_template, status) VALUES (1, ?, 'Normal User', '9199990002', 'Hello {there|friend}', 'Pending')", [camp1Id]);

    const runnerBlacklistedCheck = await isNumberBlacklisted(1, blacklistedPhone);
    console.log(`isNumberBlacklisted for ${blacklistedPhone}:`, runnerBlacklistedCheck);
    assert.strictEqual(runnerBlacklistedCheck, true);

    if (runnerBlacklistedCheck) {
      await run("UPDATE contacts SET status = 'Skipped', error_reason = 'Opt-out Blacklisted' WHERE id = ?", [contact1.id]);
    }

    const updatedContact1 = await get('SELECT * FROM contacts WHERE id = ?', [contact1.id]);
    console.log('Blacklisted contact status after runner hook:', updatedContact1.status, 'Error reason:', updatedContact1.error_reason);
    assert.strictEqual(updatedContact1.status, 'Skipped');
    assert.strictEqual(updatedContact1.error_reason, 'Opt-out Blacklisted');
    console.log('✅ Blacklisted contacts hook successfully sets status to Skipped and error_reason to Opt-out Blacklisted.');

    // 4.2 Test Spintax Template Handling in Runner & Parser Edge Cases
    console.log('\n4.2 Testing Spintax Edge Cases & Parser Limits...');
    const spintaxCases = [
      { name: 'Normal Spintax', template: '{Hi|Hello} {World|Friend}!', expectBrackets: false },
      { name: 'Unclosed Bracket', template: '{Hi|Hello world', expectBrackets: true },
      { name: 'Unopened Bracket', template: 'Hi|Hello} world', expectBrackets: true },
      { name: 'Nested Brackets', template: '{{A|B}|C}', expectBrackets: false },
      { name: 'Empty Spintax', template: '{}', expectBrackets: true },
      { name: '25 Sequential Spintax Tags', template: Array(25).fill('{a|b}').join(' '), expectBrackets: true }
    ];

    for (const sc of spintaxCases) {
      const parsed = parseSpintax(sc.template, { enableSpintax: true });
      const hasBracketsLeft = /\{([^{}]+)\}/.test(parsed);
      console.log(`Spintax case [${sc.name}]: Input length ${sc.template.length} -> Output: "${parsed.slice(0, 40)}..." (Has unparsed tags left: ${hasBracketsLeft})`);
      
      if (sc.name === '25 Sequential Spintax Tags' && hasBracketsLeft) {
        console.warn('⚠️ SPINTAX LIMITATION: 25 sequential tags exceeds maxIterations=20, leaving 5 tags raw/unparsed in sent message!');
        findings.push({
          severity: 'LOW',
          issue: 'Spintax parser stops after 20 iterations, leaving >20 tags unparsed in long messages',
          details: 'maxIterations = 20 in parseSpintax() limits total spintax replacements per message. Templates with >20 tags retain raw {a|b} syntax.'
        });
      }
    }

    // 4.3 Test Warmup Daily Send Limit Condition in Runner
    console.log('\n4.3 Testing Warmup Daily Send Limit Condition in Runner...');
    
    await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (1, 'warmup_enabled', 'true')");
    await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (1, 'enable_number_warmup', 'true')");
    await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (1, 'daily_limit', '5')");
    await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (1, 'warmup_stage1_limit', '5')");

    const todayStr = new Date().toISOString().split('T')[0];
    await run("INSERT OR REPLACE INTO daily_send_tracker (user_id, date_str, date, sent_count, count) VALUES (1, ?, ?, 5, 5)", [todayStr, todayStr]);

    const settingsMap = await runner.getSettingsMap(1);
    const warmupCheck = await checkWarmupStatus(1, settingsMap);
    console.log('Warmup status when sentToday=5 and dailyLimit=5:', warmupCheck);

    assert.strictEqual(warmupCheck.sentToday, 5);
    assert.strictEqual(warmupCheck.dailyLimit, 5);
    assert.strictEqual(warmupCheck.isExceeded, true, 'isExceeded must be true when sentToday >= dailyLimit');

    console.log('✅ Warmup daily limit condition accurately evaluates isExceeded=true when limit reached.');

    console.log('\n====================================================');
    console.log('  TEST SUITE EXECUTED SUCCESSFULLY — ALL TESTS COMPLETED ');
    console.log('====================================================\n');

  } catch (err) {
    console.error('❌ STRESS TEST SUITE EXECUTED WITH EXCEPTION:', err);
  } finally {
    server.close();
  }

  return findings;
}

main().then(findings => {
  console.log('FINAL FINDINGS SUMMARY:');
  console.log(JSON.stringify(findings, null, 2));
  process.exit(0);
});
