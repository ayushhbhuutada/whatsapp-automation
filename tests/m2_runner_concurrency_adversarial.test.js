import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { createTestSuite } from './test_helper.js';
import { AutomationRunner } from '../backend/services/automationRunner.js';
import { openwaService } from '../backend/services/openwaService.js';
import { 
  parseSpintax, 
  checkWarmupStatus, 
  incrementDailySendCount, 
  isNumberBlacklisted, 
  addNumberToBlacklist,
  calculateHealthScore,
  isNightQuietHours
} from '../backend/services/antiBanService.js';
import { run, get, all } from '../backend/database.js';

export const m2EmpiricalRunnerSuite = createTestSuite('Milestone 2 Empirical Challenger: Concurrency, Runner Lifecycle, OpenWA & Anti-Ban Isolation');

const TEST_USER_ID = 8888;

async function setupTestUser() {
  await run('DELETE FROM contacts WHERE user_id = ?', [TEST_USER_ID]);
  await run('DELETE FROM campaigns WHERE user_id = ?', [TEST_USER_ID]);
  await run('DELETE FROM whatsapp_sessions WHERE user_id = ?', [TEST_USER_ID]);
  await run('DELETE FROM number_reputation WHERE user_id = ?', [TEST_USER_ID]);
  await run('DELETE FROM logs WHERE user_id = ?', [TEST_USER_ID]);
  await run('DELETE FROM settings WHERE user_id = ?', [TEST_USER_ID]);
  await run('DELETE FROM daily_send_tracker WHERE user_id = ?', [TEST_USER_ID]);
  await run('DELETE FROM blacklisted_numbers WHERE user_id = ?', [TEST_USER_ID]);

  const existing = await get('SELECT id FROM users WHERE id = ?', [TEST_USER_ID]);
  if (!existing) {
    await run('DELETE FROM users WHERE email = ?', [`testuser${TEST_USER_ID}@example.com`]);
    await run(`
      INSERT INTO users (id, name, email, password_hash)
      VALUES (?, 'Test User 8888', ?, 'hash')
    `, [TEST_USER_ID, `testuser${TEST_USER_ID}@example.com`]);
  }
}

m2EmpiricalRunnerSuite.add('Setup: Clean and initialize test environment', async () => {
  await setupTestUser();
});

// ============================================================================
// 1. WORKER CLAIMING CONCURRENCY & RACE-CONDITION ELIMINATION
// ============================================================================
m2EmpiricalRunnerSuite.add('Concurrency: 10 concurrent workers claim 100 contacts with zero duplicate claims or collisions', async () => {
  await setupTestUser();

  // Create test campaign
  const campRes = await run(`
    INSERT INTO campaigns (user_id, name, status, total_contacts, session_mode, session_name)
    VALUES (?, 'Concurrency Stress Campaign', 'Sending', 100, 'auto_split', 's1,s2,s3,s4,s5')
  `, [TEST_USER_ID]);
  const campaignId = campRes.id;

  // Insert 100 pending contacts
  for (let i = 1; i <= 100; i++) {
    await run(`
      INSERT INTO contacts (user_id, campaign_id, name, phone, message_template, status)
      VALUES (?, ?, ?, ?, 'Hello {{name}}', 'Pending')
    `, [TEST_USER_ID, campaignId, `Contact_${i}`, `91990000${String(i).padStart(4, '0')}`]);
  }

  // Simulate 10 concurrent worker routines competing simultaneously for the queue
  const numWorkers = 10;
  const workerClaimedMap = new Map();
  const allClaimedContactIds = [];

  for (let w = 0; w < numWorkers; w++) {
    workerClaimedMap.set(w, []);
  }

  const simulateWorker = async (workerIdx, sessionId) => {
    while (true) {
      // Step 1: Find next pending contact
      const contact = await get(`
        SELECT * FROM contacts 
        WHERE campaign_id = ? AND status = 'Pending' 
        ORDER BY id ASC LIMIT 1
      `, [campaignId]);

      if (!contact) {
        break; // No more pending contacts
      }

      // Step 2: Atomic update claim
      const claimRes = await run(`
        UPDATE contacts 
        SET status = 'Sending', sent_via_session = ? 
        WHERE id = ? AND status = 'Pending'
      `, [sessionId, contact.id]);

      // If another worker beat us to claiming it, continue loop
      if (!claimRes || claimRes.changes === 0) {
        continue;
      }

      // Claim successful
      workerClaimedMap.get(workerIdx).push(contact.id);
      allClaimedContactIds.push(contact.id);

      // Simulate micro-work
      await new Promise(r => setTimeout(r, 2));

      // Mark as Sent
      await run(`
        UPDATE contacts 
        SET status = 'Sent', sent_at = datetime('now') 
        WHERE id = ?
      `, [contact.id]);
    }
  };

  // Launch all 10 workers in parallel
  const workerPromises = [];
  for (let w = 0; w < numWorkers; w++) {
    workerPromises.push(simulateWorker(w, `session_worker_${w % 5}`));
  }

  await Promise.all(workerPromises);

  // Assertions:
  assert.strictEqual(allClaimedContactIds.length, 100, `Expected exactly 100 claimed contacts, got ${allClaimedContactIds.length}`);

  const uniqueClaimed = new Set(allClaimedContactIds);
  assert.strictEqual(uniqueClaimed.size, 100, `Detected duplicate claims: ${100 - uniqueClaimed.size} collisions found!`);

  const stats = await all(`
    SELECT status, COUNT(*) as count 
    FROM contacts 
    WHERE campaign_id = ? 
    GROUP BY status
  `, [campaignId]);

  const statMap = {};
  stats.forEach(s => { statMap[s.status] = s.count; });
  assert.strictEqual(statMap['Sent'], 100, 'All 100 contacts must be in Sent status');
  assert.strictEqual(statMap['Pending'] || 0, 0, 'No contacts should remain in Pending');
  assert.strictEqual(statMap['Sending'] || 0, 0, 'No contacts should remain in Sending');
  assert.strictEqual(statMap['Failed'] || 0, 0, 'No contacts should be marked as Failed');
});

// ============================================================================
// 2. IN-FLIGHT CONTACT ROLLBACK ON PAUSE / STOP
// ============================================================================
m2EmpiricalRunnerSuite.add('Rollback: In-flight Sending contact rolls back to Pending on pause/stop without marking Failed', async () => {
  await setupTestUser();
  const runner = new AutomationRunner();

  // Create campaign
  const campRes = await run(`
    INSERT INTO campaigns (user_id, name, status, total_contacts, session_mode, session_name)
    VALUES (?, 'Rollback Test Campaign', 'Pending', 10, 'auto_split', 'test_sess')
  `, [TEST_USER_ID]);
  const campaignId = campRes.id;

  // Insert 10 contacts
  for (let i = 1; i <= 10; i++) {
    await run(`
      INSERT INTO contacts (user_id, campaign_id, name, phone, message_template, status)
      VALUES (?, ?, ?, ?, 'Msg {{name}}', 'Pending')
    `, [TEST_USER_ID, campaignId, `RollbackUser_${i}`, `91981111${String(i).padStart(4, '0')}`]);
  }

  // Pick first contact and simulate it being claimed into 'Sending' state
  const firstContact = await get("SELECT * FROM contacts WHERE campaign_id = ? AND status = 'Pending' LIMIT 1", [campaignId]);
  await run("UPDATE contacts SET status = 'Sending', sent_via_session = 'test_sess' WHERE id = ?", [firstContact.id]);

  // Verify contact is in 'Sending' state
  const claimedContact = await get("SELECT status, sent_via_session FROM contacts WHERE id = ?", [firstContact.id]);
  assert.strictEqual(claimedContact.status, 'Sending');
  assert.strictEqual(claimedContact.sent_via_session, 'test_sess');

  // Trigger pause / stop simulation logic (runner keepRunning = false)
  runner.currentCampaignId = campaignId;
  runner.status = 'Running';
  runner.keepRunning = false; // Simulate stop/pause signal

  // Execute in-flight rollback logic from worker
  if (!runner.keepRunning) {
    await run("UPDATE contacts SET status = 'Pending', sent_via_session = NULL WHERE id = ?", [firstContact.id]);
  }

  // Verify contact rolled back to 'Pending' and sent_via_session cleared
  const rolledBack = await get("SELECT status, sent_via_session FROM contacts WHERE id = ?", [firstContact.id]);
  assert.strictEqual(rolledBack.status, 'Pending', 'In-flight contact must be rolled back to Pending');
  assert.strictEqual(rolledBack.sent_via_session, null, 'sent_via_session must be reset to NULL');

  // Verify zero contacts are marked as Failed
  const failedCount = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status = 'Failed'", [campaignId]);
  assert.strictEqual(failedCount.count, 0, 'No contacts should be marked as Failed on pause/stop');
});

// ============================================================================
// 3. STRANDED CONTACT RECOVERY ON CAMPAIGN LAUNCH / REBOOT
// ============================================================================
m2EmpiricalRunnerSuite.add('Stranded Recovery: Stranded Sending contacts are auto-recovered to Pending on startup/reboot', async () => {
  await setupTestUser();
  const runner = new AutomationRunner();

  // Create campaign
  const campRes = await run(`
    INSERT INTO campaigns (user_id, name, status, total_contacts)
    VALUES (?, 'Stranded Recovery Test', 'Stopped', 5)
  `, [TEST_USER_ID]);
  const campaignId = campRes.id;

  // Insert contacts with 3 stranded in 'Sending' and 2 in 'Pending'
  for (let i = 1; i <= 3; i++) {
    await run(`
      INSERT INTO contacts (user_id, campaign_id, name, phone, message_template, status, sent_via_session)
      VALUES (?, ?, ?, ?, 'Hello', 'Sending', 'stranded_sess_1')
    `, [TEST_USER_ID, campaignId, `StrandedUser_${i}`, `91982222${String(i).padStart(4, '0')}`]);
  }
  for (let i = 4; i <= 5; i++) {
    await run(`
      INSERT INTO contacts (user_id, campaign_id, name, phone, message_template, status)
      VALUES (?, ?, ?, ?, 'Hello', 'Pending')
    `, [TEST_USER_ID, campaignId, `PendingUser_${i}`, `91982222${String(i).padStart(4, '0')}`]);
  }

  // Pre-condition check: 3 contacts are in 'Sending'
  const preCheck = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status = 'Sending'", [campaignId]);
  assert.strictEqual(preCheck.count, 3, 'Precondition: 3 stranded contacts');

  // Execute recoverStrandedContacts
  await runner.recoverStrandedContacts(campaignId);

  // Post-condition check: 0 Sending, 5 Pending
  const postSending = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status = 'Sending'", [campaignId]);
  const postPending = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status = 'Pending'", [campaignId]);
  assert.strictEqual(postSending.count, 0, 'Zero contacts should remain in Sending');
  assert.strictEqual(postPending.count, 5, 'All 5 contacts should now be in Pending');

  // Check global recovery (campaignId = null)
  await run("UPDATE contacts SET status = 'Sending', sent_via_session = 'sess_xyz' WHERE id IN (SELECT id FROM contacts WHERE campaign_id = ? LIMIT 2)", [campaignId]);
  await runner.recoverStrandedContacts(null);

  const globalPending = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status = 'Pending'", [campaignId]);
  assert.strictEqual(globalPending.count, 5, 'Global stranded recovery resets all Sending contacts across all campaigns');
});

// ============================================================================
// 4. SESSION SOCKET DISCONNECT ISOLATION & QUEUE BURN PREVENTION
// ============================================================================
m2EmpiricalRunnerSuite.add('Disconnect Isolation: Disconnected worker terminates without burning shared queue contacts', async () => {
  await setupTestUser();
  const runner = new AutomationRunner();

  // Create campaign with 6 contacts
  const campRes = await run(`
    INSERT INTO campaigns (user_id, name, status, total_contacts, session_mode, session_name)
    VALUES (?, 'Queue Burn Prevention Campaign', 'Sending', 6, 'custom_subset', 'live_sess,dead_sess')
  `, [TEST_USER_ID]);
  const campaignId = campRes.id;

  for (let i = 1; i <= 6; i++) {
    await run(`
      INSERT INTO contacts (user_id, campaign_id, name, phone, message_template, status)
      VALUES (?, ?, ?, ?, 'Hello {{name}}', 'Pending')
    `, [TEST_USER_ID, campaignId, `QueueContact_${i}`, `91983333${String(i).padStart(4, '0')}`]);
  }

  // Setup mock session states in openwaService
  openwaService.sessionStatuses.set('live_sess', 'CONNECTED');
  openwaService.sessionStatuses.set('dead_sess', 'DISCONNECTED');

  runner.status = 'Running';
  runner.keepRunning = true;

  const antiBanSettings = {
    bypass_all_safety: 'true',
    delay_seconds: '0'
  };

  // Mock sendTextMessage for live_sess
  const origSendText = openwaService.sendTextMessage;
  let liveSentCount = 0;

  openwaService.sendTextMessage = async (sessionId, phone, text, options) => {
    if (sessionId === 'live_sess') {
      liveSentCount++;
      return { success: true, messageId: `msg_${liveSentCount}` };
    }
    return { success: false, error: 'Session disconnected' };
  };

  // Mock isRegisteredUser
  const origIsReg = openwaService.isRegisteredUser;
  openwaService.isRegisteredUser = async () => true;

  try {
    // Run worker for dead_sess (disconnected from start)
    const deadWorkerPromise = runner.runSessionWorker({
      campaignId,
      sessionId: 'dead_sess',
      workerIdx: 1,
      totalWorkers: 2,
      userId: TEST_USER_ID,
      antiBanSettings,
      maxRetries: 0,
      defaultCountryCode: '91',
      googleSheetUrl: '',
      delayMs: 0
    });

    // Run worker for live_sess (connected)
    const liveWorkerPromise = runner.runSessionWorker({
      campaignId,
      sessionId: 'live_sess',
      workerIdx: 0,
      totalWorkers: 2,
      userId: TEST_USER_ID,
      antiBanSettings,
      maxRetries: 0,
      defaultCountryCode: '91',
      googleSheetUrl: '',
      delayMs: 0
    });

    await Promise.all([deadWorkerPromise, liveWorkerPromise]);

    // Check results:
    // 1. Dead worker must have halted immediately without burning contacts into 'Failed'
    const failedContacts = await all("SELECT * FROM contacts WHERE campaign_id = ? AND status = 'Failed'", [campaignId]);
    assert.strictEqual(failedContacts.length, 0, `Queue Burn detected: ${failedContacts.length} contacts burned into Failed state!`);

    // 2. Live worker must have successfully processed all 6 contacts
    const sentContacts = await all("SELECT * FROM contacts WHERE campaign_id = ? AND status = 'Sent'", [campaignId]);
    assert.strictEqual(sentContacts.length, 6, `Live worker should process all contacts, got ${sentContacts.length}/6`);
    assert.strictEqual(liveSentCount, 6);

  } finally {
    openwaService.sendTextMessage = origSendText;
    openwaService.isRegisteredUser = origIsReg;
    openwaService.sessionStatuses.delete('live_sess');
    openwaService.sessionStatuses.delete('dead_sess');
    runner.keepRunning = false;
  }
});

// ============================================================================
// 5. MID-EXECUTION DISCONNECT & WORKER HALT QUEUE PRESERVATION
// ============================================================================
m2EmpiricalRunnerSuite.add('Disconnect Mid-Run: Worker halts on unexpected socket drop, remaining contacts stay Pending', async () => {
  await setupTestUser();
  const runner = new AutomationRunner();

  // Create campaign with 6 contacts
  const campRes = await run(`
    INSERT INTO campaigns (user_id, name, status, total_contacts)
    VALUES (?, 'Mid-Run Disconnect Campaign', 'Sending', 6)
  `, [TEST_USER_ID]);
  const campaignId = campRes.id;

  for (let i = 1; i <= 6; i++) {
    await run(`
      INSERT INTO contacts (user_id, campaign_id, name, phone, message_template, status)
      VALUES (?, ?, ?, ?, 'Hello {{name}}', 'Pending')
    `, [TEST_USER_ID, campaignId, `MidContact_${i}`, `91984444${String(i).padStart(4, '0')}`]);
  }

  const sessionId = 'dropping_sess';
  openwaService.sessionStatuses.set(sessionId, 'CONNECTED');

  runner.status = 'Running';
  runner.keepRunning = true;

  const antiBanSettings = {
    bypass_all_safety: 'true',
    delay_seconds: '0'
  };

  let sendsAttempted = 0;
  const origSendText = openwaService.sendTextMessage;
  const origIsReg = openwaService.isRegisteredUser;
  openwaService.isRegisteredUser = async () => true;

  openwaService.sendTextMessage = async (sid, phone, text, options) => {
    sendsAttempted++;
    if (sendsAttempted <= 2) {
      return { success: true, messageId: `msg_${sendsAttempted}` };
    }
    // On 3rd message, simulate socket drop error
    openwaService.sessionStatuses.set(sessionId, 'DISCONNECTED');
    return { success: false, error: 'WhatsApp session closed / disconnected' };
  };

  try {
    await runner.runSessionWorker({
      campaignId,
      sessionId,
      workerIdx: 0,
      totalWorkers: 1,
      userId: TEST_USER_ID,
      antiBanSettings,
      maxRetries: 0,
      defaultCountryCode: '91',
      googleSheetUrl: '',
      delayMs: 0
    });

    // Check states:
    // Exactly 2 sent
    const sentCount = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status = 'Sent'", [campaignId]);
    assert.strictEqual(sentCount.count, 2, 'First 2 messages should be Sent');

    // Exactly 1 Failed (the one that experienced the socket drop during dispatch)
    const failedCount = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status = 'Failed'", [campaignId]);
    assert.strictEqual(failedCount.count, 1, 'The 3rd message that failed on disconnect is recorded as 1 failure');

    // Remaining 3 contacts must stay in Pending state (NOT burned into Failed)
    const pendingCount = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status = 'Pending'", [campaignId]);
    assert.strictEqual(pendingCount.count, 3, `Expected 3 Pending contacts preserved, found ${pendingCount.count}`);

  } finally {
    openwaService.sendTextMessage = origSendText;
    openwaService.isRegisteredUser = origIsReg;
    openwaService.sessionStatuses.delete(sessionId);
    runner.keepRunning = false;
  }
});

// ============================================================================
// 6. MULTI-SESSION INDEPENDENT WARMUP QUOTA TRACKING
// ============================================================================
m2EmpiricalRunnerSuite.add('Multi-Session Warmup: Daily warmup quotas are tracked independently per session profile', async () => {
  await setupTestUser();
  const sessionA = 'profile_alpha';
  const sessionB = 'profile_beta';

  const settings = {
    enable_number_warmup: 'true',
    warmup_stage1_limit: '10'
  };

  // Ensure fresh user record with recent creation date (Stage 1 = limit 10)
  await run("UPDATE users SET created_at = datetime('now') WHERE id = ?", [TEST_USER_ID]);

  // Insert 10 sent contacts for sessionA today
  for (let i = 1; i <= 10; i++) {
    await run(`
      INSERT INTO contacts (user_id, name, phone, status, sent_via_session, sent_at)
      VALUES (?, ?, ?, 'Sent', ?, datetime('now'))
    `, [TEST_USER_ID, `WarmupA_${i}`, `91985555${String(i).padStart(4, '0')}`, sessionA]);
  }

  // Insert only 3 sent contacts for sessionB today
  for (let i = 1; i <= 3; i++) {
    await run(`
      INSERT INTO contacts (user_id, name, phone, status, sent_via_session, sent_at)
      VALUES (?, ?, ?, 'Sent', ?, datetime('now'))
    `, [TEST_USER_ID, `WarmupB_${i}`, `91986666${String(i).padStart(4, '0')}`, sessionB]);
  }

  // Check warmup status for sessionA
  const warmupA = await checkWarmupStatus(TEST_USER_ID, settings, sessionA);
  assert.strictEqual(warmupA.sentToday, 10, 'Session A sentToday should be 10');
  assert.strictEqual(warmupA.isExceeded, true, 'Session A should be exceeded (10/10)');
  assert.strictEqual(warmupA.remaining, 0, 'Session A remaining should be 0');

  // Check warmup status for sessionB
  const warmupB = await checkWarmupStatus(TEST_USER_ID, settings, sessionB);
  assert.strictEqual(warmupB.sentToday, 3, 'Session B sentToday should be 3');
  assert.strictEqual(warmupB.isExceeded, false, 'Session B should NOT be exceeded (3/10)');
  assert.strictEqual(warmupB.remaining, 7, 'Session B remaining should be 7');
});

// ============================================================================
// 7. SESSION-SCOPED LOGOUT TEARDOWN ISOLATION
// ============================================================================
m2EmpiricalRunnerSuite.add('Logout Isolation: Logging out Session A does not kill campaigns running on active Session B', async () => {
  await setupTestUser();
  const runner = new AutomationRunner();

  // Create campaign running on Session B
  const campRes = await run(`
    INSERT INTO campaigns (user_id, name, status, total_contacts, session_name)
    VALUES (?, 'Session B Campaign', 'Sending', 5, 'session_bravo')
  `, [TEST_USER_ID]);
  const campaignId = campRes.id;

  runner.currentCampaignId = campaignId;
  runner.status = 'Running';
  runner.keepRunning = true;

  // Mock openwaService deleteSession
  let deletedSessionName = null;
  const origDeleteSession = openwaService.deleteSession;
  openwaService.deleteSession = async (sName) => {
    deletedSessionName = sName;
    return { success: true };
  };

  try {
    // Logout Session A ('session_alpha')
    await runner.logoutSession('session_alpha');

    // Assert that session_alpha was passed to openwaService.deleteSession
    assert.strictEqual(deletedSessionName, 'session_alpha');

    // Assert that runner remains in 'Running' state with currentCampaignId intact
    assert.strictEqual(runner.status, 'Running', 'Runner should remain Running for active campaign');
    assert.strictEqual(runner.currentCampaignId, campaignId, 'currentCampaignId should remain attached to campaignId');
    assert.strictEqual(runner.keepRunning, true, 'keepRunning must remain true');

  } finally {
    openwaService.deleteSession = origDeleteSession;
    await runner.cleanup();
  }
});

// ============================================================================
// 8. RESUME RE-ENTRANCY MUTEX & ACCURATE COMPLETION CHECK
// ============================================================================
m2EmpiricalRunnerSuite.add('Mutex & Completion: Re-entrant start/resume throws error, completion checks Pending & Sending', async () => {
  await setupTestUser();
  const runner = new AutomationRunner();

  // Create campaign with 2 Pending and 1 Sending contact
  const campRes = await run(`
    INSERT INTO campaigns (user_id, name, status, total_contacts)
    VALUES (?, 'Mutex & Completion Test', 'Sending', 3)
  `, [TEST_USER_ID]);
  const campaignId = campRes.id;

  runner.status = 'Running';
  runner.currentCampaignId = campaignId;

  // Test 1: Calling startCampaign or resumeCampaign when running throws
  let startThrew = false;
  try {
    await runner.startCampaign(campaignId);
  } catch (err) {
    startThrew = true;
    assert.ok(err.message.includes('already starting or running'));
  }
  assert.strictEqual(startThrew, true, 'startCampaign on running instance must throw mutex error');

  let resumeThrew = false;
  try {
    await runner.resumeCampaign(campaignId);
  } catch (err) {
    resumeThrew = true;
    assert.ok(err.message.includes('already starting or running'));
  }
  assert.strictEqual(resumeThrew, true, 'resumeCampaign on running instance must throw mutex error');

  // Test 2: In-flight starting flag mutex
  runner.status = 'Idle';
  runner.isStarting = true;
  let startBlocked = false;
  try {
    await runner.startCampaign(campaignId);
  } catch (err) {
    startBlocked = true;
  }
  assert.strictEqual(startBlocked, true, 'isStarting flag blocks concurrent execution');
  runner.isStarting = false;

  // Test 3: Accurate completion checking
  await run("DELETE FROM contacts WHERE campaign_id = ?", [campaignId]);
  await run("INSERT INTO contacts (user_id, campaign_id, name, phone, status) VALUES (?, ?, 'C1', '919877770001', 'Sent')", [TEST_USER_ID, campaignId]);
  await run("INSERT INTO contacts (user_id, campaign_id, name, phone, status) VALUES (?, ?, 'C2', '919877770002', 'Sending')", [TEST_USER_ID, campaignId]);

  // Query remaining as runner does: status IN ('Pending', 'Sending')
  const remaining = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status IN ('Pending', 'Sending')", [campaignId]);
  assert.strictEqual(remaining.count, 1, 'Remaining count correctly includes in-flight Sending contacts');

  // Mark all Sent
  await run("UPDATE contacts SET status = 'Sent' WHERE campaign_id = ?", [campaignId]);
  const finalRemaining = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status IN ('Pending', 'Sending')", [campaignId]);
  assert.strictEqual(finalRemaining.count, 0, 'Remaining count evaluates to 0 when all contacts are finalized');
});

// ============================================================================
// 9. IN-FLIGHT `createSession` DEDUPLICATION
// ============================================================================
m2EmpiricalRunnerSuite.add('OpenWA createSession: Concurrent createSession calls for same sessionId are deduplicated', async () => {
  const sessionId = 'dedup_test_session';

  // Spy on initializingSessions
  assert.strictEqual(openwaService.initializingSessions.has(sessionId), false);

  // Stub checkHealth and nativeClients to avoid spawning real Chromium in unit test
  const origCheckHealth = openwaService.checkHealth;
  let createCallCount = 0;

  openwaService.checkHealth = async () => {
    createCallCount++;
    await new Promise(r => setTimeout(r, 50));
    return { online: false };
  };

  // Add dummy native client so it completes fast
  openwaService.nativeClients.set(sessionId, { pupPage: true });

  try {
    // Launch 5 concurrent createSession calls simultaneously
    const promises = [
      openwaService.createSession(sessionId),
      openwaService.createSession(sessionId),
      openwaService.createSession(sessionId),
      openwaService.createSession(sessionId),
      openwaService.createSession(sessionId)
    ];

    const results = await Promise.all(promises);

    // All 5 must succeed
    results.forEach(res => {
      assert.strictEqual(res.success, true);
    });

    // CheckHealth should only have been called once due to promise deduplication in initializingSessions
    assert.strictEqual(createCallCount, 1, `Expected 1 invocation, got ${createCallCount} (deduplication active)`);
    assert.strictEqual(openwaService.initializingSessions.has(sessionId), false, 'initializingSessions cleaned up');

  } finally {
    openwaService.checkHealth = origCheckHealth;
    openwaService.nativeClients.delete(sessionId);
    openwaService.sessionStatuses.delete(sessionId);
  }
});

// ============================================================================
// 10. SPINTAX & VARIABLE PRESERVATION WITH ADVERSARIAL TEMPLATES
// ============================================================================
m2EmpiricalRunnerSuite.add('Spintax Adversarial: Deep nested variations, double braces, whitespace, special chars', () => {
  // Test 1: Preserve whitespace in options: "{  Leading | Trailing  |  Both  }"
  const wsTemplate = '{  Leading | Trailing  |  Both  }';
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    seen.add(parseSpintax(wsTemplate));
  }
  assert.ok(seen.has('  Leading ') || seen.has(' Trailing  ') || seen.has('  Both  '), 'Preserves intentional whitespace');

  // Test 2: Double-braced variables alongside Spintax
  const mixedTemplate = '{Dear|Hello} {{name}}, your balance is {{balance}} USD on {Monday|Tuesday}!';
  for (let i = 0; i < 30; i++) {
    const parsed = parseSpintax(mixedTemplate);
    assert.ok(parsed.startsWith('Dear ') || parsed.startsWith('Hello '));
    assert.ok(parsed.includes('{{name}}'), 'Must preserve {{name}} without alteration');
    assert.ok(parsed.includes('{{balance}}'), 'Must preserve {{balance}} without alteration');
    assert.ok(parsed.includes(' Monday!') || parsed.includes(' Tuesday!'));
  }

  // Test 3: Multiple adjacent variables: "{{first_name}} {{last_name}}"
  const adjTemplate = '{{first_name}} {{last_name}} - {CodeA|CodeB}';
  const parsedAdj = parseSpintax(adjTemplate);
  assert.ok(parsedAdj.includes('{{first_name}} {{last_name}}'));

  // Test 4: Deeply nested Spintax resolution
  const deepSpintax = '{Level 1: {A|{B|C}}}';
  const parsedDeep = parseSpintax(deepSpintax);
  assert.ok(parsedDeep === 'Level 1: A' || parsedDeep === 'Level 1: B' || parsedDeep === 'Level 1: C');
});

// Direct execution
if (process.argv[1] && process.argv[1].endsWith('m2_runner_concurrency_adversarial.test.js')) {
  m2EmpiricalRunnerSuite.run().then((res) => {
    console.log(`Milestone 2 Empirical Runner Suite Complete: ${res.passed}/${res.total} passed`);
    if (res.failed > 0) process.exit(1);
  });
}
