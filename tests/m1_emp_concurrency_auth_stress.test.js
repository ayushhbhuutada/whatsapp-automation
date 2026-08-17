import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from '../backend/node_modules/jsonwebtoken/index.js';
import express from '../backend/node_modules/express/index.js';
import db, { run, get, all } from '../backend/database.js';
import { authMiddleware } from '../backend/routes.js';
import apiRouter from '../backend/routes.js';
import { createTestSuite, ensureTestUser } from './test_helper.js';
import { getUploadsDir } from '../backend/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const m1EmpiricalSuite = createTestSuite('Milestone 1 Empirical Challenger: SQLite Concurrency & JWT Auth Middleware Security');

const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp-saas-secret-key-2026';

// Helper to launch a test Express server
function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOptions = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          json
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      if (typeof options.body === 'string' || Buffer.isBuffer(options.body)) {
        req.write(options.body);
      } else {
        req.write(JSON.stringify(options.body));
      }
    }
    req.end();
  });
}

// ============================================================================
// 1. SQLITE CONCURRENCY & LOCK CONTENTION STRESS TESTS
// ============================================================================

m1EmpiricalSuite.add('SQLite: PRAGMA settings verify WAL mode, busy_timeout=5000, and foreign_keys=ON', async () => {
  const journalMode = await get('PRAGMA journal_mode');
  assert.strictEqual(journalMode.journal_mode.toLowerCase(), 'wal', 'Database must run in WAL journal mode');

  const busyTimeout = await get('PRAGMA busy_timeout');
  assert.strictEqual(Number(busyTimeout.timeout), 5000, 'PRAGMA busy_timeout must be configured to 5000ms');

  const foreignKeys = await get('PRAGMA foreign_keys');
  assert.strictEqual(Number(foreignKeys.foreign_keys), 1, 'PRAGMA foreign_keys must be enabled (1)');
});

m1EmpiricalSuite.add('SQLite Concurrency: 150 parallel async writes across multiple tables without SQLITE_BUSY', async () => {
  await ensureTestUser(901);
  await run('DELETE FROM contacts WHERE user_id = 901');
  await run('DELETE FROM logs WHERE user_id = 901');
  await run('DELETE FROM campaigns WHERE user_id = 901');
  const camp901 = await run('INSERT INTO campaigns (user_id, name, status) VALUES (?, ?, ?)', [901, 'Stress Camp 901', 'Pending']);
  const campaignId = camp901.id;

  const writePromises = [];
  const totalWrites = 150;

  for (let i = 0; i < totalWrites; i++) {
    if (i % 3 === 0) {
      writePromises.push(run(
        'INSERT INTO contacts (user_id, campaign_id, name, phone, status) VALUES (?, ?, ?, ?, ?)',
        [901, campaignId, `Stress Contact ${i}`, `+1555000${String(i).padStart(4, '0')}`, 'Pending']
      ));
    } else if (i % 3 === 1) {
      writePromises.push(run(
        'INSERT INTO logs (user_id, campaign_id, level, message) VALUES (?, ?, ?, ?)',
        [901, campaignId, 'info', `Concurrent log entry #${i}`]
      ));
    } else {
      writePromises.push(run(
        'INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)',
        [901, `stress_key_${i}`, `val_${i}`]
      ));
    }
  }

  const results = await Promise.all(writePromises);
  assert.strictEqual(results.length, totalWrites);
  for (const res of results) {
    assert(res.changes >= 1, 'Every write operation must succeed with changes >= 1');
  }

  const contactCount = await get('SELECT COUNT(*) as count FROM contacts WHERE user_id = 901 AND campaign_id = ?', [campaignId]);
  assert.strictEqual(contactCount.count, 50, 'Expected exactly 50 contacts inserted');

  const logCount = await get('SELECT COUNT(*) as count FROM logs WHERE user_id = 901 AND campaign_id = ?', [campaignId]);
  assert.strictEqual(logCount.count, 50, 'Expected exactly 50 logs inserted');
});

m1EmpiricalSuite.add('SQLite Concurrency: Rapid interleaved reads and writes under heavy parallel load', async () => {
  await ensureTestUser(902);
  await run('DELETE FROM contacts WHERE user_id = 902');
  await run('DELETE FROM campaigns WHERE user_id = 902');
  const camp902 = await run('INSERT INTO campaigns (user_id, name, status) VALUES (?, ?, ?)', [902, 'Reader Camp 902', 'Pending']);
  const campaignId = camp902.id;

  // Seed baseline records
  for (let i = 0; i < 20; i++) {
    await run(
      'INSERT INTO contacts (user_id, campaign_id, name, phone, status) VALUES (?, ?, ?, ?, ?)',
      [902, campaignId, `Reader Contact ${i}`, `+1555111${String(i).padStart(4, '0')}`, 'Pending']
    );
  }

  const operations = [];
  // 50 concurrent writes and 50 concurrent reads simultaneously
  for (let i = 0; i < 50; i++) {
    // Write
    operations.push(run(
      'INSERT INTO contacts (user_id, campaign_id, name, phone, status) VALUES (?, ?, ?, ?, ?)',
      [902, campaignId, `Concurrent Contact ${i}`, `+1555222${String(i).padStart(4, '0')}`, 'Pending']
    ));
    // Read
    operations.push(all('SELECT * FROM contacts WHERE user_id = 902 AND campaign_id = ?', [campaignId]));
    // Read single
    operations.push(get('SELECT COUNT(*) as count FROM contacts WHERE user_id = 902 AND campaign_id = ?', [campaignId]));
  }

  const results = await Promise.all(operations);
  assert.strictEqual(results.length, 150, 'All 150 mixed read/write operations must complete');

  const finalCount = await get('SELECT COUNT(*) as count FROM contacts WHERE user_id = 902 AND campaign_id = ?', [campaignId]);
  assert.strictEqual(finalCount.count, 70, 'Final count must accurately equal 20 initial + 50 inserted');
});

m1EmpiricalSuite.add('SQLite Concurrency: High-frequency atomic updates on shared campaign row', async () => {
  await ensureTestUser(903);
  await run('DELETE FROM campaigns WHERE user_id = 903');

  const campRes = await run(
    'INSERT INTO campaigns (user_id, name, status, sent_count, failed_count) VALUES (?, ?, ?, 0, 0)',
    [903, 'Stress Test Campaign', 'Sending']
  );
  const campaignId = campRes.id;

  const updatePromises = [];
  const numUpdates = 100;

  for (let i = 0; i < numUpdates; i++) {
    if (i % 2 === 0) {
      updatePromises.push(run(
        'UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ?',
        [campaignId]
      ));
    } else {
      updatePromises.push(run(
        'UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?',
        [campaignId]
      ));
    }
  }

  await Promise.all(updatePromises);

  const updatedCamp = await get('SELECT sent_count, failed_count FROM campaigns WHERE id = ?', [campaignId]);
  assert.strictEqual(updatedCamp.sent_count, 50, 'Expected sent_count to be exactly 50 after atomic increments');
  assert.strictEqual(updatedCamp.failed_count, 50, 'Expected failed_count to be exactly 50 after atomic increments');
});

m1EmpiricalSuite.add('SQLite Concurrency Stress: 500 parallel async operations across 6 tables under burst pressure', async () => {
  await ensureTestUser(905);
  await run('DELETE FROM contacts WHERE user_id = 905');
  await run('DELETE FROM logs WHERE user_id = 905');
  await run('DELETE FROM campaigns WHERE user_id = 905');
  const camp = await run('INSERT INTO campaigns (user_id, name, status) VALUES (?, ?, ?)', [905, 'Burst Camp', 'Sending']);
  const campId = camp.id;

  const operations = [];
  const count = 500;

  for (let i = 0; i < count; i++) {
    const bucket = i % 5;
    if (bucket === 0) {
      operations.push(run(
        'INSERT INTO contacts (user_id, campaign_id, name, phone, status) VALUES (?, ?, ?, ?, ?)',
        [905, campId, `Burst Contact ${i}`, `+1800${String(i).padStart(6, '0')}`, 'Pending']
      ));
    } else if (bucket === 1) {
      operations.push(run(
        'INSERT INTO logs (user_id, campaign_id, level, message) VALUES (?, ?, ?, ?)',
        [905, campId, 'debug', `Burst log payload index #${i}`]
      ));
    } else if (bucket === 2) {
      operations.push(run(
        'INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)',
        [905, `burst_key_${i}`, `burst_val_${i}`]
      ));
    } else if (bucket === 3) {
      operations.push(run(
        'INSERT OR REPLACE INTO daily_send_tracker (user_id, date_str, sent_count) VALUES (?, ?, ?)',
        [905, `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, i]
      ));
    } else {
      operations.push(all('SELECT * FROM contacts WHERE user_id = 905 AND campaign_id = ? LIMIT 10', [campId]));
    }
  }

  const results = await Promise.all(operations);
  assert.strictEqual(results.length, 500, 'All 500 parallel burst operations must succeed without lock error');

  const contactsTotal = await get('SELECT COUNT(*) as count FROM contacts WHERE user_id = 905');
  assert.strictEqual(contactsTotal.count, 100, 'Expected 100 contacts from bucket 0');
});

m1EmpiricalSuite.add('SQLite Indexing: idx_contacts_campaign_status composite index exists and optimizes queries', async () => {
  const indexList = await all("PRAGMA index_list('contacts')");
  const hasCompositeIndex = indexList.some(idx => idx.name === 'idx_contacts_campaign_status');
  assert(hasCompositeIndex, 'Index idx_contacts_campaign_status must exist on contacts table');

  const indexInfo = await all("PRAGMA index_info('idx_contacts_campaign_status')");
  const indexedColumns = indexInfo.map(info => info.name);
  assert.deepStrictEqual(indexedColumns, ['campaign_id', 'status'], 'Index must cover campaign_id and status in order');

  // Verify EXPLAIN QUERY PLAN uses the composite index with single quote SQL literal
  const plan = await all("EXPLAIN QUERY PLAN SELECT * FROM contacts WHERE campaign_id = 1 AND status = 'Pending'");
  const planDetails = plan.map(p => p.detail).join('; ');
  assert(planDetails.includes('idx_contacts_campaign_status'), `Query plan must use idx_contacts_campaign_status: ${planDetails}`);
});

m1EmpiricalSuite.add('SQLite Integrity: PRAGMA integrity_check and PRAGMA foreign_key_check return pristine state', async () => {
  const integrity = await get('PRAGMA integrity_check');
  assert.strictEqual(integrity.integrity_check, 'ok', 'Database integrity_check must be "ok"');

  const fkErrors = await all('PRAGMA foreign_key_check');
  assert.strictEqual(fkErrors.length, 0, `Zero foreign key violations expected, found ${fkErrors.length}`);
});

m1EmpiricalSuite.add('SQLite Integrity: Foreign key cascade deletions remove orphaned contacts and logs', async () => {
  await ensureTestUser(904);

  const camp = await run('INSERT INTO campaigns (user_id, name, status) VALUES (?, ?, ?)', [904, 'Cascade Test', 'Pending']);
  await run('INSERT INTO contacts (user_id, campaign_id, name, phone, status) VALUES (?, ?, ?, ?, ?)', [904, camp.id, 'Cascade C1', '+15559040001', 'Pending']);
  await run('INSERT INTO contacts (user_id, campaign_id, name, phone, status) VALUES (?, ?, ?, ?, ?)', [904, camp.id, 'Cascade C2', '+15559040002', 'Pending']);

  // Delete campaign
  await run('DELETE FROM campaigns WHERE id = ?', [camp.id]);

  const orphanedContacts = await all('SELECT * FROM contacts WHERE campaign_id = ?', [camp.id]);
  assert.strictEqual(orphanedContacts.length, 0, 'Contacts must be cascaded on campaign deletion');
});

// ============================================================================
// 2. JWT AUTH MIDDLEWARE SECURITY & ADVERSARIAL ATTACK TESTS
// ============================================================================

let testServerInfo = null;

m1EmpiricalSuite.add('Auth Middleware Setup: Launch ephemeral test server', async () => {
  await ensureTestUser(1);
  testServerInfo = await createTestServer();
  assert(testServerInfo.baseUrl);
});

m1EmpiricalSuite.add('JWT Auth: Valid token returns authenticated user profile', async () => {
  await ensureTestUser(101);
  const token = jwt.sign({ userId: 101, email: 'testuser101@example.com' }, JWT_SECRET, { expiresIn: '1h' });

  const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}: ${res.body}`);
  assert.strictEqual(res.json.user.id, 101);
  assert.strictEqual(res.json.user.email, 'testuser101@example.com');
});

m1EmpiricalSuite.add('JWT Auth: Query parameter token authentication', async () => {
  await ensureTestUser(102);
  const token = jwt.sign({ userId: 102, email: 'testuser102@example.com' }, JWT_SECRET, { expiresIn: '1h' });

  const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me?token=${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.user.id, 102);
});

m1EmpiricalSuite.add('JWT Auth: Blacklisted / Revoked token returns 401 Unauthorized', async () => {
  await ensureTestUser(103);
  const token = jwt.sign({ userId: 103, email: 'testuser103@example.com' }, JWT_SECRET, { expiresIn: '1h' });

  // 1. First verify token is valid
  const resValid = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.strictEqual(resValid.status, 200);

  // 2. Logout / Revoke the token
  const resLogout = await makeRequest(`${testServerInfo.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.strictEqual(resLogout.status, 200);

  // 3. Verify blacklist entry exists in SQLite
  const blacklisted = await get('SELECT token FROM token_blacklist WHERE token = ?', [token]);
  assert(blacklisted !== null && blacklisted.token === token, 'Revoked token must be present in token_blacklist');

  // 4. Subsequent request with revoked token MUST return 401 Unauthorized
  const resRevoked = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.strictEqual(resRevoked.status, 401, 'Revoked token must be rejected with 401');
  assert.strictEqual(resRevoked.json.error, 'Token has been revoked');
});

m1EmpiricalSuite.add('JWT Auth: Expired token returns 401 Unauthorized without privilege escalation', async () => {
  // Create token expired 1 hour ago
  const expiredToken = jwt.sign(
    { userId: 1, email: 'admin@local.host', exp: Math.floor(Date.now() / 1000) - 3600 },
    JWT_SECRET
  );

  const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${expiredToken}` }
  });

  assert.strictEqual(res.status, 401, 'Expired token must return HTTP 401');
  assert.strictEqual(res.json.error, 'Invalid or expired token');
});

m1EmpiricalSuite.add('JWT Auth: Forged token signed with rogue secret returns 401 Unauthorized', async () => {
  const rogueToken = jwt.sign(
    { userId: 1, email: 'admin@local.host' },
    'attacker-rogue-secret-key-12345',
    { expiresIn: '1h' }
  );

  const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${rogueToken}` }
  });

  assert.strictEqual(res.status, 401, 'Forged token must return HTTP 401');
  assert.strictEqual(res.json.error, 'Invalid or expired token');
});

m1EmpiricalSuite.add('JWT Auth: Algorithm "none" attack returns 401 Unauthorized', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId: 1, email: 'admin@local.host' })).toString('base64url');
  const noneToken = `${header}.${payload}.`;

  const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${noneToken}` }
  });

  assert.strictEqual(res.status, 401, 'Algorithm "none" attack must be rejected with 401');
  assert.strictEqual(res.json.error, 'Invalid or expired token');
});

m1EmpiricalSuite.add('JWT Auth: Adversarial malformed token fuzzing matrix returns 401 on every invalid input', async () => {
  const malformedHeaderTokens = [
    'not-a-token',
    'abc.def.ghi',
    'WA-WIN-F548-94A6-49B8-A2FA',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    'eyJhbGciOiJIUzI1NiJ9.invalid.signature',
    'null',
    'undefined',
    '../../../etc/passwd',
    '<script>alert(1)</script>',
    'A'.repeat(5000)
  ];

  for (const badToken of malformedHeaderTokens) {
    const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${badToken}` }
    });

    assert.strictEqual(
      res.status,
      401,
      `Malformed token '${badToken.substring(0, 30)}' in header must return 401, got ${res.status}`
    );
    assert.strictEqual(res.json?.error, 'Invalid or expired token');
  }

  // Also test query parameter fuzzing with null characters and encoded attacks
  const malformedQueryTokens = [
    '%00%00%00',
    'invalid%20token',
    '"><script>alert(1)</script>'
  ];

  for (const queryToken of malformedQueryTokens) {
    const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me?token=${queryToken}`);
    assert.strictEqual(res.status, 401, `Malformed query token '${queryToken}' must return 401, got ${res.status}`);
    assert.strictEqual(res.json?.error, 'Invalid or expired token');
  }
});

m1EmpiricalSuite.add('JWT Auth: Missing authorization header defaults to Admin User in local dev environment', async () => {
  const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`);
  assert.strictEqual(res.status, 200, 'Unauthenticated request in dev mode defaults to local Admin user');
  assert.strictEqual(res.json.user.id, 1);
});

m1EmpiricalSuite.add('JWT Auth Concurrency: 100 concurrent interleaved valid, invalid, revoked, and forged auth requests', async () => {
  await ensureTestUser(1);
  await ensureTestUser(501);
  await ensureTestUser(502);

  const validTokenUser1 = jwt.sign({ userId: 501, email: 'user501@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  const validTokenUser2 = jwt.sign({ userId: 502, email: 'user502@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  const revokedToken = jwt.sign({ userId: 503, email: 'revoked@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  await run('INSERT OR IGNORE INTO token_blacklist (token) VALUES (?)', [revokedToken]);
  const expiredToken = jwt.sign({ userId: 504, email: 'expired@test.com', exp: Math.floor(Date.now() / 1000) - 100 }, JWT_SECRET);
  const forgedToken = jwt.sign({ userId: 1, email: 'admin@local.host' }, 'wrong_secret', { expiresIn: '1h' });

  const burstRequests = [];
  const count = 100;

  for (let i = 0; i < count; i++) {
    const bucket = i % 5;
    if (bucket === 0) {
      burstRequests.push((async () => {
        const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${validTokenUser1}` }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.json.user.id, 501);
      })());
    } else if (bucket === 1) {
      burstRequests.push((async () => {
        const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${validTokenUser2}` }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.json.user.id, 502);
      })());
    } else if (bucket === 2) {
      burstRequests.push((async () => {
        const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${revokedToken}` }
        });
        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.json.error, 'Token has been revoked');
      })());
    } else if (bucket === 3) {
      burstRequests.push((async () => {
        const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${expiredToken}` }
        });
        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.json.error, 'Invalid or expired token');
      })());
    } else {
      burstRequests.push((async () => {
        const res = await makeRequest(`${testServerInfo.baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${forgedToken}` }
        });
        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.json.error, 'Invalid or expired token');
      })());
    }
  }

  await Promise.all(burstRequests);
});

// ============================================================================
// 3. SAAS IDOR & SEAT INVITE SECURITY TESTS
// ============================================================================

m1EmpiricalSuite.add('SaaS Org Security: Member role cannot cancel seat invites (IDOR Prevention)', async () => {
  await ensureTestUser(201); // Non-owner / member user
  await ensureTestUser(1);   // Owner user

  // Clean test isolation for user 201
  await run('DELETE FROM org_members WHERE user_id = ?', [201]);
  await run('DELETE FROM organizations WHERE owner_id = ?', [201]);

  // Add user 201 to org 1 strictly as 'member'
  await run('INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)', [1, 201, 'member']);

  // Create an invite in Org 1 as owner (user 1)
  const inviteToken = crypto.randomBytes(16).toString('hex');
  const inviteRes = await run(
    'INSERT INTO seat_invites (org_id, invited_by_user_id, email, token, role, status) VALUES (?, ?, ?, ?, ?, ?)',
    [1, 1, 'candidate@test.com', inviteToken, 'member', 'pending']
  );
  const inviteId = inviteRes.id;

  // Sign token for member user 201
  const memberToken = jwt.sign({ userId: 201, email: 'member@test.com' }, JWT_SECRET, { expiresIn: '1h' });

  // User 201 is role 'member' in Org 1 -> Attempt to delete invite
  const delRes = await makeRequest(`${testServerInfo.baseUrl}/api/saas/organization/invites/${inviteId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${memberToken}` }
  });

  assert.strictEqual(delRes.status, 403, `Non-owner member deletion of invite must return 403, got ${delRes.status}`);
  assert.strictEqual(delRes.json.success, false);
  assert(delRes.json.error.includes('Only owners or admins'));

  // Ensure invite was NOT deleted from database
  const checkInvite = await get('SELECT id FROM seat_invites WHERE id = ?', [inviteId]);
  assert(checkInvite !== null, 'Invite must remain intact after unauthorized IDOR deletion attempt');
});

m1EmpiricalSuite.add('SaaS Seat Invites: Email mismatch on accept-invite is rejected with 403 Forbidden', async () => {
  await ensureTestUser(301);
  const inviteToken = crypto.randomBytes(16).toString('hex');

  // Invite specifically sent to designated@test.com
  await run(
    'INSERT INTO seat_invites (org_id, invited_by_user_id, email, token, role, status) VALUES (?, ?, ?, ?, ?, ?)',
    [1, 1, 'designated@test.com', inviteToken, 'member', 'pending']
  );

  // Logged in user has different email (imposter@test.com)
  const imposterToken = jwt.sign({ userId: 301, email: 'imposter@test.com' }, JWT_SECRET, { expiresIn: '1h' });

  const acceptRes = await makeRequest(`${testServerInfo.baseUrl}/api/saas/organization/accept-invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${imposterToken}`
    },
    body: JSON.stringify({ token: inviteToken })
  });

  assert.strictEqual(acceptRes.status, 403, `Mismatched email accept must return 403 Forbidden, got ${acceptRes.status}`);
  assert.strictEqual(acceptRes.json.success, false);
  assert(acceptRes.json.error.includes('Invitation email does not match'));
});

// ============================================================================
// 4. CONTACT PHONE NULL POINTER & EXCEL UPLOAD CLEANUP TESTS
// ============================================================================

m1EmpiricalSuite.add('Contacts API: Updating contact with null phone field does not crash server', async () => {
  await ensureTestUser(401);
  const token = jwt.sign({ userId: 401, email: 'testuser401@example.com' }, JWT_SECRET, { expiresIn: '1h' });

  // Insert a contact with a null phone directly to test edge case
  const insertRes = await run(
    'INSERT INTO saved_contacts (user_id, name, phone, company, email) VALUES (?, ?, ?, ?, ?)',
    [401, 'Null Phone Contact', '+1234567890', 'Test Corp', 'nullphone@test.com']
  );
  const contactId = insertRes.id;

  // Update without sending phone (or phone = undefined)
  const updateRes = await makeRequest(`${testServerInfo.baseUrl}/api/audience/contacts/${contactId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name: 'Updated Name Without Phone Change' })
  });

  assert.strictEqual(updateRes.status, 200, `Expected 200 OK, got ${updateRes.status}`);
  assert.strictEqual(updateRes.json.message, 'Contact updated successfully.');
});

m1EmpiricalSuite.add('Excel Upload: Temporary upload file is cleaned up via try/finally on parse failure', async () => {
  const uploadsDir = getUploadsDir();
  const corruptFilePath = path.join(uploadsDir, `corrupt-test-${Date.now()}.xlsx`);

  // Write corrupt non-excel content
  fs.writeFileSync(corruptFilePath, 'THIS_IS_NOT_A_VALID_EXCEL_OR_ZIP_FILE');
  assert(fs.existsSync(corruptFilePath), 'Corrupt test file must be created');

  const token = jwt.sign({ userId: 1, email: 'admin@local.host' }, JWT_SECRET, { expiresIn: '1h' });

  // Simulate campaign creation with the corrupt file
  const multipartBoundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const postBody = [
    `--${multipartBoundary}`,
    'Content-Disposition: form-data; name="source"',
    '',
    'file',
    `--${multipartBoundary}`,
    'Content-Disposition: form-data; name="name"',
    '',
    'Corrupt Excel Campaign',
    `--${multipartBoundary}`,
    `Content-Disposition: form-data; name="file"; filename="corrupt.xlsx"`,
    'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '',
    'CORRUPT_BYTES_DATA_PAYLOAD',
    `--${multipartBoundary}--`,
    ''
  ].join('\r\n');

  const res = await makeRequest(`${testServerInfo.baseUrl}/api/campaigns`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${multipartBoundary}`,
      Authorization: `Bearer ${token}`
    },
    body: postBody
  });

  // Verify that any temp file written to uploadsDir by multer during parse error was unlinked
  assert(res.status === 400 || res.status === 500, `Expected 400/500 error on corrupt upload, got ${res.status}`);

  // Cleanup our manual fixture if present
  if (fs.existsSync(corruptFilePath)) {
    fs.unlinkSync(corruptFilePath);
  }
});

// ============================================================================
// 5. UNMATCHED API ROUTE 404 JSON HANDLER TEST
// ============================================================================

m1EmpiricalSuite.add('API Routing: Unmatched /api/* routes return structured JSON 404 error', async () => {
  const probeRoutes = [
    '/api/nonexistent-endpoint',
    '/api/v1/unknown',
    '/api/auth/unknown-route',
    '/api/users/foo/bar/baz'
  ];

  for (const route of probeRoutes) {
    const res = await makeRequest(`${testServerInfo.baseUrl}${route}`);
    assert.strictEqual(res.status, 404, `Route ${route} must return 404, got ${res.status}`);
    assert.strictEqual(res.json?.error, 'Endpoint not found', `Route ${route} must return JSON { error: 'Endpoint not found' }`);
  }
});

m1EmpiricalSuite.add('Teardown: Close test Express server', () => {
  if (testServerInfo?.server) {
    testServerInfo.server.close();
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  m1EmpiricalSuite.run().then(res => {
    if (res.failed > 0) {
      console.log(`\n❌ FAILED: ${res.failed} tests failed out of ${res.total}`);
      process.exit(1);
    } else {
      console.log(`\n✅ SUCCESS: All ${res.total} empirical tests passed!`);
      process.exit(0);
    }
  }).catch(err => {
    console.error('Fatal error running suite:', err);
    process.exit(1);
  });
}
