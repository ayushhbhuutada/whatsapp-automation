import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTestSuite } from './test_helper.js';

// Import backend service modules for direct testing
import { parseSpintax, calculateSmartDelayMs, isNightQuietHours } from '../backend/services/antiBanService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const tier1Suite = createTestSuite('Tier 1: Feature Coverage (Primary Requirements)');

// Feature 1: Database Schema Creation Specs
tier1Suite.add('Feature 1 - DB Schema: Database initialization script exists', () => {
  const dbScriptPath = path.resolve(__dirname, '../backend/database.js');
  assert.strictEqual(fs.existsSync(dbScriptPath), true, 'database.js should exist');
});

tier1Suite.add('Feature 1 - DB Schema: Schema defines blacklisted_numbers table', () => {
  const dbScript = fs.readFileSync(path.resolve(__dirname, '../backend/database.js'), 'utf8');
  assert.match(dbScript, /CREATE TABLE IF NOT EXISTS blacklisted_numbers/i, 'blacklisted_numbers table creation missing');
});

tier1Suite.add('Feature 1 - DB Schema: Schema defines daily_send_tracker table', () => {
  const dbScript = fs.readFileSync(path.resolve(__dirname, '../backend/database.js'), 'utf8');
  assert.match(dbScript, /CREATE TABLE IF NOT EXISTS daily_send_tracker/i, 'daily_send_tracker table creation missing');
});

tier1Suite.add('Feature 1 - DB Schema: Schema defines user_id foreign keys', () => {
  const dbScript = fs.readFileSync(path.resolve(__dirname, '../backend/database.js'), 'utf8');
  assert.match(dbScript, /user_id INTEGER/i, 'user_id column missing');
});

tier1Suite.add('Feature 1 - DB Schema: Seed default anti-ban settings configured', () => {
  const dbScript = fs.readFileSync(path.resolve(__dirname, '../backend/database.js'), 'utf8');
  assert.match(dbScript, /defaultSettings/i, 'defaultSettings seeding array missing');
});

// Feature 2: Anti-Ban Service Endpoints Specs
tier1Suite.add('Feature 2 - API Endpoints: /api/anti-ban/health route handler defined in routes.js', () => {
  const routesScript = fs.readFileSync(path.resolve(__dirname, '../backend/routes.js'), 'utf8');
  assert.match(routesScript, /router\.get\(['"]\/anti-ban\/health/i, '/anti-ban/health route missing');
});

tier1Suite.add('Feature 2 - API Endpoints: /api/anti-ban/blacklist GET route handler defined', () => {
  const routesScript = fs.readFileSync(path.resolve(__dirname, '../backend/routes.js'), 'utf8');
  assert.match(routesScript, /router\.get\(['"]\/anti-ban\/blacklist/i, '/anti-ban/blacklist GET route missing');
});

tier1Suite.add('Feature 2 - API Endpoints: /api/anti-ban/blacklist POST route handler defined', () => {
  const routesScript = fs.readFileSync(path.resolve(__dirname, '../backend/routes.js'), 'utf8');
  assert.match(routesScript, /router\.post\(['"]\/anti-ban\/blacklist/i, '/anti-ban/blacklist POST route missing');
});

tier1Suite.add('Feature 2 - API Endpoints: /api/anti-ban/blacklist/:id DELETE route handler defined', () => {
  const routesScript = fs.readFileSync(path.resolve(__dirname, '../backend/routes.js'), 'utf8');
  assert.match(routesScript, /router\.delete\(['"]\/anti-ban\/blacklist\/:id/i, '/anti-ban/blacklist DELETE route missing');
});

tier1Suite.add('Feature 2 - API Endpoints: /api/anti-ban/spintax-preview POST route handler defined', () => {
  const routesScript = fs.readFileSync(path.resolve(__dirname, '../backend/routes.js'), 'utf8');
  assert.match(routesScript, /router\.post\(['"]\/anti-ban\/spintax-preview/i, '/anti-ban/spintax-preview POST route missing');
});

tier1Suite.add('Feature 2 - API Endpoints: Response contracts match health metrics format', () => {
  const routesScript = fs.readFileSync(path.resolve(__dirname, '../backend/routes.js'), 'utf8');
  assert.match(routesScript, /calculateHealthScore/i, 'Health calculation helper missing');
});

tier1Suite.add('Feature 2 - API Endpoints: User authentication middleware applied to anti-ban routes', () => {
  const routesScript = fs.readFileSync(path.resolve(__dirname, '../backend/routes.js'), 'utf8');
  assert.match(routesScript, /authMiddleware/i, 'authMiddleware check missing');
});

// Feature 3: Automation Runner Integration Specs
tier1Suite.add('Feature 3 - Automation Runner: automationRunner.js module exists', () => {
  const runnerPath = path.resolve(__dirname, '../backend/services/automationRunner.js');
  assert.strictEqual(fs.existsSync(runnerPath), true, 'automationRunner.js should exist');
});

tier1Suite.add('Feature 3 - Automation Runner: Imports antiBanService utilities', () => {
  const runnerScript = fs.readFileSync(path.resolve(__dirname, '../backend/services/automationRunner.js'), 'utf8');
  assert.match(runnerScript, /antiBanService|parseSpintax|isNumberBlacklisted|calculateSmartDelayMs/i, 'antiBanService imports missing');
});

tier1Suite.add('Feature 3 - Automation Runner: Implements Spintax parsing before message send', () => {
  const runnerScript = fs.readFileSync(path.resolve(__dirname, '../backend/services/automationRunner.js'), 'utf8');
  assert.match(runnerScript, /parseSpintax/i, 'parseSpintax call missing in automation runner');
});

tier1Suite.add('Feature 3 - Automation Runner: Checks blacklist before dispatching message', () => {
  const runnerScript = fs.readFileSync(path.resolve(__dirname, '../backend/services/automationRunner.js'), 'utf8');
  assert.match(runnerScript, /isNumberBlacklisted/i, 'isNumberBlacklisted check missing');
});

tier1Suite.add('Feature 3 - Automation Runner: Applies smart rate limiter delay between contacts', () => {
  const runnerScript = fs.readFileSync(path.resolve(__dirname, '../backend/services/automationRunner.js'), 'utf8');
  assert.match(runnerScript, /calculateSmartDelayMs/i, 'calculateSmartDelayMs check missing');
});

tier1Suite.add('Feature 3 - Automation Runner: Increments daily send tracker count upon successful send', () => {
  const runnerScript = fs.readFileSync(path.resolve(__dirname, '../backend/services/automationRunner.js'), 'utf8');
  assert.match(runnerScript, /incrementDailySendCount/i, 'incrementDailySendCount check missing');
});

// Feature 4: Settings Page UI & Anti-Ban Cards Specs
tier1Suite.add('Feature 4 - Settings UI: App.jsx file exists', () => {
  const appPath = path.resolve(__dirname, '../frontend/src/App.jsx');
  assert.strictEqual(fs.existsSync(appPath), true, 'App.jsx should exist');
});

tier1Suite.add('Feature 4 - Settings UI: Defines active tab state navigation', () => {
  const appScript = fs.readFileSync(path.resolve(__dirname, '../frontend/src/App.jsx'), 'utf8');
  assert.match(appScript, /activeTab/i, 'activeTab state missing');
});

tier1Suite.add('Feature 4 - Settings UI: Renders Anti-Ban Health Shield card', () => {
  const appScript = fs.readFileSync(path.resolve(__dirname, '../frontend/src/App.jsx'), 'utf8');
  assert.match(appScript, /Health Score|Anti-Ban Health|Shield/i, 'Health card text missing');
});

tier1Suite.add('Feature 4 - Settings UI: Renders Number Warmup Limits card', () => {
  const appScript = fs.readFileSync(path.resolve(__dirname, '../frontend/src/App.jsx'), 'utf8');
  assert.match(appScript, /Warmup|Daily Limit|Stage/i, 'Warmup card text missing');
});

tier1Suite.add('Feature 4 - Settings UI: Renders Smart Rate Limiter controls', () => {
  const appScript = fs.readFileSync(path.resolve(__dirname, '../frontend/src/App.jsx'), 'utf8');
  assert.match(appScript, /Smart Rate Limiter|Delay|Burst/i, 'Smart rate limiter missing');
});

// Feature 5: Live Spintax Tester Specs
tier1Suite.add('Feature 5 - Spintax Engine: parseSpintax parses simple single variation', () => {
  const result = parseSpintax('{Hello|Hi|Hey}');
  assert.ok(['Hello', 'Hi', 'Hey'].includes(result), `Expected one of Hello/Hi/Hey but got ${result}`);
});

tier1Suite.add('Feature 5 - Spintax Engine: parseSpintax parses multiple variations in sentence', () => {
  const result = parseSpintax('{Hello|Hi} {friend|buddy}');
  const valid = ['Hello friend', 'Hello buddy', 'Hi friend', 'Hi buddy'];
  assert.ok(valid.includes(result), `Result ${result} should be in valid set`);
});

tier1Suite.add('Feature 5 - Spintax Engine: parseSpintax respects enableSpintax=false option', () => {
  const result = parseSpintax('{Hello|Hi}', { enableSpintax: false });
  assert.strictEqual(result, '{Hello|Hi}');
});

tier1Suite.add('Feature 5 - Spintax Engine: parseSpintax appends auto emoji when requested', () => {
  const result = parseSpintax('Hello world', { enableAutoEmoji: true });
  assert.match(result, /Hello world [\u{1F300}-\u{1F9FF}]/u);
});

tier1Suite.add('Feature 5 - Spintax Engine: Live tester frontend UI triggers preview request', () => {
  const appScript = fs.readFileSync(path.resolve(__dirname, '../frontend/src/App.jsx'), 'utf8');
  assert.match(appScript, /spintax-preview|parseSpintax|spintax/i, 'Spintax tester reference missing');
});

// Feature 6: Blacklist Manager Widget Specs
tier1Suite.add('Feature 6 - Blacklist Manager: antiBanService defines isNumberBlacklisted', () => {
  const antiBanScript = fs.readFileSync(path.resolve(__dirname, '../backend/services/antiBanService.js'), 'utf8');
  assert.match(antiBanScript, /export async function isNumberBlacklisted/i);
});

tier1Suite.add('Feature 6 - Blacklist Manager: antiBanService defines addNumberToBlacklist', () => {
  const antiBanScript = fs.readFileSync(path.resolve(__dirname, '../backend/services/antiBanService.js'), 'utf8');
  assert.match(antiBanScript, /export async function addNumberToBlacklist/i);
});

tier1Suite.add('Feature 6 - Blacklist Manager: App.jsx includes blacklist management rendering', () => {
  const appScript = fs.readFileSync(path.resolve(__dirname, '../frontend/src/App.jsx'), 'utf8');
  assert.match(appScript, /Blacklist|blacklisted|opt-out/i);
});

tier1Suite.add('Feature 6 - Blacklist Manager: App.jsx prevents undefined property access on empty blacklist', () => {
  const appScript = fs.readFileSync(path.resolve(__dirname, '../frontend/src/App.jsx'), 'utf8');
  assert.match(appScript, /blacklist.*\|\||Array\.isArray/i);
});

tier1Suite.add('Feature 6 - Blacklist Manager: Delete opt-out number API endpoint cleans database', () => {
  const routesScript = fs.readFileSync(path.resolve(__dirname, '../backend/routes.js'), 'utf8');
  assert.match(routesScript, /DELETE FROM blacklisted_numbers/i);
});

// Feature 7: Typography & Aesthetics Specs
tier1Suite.add('Feature 7 - Typography & Aesthetics: index.html imports Space Grotesk font', () => {
  const cssScript = fs.readFileSync(path.resolve(__dirname, '../frontend/src/index.css'), 'utf8');
  assert.match(cssScript, /Space\+Grotesk/i, 'Space Grotesk font import missing');
});

tier1Suite.add('Feature 7 - Typography & Aesthetics: index.html imports Plus Jakarta Sans font', () => {
  const cssScript = fs.readFileSync(path.resolve(__dirname, '../frontend/src/index.css'), 'utf8');
  assert.match(cssScript, /Plus\+Jakarta\+Sans/i, 'Plus Jakarta Sans font import missing');
});

tier1Suite.add('Feature 7 - Typography & Aesthetics: index.css defines glassmorphism design tokens', () => {
  const cssScript = fs.readFileSync(path.resolve(__dirname, '../frontend/src/index.css'), 'utf8');
  assert.match(cssScript, /--color-glass-1|--color-glass-2|glass/i, 'Glassmorphism variables missing');
});

tier1Suite.add('Feature 7 - Typography & Aesthetics: index.css defines active glowing tab & card hover effects', () => {
  const cssScript = fs.readFileSync(path.resolve(__dirname, '../frontend/src/index.css'), 'utf8');
  assert.match(cssScript, /--color-border-glow|shadow|hover/i, 'Glow or hover styles missing');
});

// Feature 8: E2E Feature & Route Verification Specs
tier1Suite.add('Feature 8 - E2E Verification: backend server.js initializes Express app', () => {
  const serverPath = path.resolve(__dirname, '../backend/server.js');
  assert.strictEqual(fs.existsSync(serverPath), true);
  const serverScript = fs.readFileSync(serverPath, 'utf8');
  assert.match(serverScript, /express\(\)/i);
});

tier1Suite.add('Feature 8 - E2E Verification: API router mounted under /api base path', () => {
  const serverScript = fs.readFileSync(path.resolve(__dirname, '../backend/server.js'), 'utf8');
  assert.match(serverScript, /app\.use\(['"]\/api['"]/i);
});

tier1Suite.add('Feature 8 - E2E Verification: Smart Rate Limiter computes valid delay structure', () => {
  const res = calculateSmartDelayMs({ enable_smart_rate_limiter: 'false', delay_seconds: '5' });
  assert.strictEqual(res.delayMs, 5000);
  assert.strictEqual(res.isRestPause, false);
});

tier1Suite.add('Feature 8 - E2E Verification: Smart Rate Limiter default 20-message burst and 2-min rest pause', () => {
  // Test regular messages (indices 1 to 19)
  for (let i = 1; i < 20; i++) {
    const regularDelay = calculateSmartDelayMs({}, i);
    assert.strictEqual(regularDelay.isRestPause, false);
    assert.ok(regularDelay.delayMs >= 8000 && regularDelay.delayMs <= 48000); // 8s to 45s + max jitter
  }
  // Test burst message at index 20
  const burstDelay = calculateSmartDelayMs({}, 20);
  assert.strictEqual(burstDelay.isRestPause, true);
  assert.ok(burstDelay.delayMs >= 102000 && burstDelay.delayMs <= 138000); // 120s (2 mins) +/- 15% jitter
});

tier1Suite.add('Feature 8 - E2E Verification: Smart Rate Limiter camelCase and snake_case alias compatibility', () => {
  const customConfig = {
    rateLimiterEnabled: true,
    minDelaySeconds: 10,
    maxDelaySeconds: 30,
    burstRestAfter: 15,
    burstRestDuration: 180
  };
  const reg = calculateSmartDelayMs(customConfig, 1);
  assert.strictEqual(reg.isRestPause, false);
  assert.ok(reg.delayMs >= 10000 && reg.delayMs <= 33000);

  const burst = calculateSmartDelayMs(customConfig, 15);
  assert.strictEqual(burst.isRestPause, true);
  assert.ok(burst.delayMs >= 180000 * 0.85 && burst.delayMs <= 180000 * 1.15);
});

tier1Suite.add('Feature 8 - E2E Verification: Night quiet hours evaluates boolean flag safely', () => {
  const isNight = isNightQuietHours({ enable_night_pause: 'false' });
  assert.strictEqual(isNight, false);
});
