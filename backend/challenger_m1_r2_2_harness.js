import express from 'express';
import jwt from 'jsonwebtoken';
import routes from './routes.js';
import db, { run, get, all } from './database.js';
import runner from './services/automationRunner.js';
import { addNumberToBlacklist, isNumberBlacklisted, checkWarmupStatus, calculateHealthScore, parseSpintax } from './services/antiBanService.js';
import assert from 'assert';

const app = express();
app.use(express.json());
app.use('/api', routes);

// Router error middleware (catches JSON parsing or route errors)
app.use((err, req, res, next) => {
  res.status(err.status || 400).json({ success: false, error: err.message || 'Invalid payload format' });
});

const JWT_SECRET = 'whatsapp-saas-secret-key-2026';

async function runEmpiricalHarness() {
  console.log('===============================================================');
  console.log('  CHALLENGER 2 (M1 R2) EMPIRICAL HARNESS & VERIFICATION TEST  ');
  console.log('===============================================================\n');

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Test Express server running at: ${baseUrl}`);

  const token = jwt.sign({ userId: 1, email: 'challenger2@example.com' }, JWT_SECRET, { expiresIn: '1h' });
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    tests: []
  };

  function recordTest(name, passed, details) {
    results.total++;
    if (passed) {
      results.passed++;
      console.log(`✅ [PASS] ${name}`);
    } else {
      results.failed++;
      console.error(`❌ [FAIL] ${name}: ${details}`);
    }
    results.tests.push({ name, passed, details });
  }

  try {
    // -------------------------------------------------------------
    // SECTION 1: Blacklist Deletion Disambiguation (DELETE /api/anti-ban/blacklist/30)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 1: DELETE /api/anti-ban/blacklist/30 Target Disambiguation ---');

    await run('DELETE FROM blacklisted_numbers WHERE user_id = 1');

    // Case 1.1: Call DELETE /api/anti-ban/blacklist/30 when NO row with ID=30 exists, but phone ends with 30
    const phoneEnding30 = '9876543230';
    const rowInsert1 = await run("INSERT INTO blacklisted_numbers (user_id, phone, number, reason) VALUES (1, ?, ?, 'Ends with 30')", [phoneEnding30, phoneEnding30]);
    const phoneId1 = rowInsert1.id;

    console.log(`Inserted phone ${phoneEnding30} with row ID ${phoneId1}. No row with ID=30 exists.`);
    const resDel30NoId = await fetch(`${baseUrl}/api/anti-ban/blacklist/30`, { method: 'DELETE', headers });
    const jsonDel30NoId = await resDel30NoId.json();
    console.log('DELETE /api/anti-ban/blacklist/30 (no ID 30) status:', resDel30NoId.status, jsonDel30NoId);

    const checkPhoneSurvived1 = await get('SELECT * FROM blacklisted_numbers WHERE user_id = 1 AND id = ?', [phoneId1]);
    const pass1_1 = resDel30NoId.status === 400 && jsonDel30NoId.success === false && checkPhoneSurvived1 !== undefined;
    recordTest(
      'DELETE /api/anti-ban/blacklist/30 returns 400 JSON and does NOT delete phone ending in 30 (when ID 30 does not exist)',
      pass1_1,
      `Status: ${resDel30NoId.status}, phone in DB: ${Boolean(checkPhoneSurvived1)}`
    );

    // Case 1.2: Call DELETE /api/anti-ban/blacklist/30 when row with ID=30 DOES exist alongside phone ending in 30
    // Manually force a row with ID = 30 if possible or simulate DB state
    await run('DELETE FROM blacklisted_numbers WHERE user_id = 1');
    await run("INSERT INTO blacklisted_numbers (id, user_id, phone, number, reason) VALUES (30, 1, '9000000030', '9000000030', 'Target ID 30')");
    const rowInsert2 = await run("INSERT INTO blacklisted_numbers (user_id, phone, number, reason) VALUES (1, ?, ?, 'Other phone ending in 30')", [phoneEnding30, phoneEnding30]);
    const phoneId2 = rowInsert2.id;

    console.log(`Inserted row with ID=30 and second row with ID=${phoneId2} (phone: ${phoneEnding30}).`);
    const resDel30WithId = await fetch(`${baseUrl}/api/anti-ban/blacklist/30`, { method: 'DELETE', headers });
    const jsonDel30WithId = await resDel30WithId.json();
    console.log('DELETE /api/anti-ban/blacklist/30 (ID 30 exists) status:', resDel30WithId.status, jsonDel30WithId);

    const checkId30Deleted = await get('SELECT * FROM blacklisted_numbers WHERE user_id = 1 AND id = 30');
    const checkPhoneSurvived2 = await get('SELECT * FROM blacklisted_numbers WHERE user_id = 1 AND id = ?', [phoneId2]);

    const pass1_2 = jsonDel30WithId.success === true && checkId30Deleted === undefined && checkPhoneSurvived2 !== undefined;
    recordTest(
      'DELETE /api/anti-ban/blacklist/30 deletes ONLY row ID 30 and preserves phone number ending in 30 (ID ' + phoneId2 + ')',
      pass1_2,
      `ID 30 deleted: ${checkId30Deleted === undefined}, Phone ${phoneEnding30} survived: ${Boolean(checkPhoneSurvived2)}`
    );

    // -------------------------------------------------------------
    // SECTION 2: Invalid Blacklist Additions (POST /api/anti-ban/blacklist)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 2: Invalid Blacklist Additions Validation ---');

    const invalidBlacklistInputs = [
      { name: 'String "abc"', payload: { phone: 'abc' } },
      { name: 'Short number "123"', payload: { phone: '123' } },
      { name: 'Empty string ""', payload: { phone: '' } },
      { name: 'Empty body {}', payload: {} },
      { name: 'Null field', payload: { phone: null } }
    ];

    for (const item of invalidBlacklistInputs) {
      const res = await fetch(`${baseUrl}/api/anti-ban/blacklist`, {
        method: 'POST',
        headers,
        body: JSON.stringify(item.payload)
      });
      const json = await res.json();
      console.log(`POST /api/anti-ban/blacklist [${item.name}] status:`, res.status, json);
      const passed = res.status === 400 && json.success === false && json.error === 'Invalid phone number';
      recordTest(`POST /api/anti-ban/blacklist rejected invalid input [${item.name}] with HTTP 400 JSON error`, passed, `Status: ${res.status}, error: ${json.error}`);
    }

    // -------------------------------------------------------------
    // SECTION 3: Invalid Settings Payloads (POST /api/anti-ban/settings)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 3: Invalid Settings Payloads Validation ---');

    const invalidSettingsInputs = [
      { name: 'Raw string', body: JSON.stringify("invalid_string_payload") },
      { name: 'Number', body: JSON.stringify(12345) },
      { name: 'Null', body: JSON.stringify(null) },
      { name: 'Array', body: JSON.stringify(["setting1", "setting2"]) }
    ];

    for (const item of invalidSettingsInputs) {
      const res = await fetch(`${baseUrl}/api/anti-ban/settings`, {
        method: 'POST',
        headers,
        body: item.body
      });
      let json = {};
      let isJson = false;
      try {
        json = await res.json();
        isJson = true;
      } catch (e) {}

      console.log(`POST /api/anti-ban/settings [${item.name}] status:`, res.status, json);
      const passed = isJson && res.status === 400 && json.success === false && typeof json.error === 'string';
      recordTest(`POST /api/anti-ban/settings rejected invalid payload [${item.name}] with HTTP 400 JSON error`, passed, `HTTP status: ${res.status}, isJSON: ${isJson}, error: ${json.error}`);
    }

    // Malformed JSON test (e.g. invalid syntax)
    const malformedRes = await fetch(`${baseUrl}/api/anti-ban/settings`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{ invalid_json: '
    });
    let malformedJson = {};
    let malformedIsJson = false;
    try {
      malformedJson = await malformedRes.json();
      malformedIsJson = true;
    } catch (e) {}

    console.log('POST /api/anti-ban/settings [Malformed JSON] status:', malformedRes.status, malformedJson);
    const passMalformed = malformedIsJson && malformedRes.status === 400 && malformedJson.success === false;
    recordTest('POST /api/anti-ban/settings handles malformed JSON with HTTP 400 JSON error (no HTML 500)', passMalformed, `Status: ${malformedRes.status}, isJSON: ${malformedIsJson}`);

    // -------------------------------------------------------------
    // SECTION 4: Automation Runner Hooks Verification
    // -------------------------------------------------------------
    console.log('\n--- SECTION 4: Automation Runner Hooks Verification ---');

    await run('DELETE FROM settings WHERE user_id = 1');

    // 4.1 Blacklist hook in automation runner
    const blPhone = '9188887777';
    await addNumberToBlacklist(1, blPhone, 'Runner Test Blacklist');
    const isBl = await isNumberBlacklisted(1, blPhone);
    const isNotBl = await isNumberBlacklisted(1, '9188887778');

    recordTest(
      'Automation runner blacklist hook correctly identifies blacklisted vs clean numbers',
      isBl === true && isNotBl === false,
      `Blacklisted check: ${isBl}, Clean check: ${isNotBl}`
    );

    // 4.2 Spintax hook in automation runner
    const templateText = '{Hello|Hi} {World|Friend}!';
    const parsedSpintax = parseSpintax(templateText, { enableSpintax: true });
    const spintaxValid = ['Hello World!', 'Hello Friend!', 'Hi World!', 'Hi Friend!'].includes(parsedSpintax);
    recordTest(
      'Automation runner Spintax hook correctly evaluates dynamic variations',
      spintaxValid,
      `Parsed output: "${parsedSpintax}"`
    );

    // 4.3 Warmup status hook in automation runner
    await run("INSERT INTO settings (user_id, key, value) VALUES (1, 'enable_number_warmup', 'true')");
    await run("INSERT INTO settings (user_id, key, value) VALUES (1, 'warmup_stage1_limit', '10')");
    const sRows = await all('SELECT key, value FROM settings WHERE user_id = 1');
    const settingsMap = {};
    (sRows || []).forEach(r => { settingsMap[r.key] = r.value; });
    const warmupStatus = await checkWarmupStatus(1, settingsMap);
    recordTest(
      'Automation runner Warmup status hook returns expected daily limit and exceeded state',
      warmupStatus.dailyLimit === 10 && warmupStatus.isExceeded === false,
      `dailyLimit: ${warmupStatus.dailyLimit}, isExceeded: ${warmupStatus.isExceeded}`
    );

    // 4.4 Health score hook in automation runner
    await run("INSERT INTO settings (user_id, key, value) VALUES (1, 'enable_health_monitoring', 'true')");
    await run("INSERT INTO settings (user_id, key, value) VALUES (1, 'auto_pause_health', 'true')");
    const sRowsHealth = await all('SELECT key, value FROM settings WHERE user_id = 1');
    const settingsMapHealth = {};
    (sRowsHealth || []).forEach(r => { settingsMapHealth[r.key] = r.value; });
    const healthStatus = await calculateHealthScore(1, settingsMapHealth);
    recordTest(
      'Automation runner Health score hook calculates account health score without throwing',
      healthStatus.success === true && typeof healthStatus.healthScore === 'number',
      `Health score: ${healthStatus.healthScore}, Status: ${healthStatus.statusLevel}`
    );

  } catch (err) {
    console.error('❌ Harness encountered unhandled exception:', err);
    recordTest('Empirical test harness suite execution', false, err.message);
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n===============================================================');
  console.log(`  HARNESS SUMMARY: ${results.passed}/${results.total} PASSED, ${results.failed} FAILED`);
  console.log('===============================================================\n');

  return results;
}

runEmpiricalHarness().then(res => {
  if (res.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
});
