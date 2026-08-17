import express from 'express';
import routes from './routes.js';
import db, { run, get, all } from './database.js';
import assert from 'assert';
import jwt from 'jsonwebtoken';

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp-saas-secret-key-2026';
const testUserId = 9901;
const token = jwt.sign({ userId: testUserId, email: 'saas_owner@test.com', name: 'SaaS Owner' }, JWT_SECRET, { expiresIn: '1h' });

app.use((req, res, next) => {
  req.user = { id: testUserId, email: 'saas_owner@test.com', name: 'SaaS Owner' };
  next();
});

app.use('/api', routes);

async function runSaaSTestSuite() {
  console.log('====================================================');
  console.log('   SAAS MULTI-TENANT PER-SEAT HARNESS TEST');
  console.log('====================================================\n');

  // Ensure user exists and clean up any previous test state for idempotence
  await run("INSERT OR REPLACE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)", [testUserId, 'SaaS Owner', 'saas_owner@test.com', 'hash123']);
  await run("DELETE FROM seat_invites WHERE org_id IN (SELECT id FROM organizations WHERE owner_id = ?)", [testUserId]);
  await run("DELETE FROM org_members WHERE user_id = ? OR org_id IN (SELECT id FROM organizations WHERE owner_id = ?)", [testUserId, testUserId]);
  await run("DELETE FROM organizations WHERE owner_id = ?", [testUserId]);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    try {
      // 1. Fetch organization details
      console.log('--- 1. Testing GET /api/saas/organization ---');
      const resOrg = await fetch(`${baseUrl}/api/saas/organization`, { headers });
      const jsonOrg = await resOrg.json();
      console.log('GET /saas/organization:', jsonOrg.organization);
      assert(jsonOrg.success === true, 'GET /saas/organization envelope missing success: true');
      assert(jsonOrg.organization.seat_limit === 5, 'Default seat limit should be 5');
      assert(jsonOrg.used_seats === 1, 'Used seats should be 1');

      // 2. Issue team member invite
      console.log('\n--- 2. Testing POST /api/saas/organization/invite ---');
      const resInvite = await fetch(`${baseUrl}/api/saas/organization/invite`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'teammate1@test.com', role: 'member' })
      });
      const jsonInvite = await resInvite.json();
      console.log('POST /saas/organization/invite:', jsonInvite);
      assert(jsonInvite.success === true, 'Invite creation failed');
      assert(typeof jsonInvite.inviteToken === 'string', 'Invite token missing');

      // 3. Test seat quota limit enforcement by filling up to seat_limit (5)
      console.log('\n--- 3. Testing Seat Quota Limit Enforcement ---');
      await fetch(`${baseUrl}/api/saas/organization/invite`, { method: 'POST', headers, body: JSON.stringify({ email: 'm2@test.com' }) });
      await fetch(`${baseUrl}/api/saas/organization/invite`, { method: 'POST', headers, body: JSON.stringify({ email: 'm3@test.com' }) });
      await fetch(`${baseUrl}/api/saas/organization/invite`, { method: 'POST', headers, body: JSON.stringify({ email: 'm4@test.com' }) });
      
      // 5th invite should exceed quota (1 owner + 4 invites = 5 occupied)
      const resOverflow = await fetch(`${baseUrl}/api/saas/organization/invite`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'm5_overflow@test.com' })
      });
      const jsonOverflow = await resOverflow.json();
      console.log('Overflow invite response:', jsonOverflow);
      assert(resOverflow.status === 400, 'Overflow invite should return HTTP 400');
      assert(jsonOverflow.success === false, 'Overflow invite should fail');
      console.log('✅ Seat quota limit enforcement passed.');

      // 4. Update seat limit capacity
      console.log('\n--- 4. Testing POST /api/saas/organization/update-seats ---');
      const resUpdateSeats = await fetch(`${baseUrl}/api/saas/organization/update-seats`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ seat_limit: 10 })
      });
      const jsonUpdateSeats = await resUpdateSeats.json();
      console.log('POST /saas/organization/update-seats:', jsonUpdateSeats);
      assert(jsonUpdateSeats.success === true, 'Update seats failed');
      assert(jsonUpdateSeats.seat_limit === 10, 'Seat limit should be updated to 10');
      console.log('✅ Scaling seat capacity passed.');

      console.log('\n====================================================');
      console.log('   ALL SAAS PER-SEAT HARNESS TESTS PASSED!');
      console.log('====================================================\n');
      server.close();
    } catch (err) {
      console.error('❌ Harness failed:', err);
      server.close(() => process.exit(1));
    }
  });
}

runSaaSTestSuite();
