import assert from 'node:assert';
import { run, get } from '../backend/database.js';
import { DEFAULT_STORE_CONFIG, getStoreConfig } from '../backend/routes.js';
import { createTestSuite } from './test_helper.js';

export const m5StoreConfigSuite = createTestSuite('Milestone 5: Dynamic Store Branding & Pricing Plans Engine');

m5StoreConfigSuite.add('5.1 Default Fallback: getStoreConfig returns full 3-tier defaults when database is unconfigured', async () => {
  await run("DELETE FROM settings WHERE key = 'store_config'");
  const config = await getStoreConfig();
  assert.strictEqual(config.brandName, 'WhatsApp Automator Pro');
  assert.strictEqual(config.plans.length, 3);
  assert.strictEqual(config.plans[0].price, '₹999');
  assert.strictEqual(config.plans[1].price, '₹4,999');
  assert.strictEqual(config.plans[2].price, '₹14,999');
});

m5StoreConfigSuite.add('5.2 Persistence: Dynamic store configuration updates in SQLite settings table', async () => {
  const customConfig = {
    brandName: 'Rudra WhatsApp Automation Suite',
    brandTagline: 'Elite Outreach Platform',
    supportEmail: 'support@rudraexpression.in',
    supportWhatsapp: '+919876543210',
    downloadUrl: 'https://rudraexpression.in/downloads/app.exe',
    razorpayKeyId: 'rzp_live_custom123',
    plans: [
      {
        id: 'starter',
        name: 'Starter Tier Custom',
        price: '₹1,299',
        priceInPaise: 129900,
        period: '/ month',
        badge: 'Starter Plus',
        desc: 'Custom starter plan description',
        validityDays: 30,
        sessionsLimit: 2,
        turboAllowed: false,
        multiSessionAllowed: false,
        features: ['2 Profiles', 'Anti-Ban Engine']
      }
    ]
  };

  await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (1, 'store_config', ?)", [JSON.stringify(customConfig)]);
  
  const saved = await getStoreConfig();
  assert.strictEqual(saved.brandName, 'Rudra WhatsApp Automation Suite');
  assert.strictEqual(saved.plans.length, 1);
  assert.strictEqual(saved.plans[0].price, '₹1,299');
  assert.strictEqual(saved.plans[0].priceInPaise, 129900);
});

m5StoreConfigSuite.add('5.3 Dynamic Plan Resolution: Checkout resolves dynamic custom pricing and quotas', async () => {
  const saved = await getStoreConfig();
  const plan = (saved.plans || []).find(p => p.id === 'starter');
  assert.ok(plan);
  assert.strictEqual(plan.name, 'Starter Tier Custom');
  assert.strictEqual(plan.validityDays, 30);
  assert.strictEqual(plan.priceInPaise, 129900);
  assert.strictEqual(plan.sessionsLimit, 2);

  // Clean up
  await run("DELETE FROM settings WHERE key = 'store_config'");
  const cleaned = await getStoreConfig();
  assert.strictEqual(cleaned.brandName, 'WhatsApp Automator Pro');
});
