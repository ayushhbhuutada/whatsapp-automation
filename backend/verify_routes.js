import express from 'express';
import jwt from 'jsonwebtoken';
import routes from './routes.js';
import db, { run, get, all } from './database.js';
import assert from 'assert';

const app = express();
app.use(express.json());
app.use('/api', routes);

const server = app.listen(0, async () => {
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Test Express server running at ${baseUrl}`);

  try {
    // Generate valid JWT token for test user ID 1
    const token = jwt.sign({ userId: 1, email: 'test@example.com' }, 'whatsapp-saas-secret-key-2026', { expiresIn: '1h' });
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    console.log('\n--- Testing GET /api/anti-ban/health ---');
    const resHealth = await fetch(`${baseUrl}/api/anti-ban/health`, { headers });
    const jsonHealth = await resHealth.json();
    console.log('GET /anti-ban/health:', jsonHealth);
    assert(jsonHealth.success === true, 'Health route envelope missing success: true');
    assert(typeof jsonHealth.healthScore === 'number', 'Health score missing');
    assert(jsonHealth.checks !== undefined, 'Health checks field missing');

    console.log('\n--- Testing GET /api/anti-ban/settings ---');
    const resGetSettings = await fetch(`${baseUrl}/api/anti-ban/settings`, { headers });
    const jsonGetSettings = await resGetSettings.json();
    console.log('GET /anti-ban/settings:', jsonGetSettings);
    assert(jsonGetSettings.success === true, 'Settings GET missing success: true');
    assert(jsonGetSettings.settings.daily_limit === '25', 'Seeded daily_limit missing');

    console.log('\n--- Testing POST /api/anti-ban/settings ---');
    const resPostSettings = await fetch(`${baseUrl}/api/anti-ban/settings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ settings: { test_setting: '123' } })
    });
    const jsonPostSettings = await resPostSettings.json();
    console.log('POST /anti-ban/settings:', jsonPostSettings);
    assert(jsonPostSettings.success === true, 'Settings POST missing success: true');

    console.log('\n--- Testing POST /api/anti-ban/blacklist ---');
    const resAddBlacklist = await fetch(`${baseUrl}/api/anti-ban/blacklist`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone: '9998887770', reason: 'Test Block' })
    });
    const jsonAddBlacklist = await resAddBlacklist.json();
    console.log('POST /anti-ban/blacklist:', jsonAddBlacklist);
    assert(jsonAddBlacklist.success === true, 'Blacklist POST missing success: true');

    console.log('\n--- Testing GET /api/anti-ban/blacklist ---');
    const resGetBlacklist = await fetch(`${baseUrl}/api/anti-ban/blacklist`, { headers });
    const jsonGetBlacklist = await resGetBlacklist.json();
    console.log('GET /anti-ban/blacklist:', jsonGetBlacklist);
    assert(jsonGetBlacklist.success === true, 'Blacklist GET missing success: true');
    assert(Array.isArray(jsonGetBlacklist.blacklist), 'Blacklist field must be array');

    console.log('\n--- Testing DELETE /api/anti-ban/blacklist/:id (Phone string) ---');
    const resDelBlacklistPhone = await fetch(`${baseUrl}/api/anti-ban/blacklist/9998887770`, {
      method: 'DELETE',
      headers
    });
    const jsonDelBlacklistPhone = await resDelBlacklistPhone.json();
    console.log('DELETE /anti-ban/blacklist/9998887770:', jsonDelBlacklistPhone);
    assert(jsonDelBlacklistPhone.success === true, 'Blacklist DELETE by phone string failed');

    console.log('\n--- Testing POST /api/anti-ban/spintax/test ---');
    const resSpintaxTest = await fetch(`${baseUrl}/api/anti-ban/spintax/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: '{Hello|Hi} world' })
    });
    const jsonSpintaxTest = await resSpintaxTest.json();
    console.log('POST /anti-ban/spintax/test:', jsonSpintaxTest);
    assert(jsonSpintaxTest.success === true, 'Spintax test route missing success: true');
    assert(typeof jsonSpintaxTest.result === 'string', 'Spintax test result missing');

    console.log('\n--- Testing POST /api/anti-ban/spintax-preview (alias) ---');
    const resSpintaxPreview = await fetch(`${baseUrl}/api/anti-ban/spintax-preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ template: '{Hello|Hi} world' })
    });
    const jsonSpintaxPreview = await resSpintaxPreview.json();
    console.log('POST /anti-ban/spintax-preview:', jsonSpintaxPreview);
    assert(jsonSpintaxPreview.success === true, 'Spintax preview route missing success: true');

    console.log('\n=== ALL ROUTE TESTS PASSED SUCCESSFULLY! ===');
    server.close();
  } catch (err) {
    console.error('❌ Route test failed:', err);
    server.close();
    process.exitCode = 1;
  }
});
