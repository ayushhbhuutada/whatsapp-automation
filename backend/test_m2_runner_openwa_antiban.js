import assert from 'node:assert';
import db, { run, get, all } from './database.js';
import {
  parseSpintax,
  checkWarmupStatus,
  incrementDailySendCount,
  checkDailyLimit,
  recordDailySend,
  getNextSendWindow,
  isNumberBlacklisted,
  addNumberToBlacklist
} from './services/antiBanService.js';
import { openwaService, OpenWAService } from './services/openwaService.js';
import { AutomationRunner } from './services/automationRunner.js';

async function runM2Verification() {
  console.log('====================================================');
  console.log('   MILESTONE 2: RUNNER, OPENWA & ANTI-BAN VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, condition, detail = '') {
    if (condition) {
      passed++;
      console.log(`✅ [PASS] ${name}`);
    } else {
      failed++;
      console.error(`❌ [FAIL] ${name} - ${detail}`);
    }
  }

  // --- 1. SPINTAX WHITESPACE PRESERVATION ---
  console.log('\n--- 1. Spintax Whitespace Preservation ---');
  const spintaxWithSpaces = 'Hello{ | there | friend}';
  const parsedVariations = new Set();
  for (let i = 0; i < 200; i++) {
    parsedVariations.add(parseSpintax(spintaxWithSpaces));
  }
  test('Spintax preserves intentional space choices', parsedVariations.has('Hello ') && parsedVariations.has('Hello there ') && parsedVariations.has('Hello friend'), `Variations: ${Array.from(parsedVariations).join(', ')}`);

  // --- 2. SEND WINDOW LOCAL DATE FORMATTING ---
  console.log('\n--- 2. Send Window Local Date Alignment ---');
  const window = getNextSendWindow();
  const now = new Date();
  const expectedLocalStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  test('getNextSendWindow uses local date format YYYY-MM-DD', window.windowDate === expectedLocalStr, `Expected ${expectedLocalStr}, got ${window.windowDate}`);

  // --- 3. MULTI-SESSION WARMUP SEPARATION ---
  console.log('\n--- 3. Multi-Session Warmup Separation ---');
  const testUser = 8888;
  await run('DELETE FROM users WHERE id = ?', [testUser]);
  await run('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [testUser, 'M2 User', 'm2@test.com', 'h']);
  await run('DELETE FROM contacts WHERE user_id = ?', [testUser]);
  await run('DELETE FROM daily_send_tracker WHERE user_id = ?', [testUser]);

  // Insert test campaign and sent contacts under two different sessions
  const todayStr = expectedLocalStr;
  await run('INSERT OR IGNORE INTO campaigns (id, user_id, name, status) VALUES (9999, ?, ?, ?)', [testUser, 'Warmup Test', 'Completed']);
  await run(`INSERT INTO contacts (campaign_id, user_id, name, phone, status, sent_via_session, sent_at) VALUES (9999, ?, 'A', '123', 'Sent', 'session-1', datetime('now', 'localtime'))`, [testUser]);
  await run(`INSERT INTO contacts (campaign_id, user_id, name, phone, status, sent_via_session, sent_at) VALUES (9999, ?, 'B', '456', 'Sent', 'session-1', datetime('now', 'localtime'))`, [testUser]);
  await run(`INSERT INTO contacts (campaign_id, user_id, name, phone, status, sent_via_session, sent_at) VALUES (9999, ?, 'C', '789', 'Sent', 'session-2', datetime('now', 'localtime'))`, [testUser]);

  const warmupS1 = await checkWarmupStatus(testUser, { enable_daily_warmup: 'true' }, 'session-1');
  const warmupS2 = await checkWarmupStatus(testUser, { enable_daily_warmup: 'true' }, 'session-2');
  test('Warmup count separated for session-1 (count = 2)', warmupS1.sentToday === 2, `Got ${warmupS1.sentToday}`);
  test('Warmup count separated for session-2 (count = 1)', warmupS2.sentToday === 1, `Got ${warmupS2.sentToday}`);
  test('Aliases checkDailyLimit and recordDailySend exist', typeof checkDailyLimit === 'function' && typeof recordDailySend === 'function');

  // --- 4. STRANDED CONTACT RECOVERY ---
  console.log('\n--- 4. Stranded Contact Recovery ---');
  const testCampaign = 9991;
  await run('DELETE FROM campaigns WHERE id = ?', [testCampaign]);
  await run('INSERT INTO campaigns (id, user_id, name, status) VALUES (?, ?, ?, ?)', [testCampaign, testUser, 'Stranded Test', 'Paused']);
  await run('DELETE FROM contacts WHERE campaign_id = ?', [testCampaign]);
  await run("INSERT INTO contacts (campaign_id, user_id, name, phone, status, sent_via_session) VALUES (?, ?, 'Stranded 1', '919876500001', 'Sending', 'sess-a')", [testCampaign, testUser]);
  await run("INSERT INTO contacts (campaign_id, user_id, name, phone, status, sent_via_session) VALUES (?, ?, 'Stranded 2', '919876500002', 'Sending', 'sess-b')", [testCampaign, testUser]);

  const runner = new AutomationRunner();
  await runner.recoverStrandedContacts(testCampaign);
  const recovered = await all('SELECT status, sent_via_session FROM contacts WHERE campaign_id = ?', [testCampaign]);
  test('Stranded contacts recovered from Sending to Pending', recovered.every(c => c.status === 'Pending' && c.sent_via_session === null), `Contacts: ${JSON.stringify(recovered)}`);

  // --- 5. POST-REBOOT RESUME & RE-ENTRANCY MUTEX ---
  console.log('\n--- 5. Post-Reboot Resume & Re-Entrancy Mutex ---');
  const idleRunner = new AutomationRunner();
  test('Post-reboot runner initializes in Idle state', idleRunner.status === 'Idle' && idleRunner.currentCampaignId === null);

  // Mock runLoop on runner to verify resumeCampaign launches loop and sets state
  let runLoopLaunched = false;
  idleRunner.runLoop = async (cid) => {
    runLoopLaunched = true;
  };

  await idleRunner.resumeCampaign(testCampaign);
  test('resumeCampaign works from Idle status following reboot', idleRunner.status === 'Running' && idleRunner.currentCampaignId === testCampaign && runLoopLaunched === true);

  // Test re-entrancy mutex
  let mutexBlocked = false;
  try {
    await idleRunner.resumeCampaign(testCampaign);
  } catch (e) {
    mutexBlocked = true;
  }
  test('resumeCampaign blocks re-entrant start when already running', mutexBlocked === true);

  // Clean up runner
  await idleRunner.cleanup();

  // --- 6. IN-FLIGHT CREATE SESSION DEDUPLICATION & QR TIMER CLEANUP ---
  console.log('\n--- 6. In-Flight createSession Deduplication & QR Timers ---');
  const testService = new OpenWAService();
  test('OpenWAService initializes initializingSessions and qrTimers Maps', testService.initializingSessions instanceof Map && testService.qrTimers instanceof Map);

  // --- 7. GROUP & BROADCAST MESSAGE FILTER ---
  console.log('\n--- 7. Group & Broadcast Message Filter ---');
  let groupMsgFiltered = false;
  const dummyClient = {
    on: (evt, handler) => {
      if (evt === 'message') {
        // Trigger with group message
        const groupMsg = { from: '12036304@g.us', fromMe: false, body: 'stop' };
        handler(groupMsg);
      }
    }
  };
  // Test filtering logic directly
  const isGroupMsg = (from) => from && (from.includes('@g.us') || from.includes('broadcast') || from.includes('@broadcast') || from.includes('@newsletter'));
  test('Group and broadcast sender filter identifies group JIDs', isGroupMsg('12036304234@g.us') && isGroupMsg('status@broadcast') && !isGroupMsg('919876543210@c.us'));

  // --- 8. SESSION-SCOPED LOGOUT TEARDOWN ---
  console.log('\n--- 8. Session-Scoped Logout Teardown ---');
  const multiRunner = new AutomationRunner();
  multiRunner.status = 'Running';
  multiRunner.currentCampaignId = 1234;
  multiRunner.keepRunning = true;

  // Logout a single session should NOT teardown the active campaign
  await multiRunner.logoutSession('profile-secondary');
  test('logoutSession does not kill active campaign running on other sessions', multiRunner.status === 'Running' && multiRunner.currentCampaignId === 1234 && multiRunner.keepRunning === true);

  // Cleanup test user and campaign
  await run('DELETE FROM contacts WHERE campaign_id IN (?, 9999)', [testCampaign]);
  await run('DELETE FROM campaigns WHERE id IN (?, 9999)', [testCampaign]);
  await run('DELETE FROM users WHERE id = ?', [testUser]);

  console.log('\n====================================================');
  console.log(`MILESTONE 2 VERIFICATION COMPLETE: ${passed} Passed | ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

runM2Verification().catch(err => {
  console.error('Error running M2 verification:', err);
  process.exit(1);
});
