import express from 'express';
import jwt from 'jsonwebtoken';
import assert from 'assert';
import http from 'http';
import db, { run, get, all } from './database.js';
import routes, { authMiddleware } from './routes.js';

const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp-saas-secret-key-2026';

// Build express app mirroring server.js structure
const app = express();
app.use(express.json());
app.use('/api', routes);

// JSON 404 handler for unmatched /api/* routes exactly as in server.js
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Fallback error handler
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

async function runChallengerTestSuite() {
  console.log('========================================================================');
  console.log('   CHALLENGER EMPIRICAL VERIFICATION HARNESS (MILESTONE 1 - RUN 2)     ');
  console.log('========================================================================\n');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Ephemeral Test Server listening on: ${baseUrl}\n`);

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    records: []
  };

  function testAssert(name, condition, details = '') {
    results.total++;
    if (condition) {
      results.passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } else {
      results.failed++;
      console.error(`  ❌ [FAIL] ${name} -> ${details}`);
    }
    results.records.push({ name, passed: Boolean(condition), details });
  }

  try {
    // -------------------------------------------------------------------------
    // SETUP: Clean up test accounts & tables
    // -------------------------------------------------------------------------
    const testUserIds = [801, 802, 803, 804, 805, 901];
    for (const uid of testUserIds) {
      await run('DELETE FROM users WHERE id = ?', [uid]);
    }
    await run('DELETE FROM seat_invites WHERE invited_by_user_id IN (801, 802, 803, 804, 805, 901)');
    await run('DELETE FROM org_members WHERE user_id IN (801, 802, 803, 804, 805, 901)');
    await run('DELETE FROM organizations WHERE owner_id IN (801, 802, 803, 804, 805, 901)');

    // Create Test Users
    await run("INSERT INTO users (id, name, email, password_hash) VALUES (801, 'Org1 Owner', 'owner_org1@test.com', 'hash')", []);
    await run("INSERT INTO users (id, name, email, password_hash) VALUES (802, 'Org1 Admin', 'admin_org1@test.com', 'hash')", []);
    await run("INSERT INTO users (id, name, email, password_hash) VALUES (803, 'Org1 Member', 'member_org1@test.com', 'hash')", []);
    await run("INSERT INTO users (id, name, email, password_hash) VALUES (804, 'Mismatched User', 'mismatched@test.com', 'hash')", []);
    await run("INSERT INTO users (id, name, email, password_hash) VALUES (805, 'Invited Target', 'invited_target@test.com', 'hash')", []);
    await run("INSERT INTO users (id, name, email, password_hash) VALUES (901, 'Org2 Owner', 'owner_org2@test.com', 'hash')", []);

    // Create Organizations
    const resOrg1 = await run("INSERT INTO organizations (name, owner_id, plan_tier, seat_limit, monthly_price_per_seat) VALUES ('Org Alpha', 801, 'pro_desktop', 5, 0.00)", []);
    const org1Id = resOrg1.id;
    await run("INSERT INTO org_members (org_id, user_id, role) VALUES (?, 801, 'owner')", [org1Id]);
    await run("INSERT INTO org_members (org_id, user_id, role) VALUES (?, 802, 'admin')", [org1Id]);
    await run("INSERT INTO org_members (org_id, user_id, role) VALUES (?, 803, 'member')", [org1Id]);

    const resOrg2 = await run("INSERT INTO organizations (name, owner_id, plan_tier, seat_limit, monthly_price_per_seat) VALUES ('Org Beta', 901, 'pro_desktop', 5, 0.00)", []);
    const org2Id = resOrg2.id;
    await run("INSERT INTO org_members (org_id, user_id, role) VALUES (?, 901, 'owner')", [org2Id]);

    // Generate JWTs
    const tokenOrg1Owner = jwt.sign({ userId: 801, email: 'owner_org1@test.com', name: 'Org1 Owner' }, JWT_SECRET, { expiresIn: '1h' });
    const tokenOrg1Admin = jwt.sign({ userId: 802, email: 'admin_org1@test.com', name: 'Org1 Admin' }, JWT_SECRET, { expiresIn: '1h' });
    const tokenOrg1Member = jwt.sign({ userId: 803, email: 'member_org1@test.com', name: 'Org1 Member' }, JWT_SECRET, { expiresIn: '1h' });
    const tokenMismatched = jwt.sign({ userId: 804, email: 'mismatched@test.com', name: 'Mismatched User' }, JWT_SECRET, { expiresIn: '1h' });
    const tokenInvitedTarget = jwt.sign({ userId: 805, email: 'INVITED_TARGET@TEST.COM', name: 'Invited Target' }, JWT_SECRET, { expiresIn: '1h' });
    const tokenOrg2Owner = jwt.sign({ userId: 901, email: 'owner_org2@test.com', name: 'Org2 Owner' }, JWT_SECRET, { expiresIn: '1h' });

    console.log('--- 1. Testing SaaS Multi-Tenant Seat Operations: Invite Cancellation Permissions ---');

    // Create 3 invites in Org 1
    const resInv1 = await run("INSERT INTO seat_invites (org_id, invited_by_user_id, email, token, role, status) VALUES (?, 801, 'invitee1@test.com', 'tok_inv_1', 'member', 'pending')", [org1Id]);
    const inv1Id = resInv1.id;

    const resInv2 = await run("INSERT INTO seat_invites (org_id, invited_by_user_id, email, token, role, status) VALUES (?, 802, 'invitee2@test.com', 'tok_inv_2', 'member', 'pending')", [org1Id]);
    const inv2Id = resInv2.id;

    const resInv3 = await run("INSERT INTO seat_invites (org_id, invited_by_user_id, email, token, role, status) VALUES (?, 801, 'invitee3@test.com', 'tok_inv_3', 'member', 'pending')", [org1Id]);
    const inv3Id = resInv3.id;

    // 1.1 Regular Member attempts to cancel invite 1 -> MUST BE REJECTED 403
    const respMemberCancel = await fetch(`${baseUrl}/api/saas/organization/invites/${inv1Id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenOrg1Member}` }
    });
    const jsonMemberCancel = await respMemberCancel.json();
    const dbInv1AfterMember = await get("SELECT * FROM seat_invites WHERE id = ?", [inv1Id]);

    testAssert(
      'Member role cancellation is rejected with HTTP 403 Forbidden',
      respMemberCancel.status === 403 && jsonMemberCancel.success === false && jsonMemberCancel.error.includes('Only owners or admins'),
      `Status: ${respMemberCancel.status}, Error: ${jsonMemberCancel.error}`
    );
    testAssert(
      'Invite 1 remains intact in database after unauthorized member cancellation attempt',
      Boolean(dbInv1AfterMember && dbInv1AfterMember.status === 'pending'),
      `DB Invite status: ${dbInv1AfterMember?.status}`
    );

    // 1.2 Admin cancels invite 1 -> MUST SUCCEED 200
    const respAdminCancel = await fetch(`${baseUrl}/api/saas/organization/invites/${inv1Id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenOrg1Admin}` }
    });
    const jsonAdminCancel = await respAdminCancel.json();
    const dbInv1AfterAdmin = await get("SELECT * FROM seat_invites WHERE id = ?", [inv1Id]);

    testAssert(
      'Admin role cancels invite successfully with HTTP 200 JSON',
      respAdminCancel.status === 200 && jsonAdminCancel.success === true && jsonAdminCancel.message.includes('canceled'),
      `Status: ${respAdminCancel.status}, Msg: ${jsonAdminCancel.message}`
    );
    testAssert(
      'Invite 1 is removed from database after Admin cancellation',
      dbInv1AfterAdmin === undefined,
      `DB row exists: ${Boolean(dbInv1AfterAdmin)}`
    );

    // 1.3 Owner cancels invite 2 -> MUST SUCCEED 200
    const respOwnerCancel = await fetch(`${baseUrl}/api/saas/organization/invites/${inv2Id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenOrg1Owner}` }
    });
    const jsonOwnerCancel = await respOwnerCancel.json();
    const dbInv2AfterOwner = await get("SELECT * FROM seat_invites WHERE id = ?", [inv2Id]);

    testAssert(
      'Owner role cancels invite successfully with HTTP 200 JSON',
      respOwnerCancel.status === 200 && jsonOwnerCancel.success === true && jsonOwnerCancel.message.includes('canceled'),
      `Status: ${respOwnerCancel.status}, Msg: ${jsonOwnerCancel.message}`
    );
    testAssert(
      'Invite 2 is removed from database after Owner cancellation',
      dbInv2AfterOwner === undefined,
      `DB row exists: ${Boolean(dbInv2AfterOwner)}`
    );

    // 1.4 Cross-Tenant IDOR: Owner of Org 2 attempts to delete Invite 3 from Org 1
    const respCrossOrgCancel = await fetch(`${baseUrl}/api/saas/organization/invites/${inv3Id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenOrg2Owner}` }
    });
    const jsonCrossOrgCancel = await respCrossOrgCancel.json();
    const dbInv3AfterCross = await get("SELECT * FROM seat_invites WHERE id = ?", [inv3Id]);

    testAssert(
      'Cross-tenant invite deletion is isolated (Invite 3 belonging to Org 1 remains untouched)',
      Boolean(dbInv3AfterCross && dbInv3AfterCross.org_id === org1Id),
      `Invite 3 still exists in DB: ${Boolean(dbInv3AfterCross)}, OrgId: ${dbInv3AfterCross?.org_id}`
    );

    console.log('\n--- 2. Testing SaaS Multi-Tenant Seat Operations: Invite Acceptance Matching vs Mismatched Email ---');

    // Create an invite for invited_target@test.com
    const targetEmail = 'invited_target@test.com';
    const targetToken = 'tok_target_email_12345';
    await run("DELETE FROM seat_invites WHERE token = ?", [targetToken]);
    await run(`
      INSERT INTO seat_invites (org_id, invited_by_user_id, email, token, role, status)
      VALUES (?, 801, ?, ?, 'admin', 'pending')
    `, [org1Id, targetEmail, targetToken]);

    // 2.1 Missing token -> HTTP 400
    const respMissingToken = await fetch(`${baseUrl}/api/saas/organization/accept-invite`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenMismatched}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const jsonMissingToken = await respMissingToken.json();
    testAssert(
      'Accept invite with missing token returns HTTP 400',
      respMissingToken.status === 400 && jsonMissingToken.success === false && jsonMissingToken.error.includes('required'),
      `Status: ${respMissingToken.status}, Error: ${jsonMissingToken.error}`
    );

    // 2.2 Invalid / Non-existent token -> HTTP 400
    const respInvalidToken = await fetch(`${baseUrl}/api/saas/organization/accept-invite`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenMismatched}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'non_existent_token_999' })
    });
    const jsonInvalidToken = await respInvalidToken.json();
    testAssert(
      'Accept invite with non-existent token returns HTTP 400',
      respInvalidToken.status === 400 && jsonInvalidToken.success === false && jsonInvalidToken.error.includes('Invalid or expired'),
      `Status: ${respInvalidToken.status}, Error: ${jsonInvalidToken.error}`
    );

    // 2.3 Mismatched Email acceptance attempt -> HTTP 403 Forbidden
    const respMismatched = await fetch(`${baseUrl}/api/saas/organization/accept-invite`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenMismatched}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: targetToken })
    });
    const jsonMismatched = await respMismatched.json();
    const dbInvPendingAfterMismatch = await get("SELECT * FROM seat_invites WHERE token = ?", [targetToken]);
    const dbMemberMismatch = await get("SELECT * FROM org_members WHERE org_id = ? AND user_id = 804", [org1Id]);

    testAssert(
      'Accept invite with mismatched email is rejected with HTTP 403 Forbidden',
      respMismatched.status === 403 && jsonMismatched.success === false && jsonMismatched.error.includes('does not match'),
      `Status: ${respMismatched.status}, Error: ${jsonMismatched.error}`
    );
    testAssert(
      'Mismatched user is NOT added to organization members table',
      dbMemberMismatch === undefined,
      `User 804 member row exists: ${Boolean(dbMemberMismatch)}`
    );
    testAssert(
      'Invite token remains pending in database after mismatched attempt',
      Boolean(dbInvPendingAfterMismatch && dbInvPendingAfterMismatch.status === 'pending'),
      `Invite status: ${dbInvPendingAfterMismatch?.status}`
    );

    // 2.4 Matching Email (case-insensitive) acceptance -> HTTP 200 OK
    const respMatching = await fetch(`${baseUrl}/api/saas/organization/accept-invite`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenInvitedTarget}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: targetToken })
    });
    const jsonMatching = await respMatching.json();
    const dbInvAccepted = await get("SELECT * FROM seat_invites WHERE token = ?", [targetToken]);
    const dbMemberAccepted = await get("SELECT * FROM org_members WHERE org_id = ? AND user_id = 805", [org1Id]);

    testAssert(
      'Accept invite with matching email succeeds with HTTP 200 JSON',
      respMatching.status === 200 && jsonMatching.success === true && jsonMatching.message.includes('Successfully joined'),
      `Status: ${respMatching.status}, Msg: ${jsonMatching.message}`
    );
    testAssert(
      'Target user 805 is enrolled into org_members with assigned role (admin)',
      Boolean(dbMemberAccepted && dbMemberAccepted.role === 'admin'),
      `Member role: ${dbMemberAccepted?.role}`
    );
    testAssert(
      'Invite status is updated to accepted in database',
      Boolean(dbInvAccepted && dbInvAccepted.status === 'accepted'),
      `Invite status: ${dbInvAccepted?.status}`
    );

    // 2.5 Replay Attack: Attempt to accept the same token again -> HTTP 400
    const respReplay = await fetch(`${baseUrl}/api/saas/organization/accept-invite`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenInvitedTarget}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: targetToken })
    });
    const jsonReplay = await respReplay.json();
    testAssert(
      'Replay attack on accepted invite token returns HTTP 400 (not pending)',
      respReplay.status === 400 && jsonReplay.success === false && jsonReplay.error.includes('Invalid or expired'),
      `Status: ${respReplay.status}, Error: ${jsonReplay.error}`
    );

    // 2.6 Seat Quota Limit on Invite Acceptance -> HTTP 400
    // Set seat limit to 4 in Org 1 (already occupied by 801, 802, 803, 805 = 4 members)
    await run("UPDATE organizations SET seat_limit = 4 WHERE id = ?", [org1Id]);
    const quotaToken = 'tok_quota_test_666';
    await run(`
      INSERT INTO seat_invites (org_id, invited_by_user_id, email, token, role, status)
      VALUES (?, 801, 'overflow_user@test.com', ?, 'member', 'pending')
    `, [org1Id, quotaToken]);
    await run("INSERT OR REPLACE INTO users (id, name, email, password_hash) VALUES (806, 'Overflow User', 'overflow_user@test.com', 'hash')", []);
    const tokenOverflow = jwt.sign({ userId: 806, email: 'overflow_user@test.com', name: 'Overflow User' }, JWT_SECRET, { expiresIn: '1h' });

    const respQuotaFull = await fetch(`${baseUrl}/api/saas/organization/accept-invite`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenOverflow}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: quotaToken })
    });
    const jsonQuotaFull = await respQuotaFull.json();
    testAssert(
      'Accept invite when seat capacity is full returns HTTP 400 quota error',
      respQuotaFull.status === 400 && jsonQuotaFull.success === false && jsonQuotaFull.error.includes('maximum seat capacity'),
      `Status: ${respQuotaFull.status}, Error: ${jsonQuotaFull.error}`
    );

    console.log('\n--- 3. Testing API 404 JSON Routing on Random / Invalid Endpoints ---');

    const random404Endpoints = [
      { method: 'GET', path: '/api/unknown-xyz' },
      { method: 'POST', path: '/api/unknown-xyz' },
      { method: 'PUT', path: '/api/unknown-xyz' },
      { method: 'DELETE', path: '/api/unknown-xyz' },
      { method: 'GET', path: '/api/nonexistent/sub/route/test' },
      { method: 'POST', path: '/api/campaigns/9999/fake-action' },
      { method: 'GET', path: `/api/random_${Math.random().toString(36).substring(7)}` },
      { method: 'GET', path: '/api/v1/ghost-route' },
      { method: 'POST', path: '/api/auth/undefined-action' },
      { method: 'DELETE', path: '/api/settings/invalid/key/path' }
    ];

    for (const ep of random404Endpoints) {
      const resp = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: { 'Authorization': `Bearer ${tokenOrg1Owner}` }
      });
      const contentType = resp.headers.get('content-type') || '';
      let jsonBody = null;
      try {
        jsonBody = await resp.json();
      } catch (e) {}

      const is404 = resp.status === 404;
      const isJsonHeader = contentType.includes('application/json');
      const hasErrorField = jsonBody && typeof jsonBody.error === 'string' && jsonBody.error === 'Endpoint not found';

      testAssert(
        `${ep.method} ${ep.path} returns HTTP 404 JSON with { error: 'Endpoint not found' }`,
        is404 && isJsonHeader && hasErrorField,
        `Status: ${resp.status}, Content-Type: ${contentType}, Body: ${JSON.stringify(jsonBody)}`
      );
    }

    console.log('\n--- 4. Testing Core Security & Concurrency Pragmas ---');

    // 4.1 Token Blacklist Revocation Enforcement
    const revokedToken = jwt.sign({ userId: 801, email: 'revoked@test.com' }, JWT_SECRET, { expiresIn: '1h' });
    await run("INSERT INTO token_blacklist (token) VALUES (?)", [revokedToken]);
    const respRevoked = await fetch(`${baseUrl}/api/saas/organization`, {
      headers: { 'Authorization': `Bearer ${revokedToken}` }
    });
    const jsonRevoked = await respRevoked.json();
    testAssert(
      'Blacklisted token returns HTTP 401 Unauthorized',
      respRevoked.status === 401 && jsonRevoked.error === 'Token has been revoked',
      `Status: ${respRevoked.status}, Error: ${jsonRevoked.error}`
    );

    // 4.2 Malformed / Forged JWT returns HTTP 401 (not defaulting to admin)
    const respForged = await fetch(`${baseUrl}/api/saas/organization`, {
      headers: { 'Authorization': 'Bearer forged.invalid.token' }
    });
    const jsonForged = await respForged.json();
    testAssert(
      'Forged/invalid JWT returns HTTP 401 Unauthorized',
      respForged.status === 401 && jsonForged.error === 'Invalid or expired token',
      `Status: ${respForged.status}, Error: ${jsonForged.error}`
    );

    // 4.3 SQLite Index and Pragma verification
    const indexes = await all("SELECT name FROM sqlite_master WHERE type='index'");
    const indexNames = indexes.map(i => i.name);
    testAssert(
      'Composite index idx_contacts_campaign_status exists in SQLite',
      indexNames.includes('idx_contacts_campaign_status'),
      `Found indexes: ${indexNames.join(', ')}`
    );

  } catch (error) {
    console.error('❌ Uncaught exception during harness run:', error);
    testAssert('Harness run without uncaught exceptions', false, error.message);
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n========================================================================');
  console.log(`  FINAL VERIFICATION SUMMARY: ${results.passed}/${results.total} TESTS PASSED (${results.failed} FAILED)`);
  console.log('========================================================================\n');

  return results;
}

runChallengerTestSuite().then((res) => {
  if (res.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
});
