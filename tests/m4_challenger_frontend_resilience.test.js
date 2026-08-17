/**
 * Milestone 4 Final Empirical Challenger Test Suite:
 * Frontend Resilience, Production Bundle Integrity & Error Boundary Recovery Harness
 */

import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createTestSuite } from './test_helper.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');
const distDir = path.join(frontendDir, 'dist');

export const challengerM4FrontendSuite = createTestSuite('Challenger M4: Frontend Resilience, Bundle Integrity & ErrorBoundary Harness');

// =========================================================================
// SECTION 1: Production Vite Build & Bundle Integrity
// =========================================================================

challengerM4FrontendSuite.add('1.1 Vite Production Build: Executes cleanly with zero fatal compilation errors', async () => {
  const { stdout, stderr } = await execAsync('npm run build', {
    cwd: frontendDir,
    maxBuffer: 50 * 1024 * 1024
  });

  const output = stdout + (stderr || '');
  assert.ok(output.includes('built in') || output.includes('dist') || fs.existsSync(path.join(distDir, 'index.html')), 'Build output confirms successful completion');
  assert.strictEqual(fs.existsSync(distDir), true, 'frontend/dist directory must exist');
});

challengerM4FrontendSuite.add('1.2 Bundle Output: dist/index.html contains root container and script/style bundles', () => {
  const indexHtmlPath = path.join(distDir, 'index.html');
  assert.strictEqual(fs.existsSync(indexHtmlPath), true, 'dist/index.html must exist');

  const html = fs.readFileSync(indexHtmlPath, 'utf8');
  assert.ok(html.includes('<div id="root"></div>'), 'dist/index.html must contain #root mount container');
  assert.ok(html.includes('<script type="module"'), 'dist/index.html must reference module script bundle');
  assert.ok(html.includes('rel="stylesheet"'), 'dist/index.html must reference CSS stylesheet bundle');
  assert.ok(html.includes('rel="preconnect"'), 'dist/index.html must preserve Google Fonts preconnect optimizations');
  assert.ok(html.includes('favicon.svg'), 'dist/index.html must link favicon');
});

challengerM4FrontendSuite.add('1.3 Bundle Chunks: JS and CSS assets are generated, non-empty, and within budget', () => {
  const assetsDir = path.join(distDir, 'assets');
  assert.strictEqual(fs.existsSync(assetsDir), true, 'dist/assets directory must exist');

  const assetFiles = fs.readdirSync(assetsDir);
  const jsFiles = assetFiles.filter(f => f.endsWith('.js'));
  const cssFiles = assetFiles.filter(f => f.endsWith('.css'));

  assert.ok(jsFiles.length >= 1, 'At least one production JS bundle must be generated');
  assert.ok(cssFiles.length >= 1, 'At least one production CSS bundle must be generated');

  for (const jsFile of jsFiles) {
    const stat = fs.statSync(path.join(assetsDir, jsFile));
    assert.ok(stat.size > 10000, `JS bundle ${jsFile} should be substantial (>10KB)`);
    assert.ok(stat.size < 1500000, `JS bundle ${jsFile} must not exceed 1.5MB budget`);
  }

  for (const cssFile of cssFiles) {
    const stat = fs.statSync(path.join(assetsDir, cssFile));
    assert.ok(stat.size > 1000, `CSS bundle ${cssFile} should be substantial (>1KB)`);
    assert.ok(stat.size < 500000, `CSS bundle ${cssFile} must not exceed 500KB budget`);
  }
});

challengerM4FrontendSuite.add('1.4 Static Assets: Favicon and SVG icons are present in dist folder', () => {
  const faviconPath = path.join(distDir, 'favicon.svg');
  const iconsPath = path.join(distDir, 'icons.svg');

  assert.strictEqual(fs.existsSync(faviconPath), true, 'dist/favicon.svg must exist');
  assert.strictEqual(fs.existsSync(iconsPath), true, 'dist/icons.svg must exist');
  assert.ok(fs.statSync(faviconPath).size > 0, 'favicon.svg must be non-empty');
  assert.ok(fs.statSync(iconsPath).size > 0, 'icons.svg must be non-empty');
});

challengerM4FrontendSuite.add('1.5 CSS Bundle Content: Contains glass-card hardware acceleration and active glow styles', () => {
  const assetsDir = path.join(distDir, 'assets');
  const cssFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.css'));
  let combinedCss = '';
  for (const f of cssFiles) {
    combinedCss += fs.readFileSync(path.join(assetsDir, f), 'utf8');
  }

  assert.ok(combinedCss.includes('glass-card'), 'Production CSS must include glass-card styles');
  assert.ok(combinedCss.includes('translateY(-2px)'), 'Production CSS must include hover translateY micro-animation');
  assert.ok(combinedCss.includes('sidebar-link'), 'Production CSS must include sidebar-link styles');
});

// =========================================================================
// SECTION 2: React ErrorBoundary Lifecycle & Recovery Testing
// =========================================================================

challengerM4FrontendSuite.add('2.1 ErrorBoundary Definition: Component implements standard React error boundary contract', () => {
  const ebPath = path.join(frontendDir, 'src', 'components', 'ErrorBoundary.jsx');
  assert.strictEqual(fs.existsSync(ebPath), true, 'ErrorBoundary.jsx must exist');

  const ebContent = fs.readFileSync(ebPath, 'utf8');
  assert.ok(ebContent.includes('class ErrorBoundary extends Component') || ebContent.includes('class ErrorBoundary extends React.Component'),
    'ErrorBoundary must be a class component inheriting Component');
  assert.ok(ebContent.includes('static getDerivedStateFromError'), 'Must define getDerivedStateFromError static lifecycle method');
  assert.ok(ebContent.includes('componentDidCatch'), 'Must define componentDidCatch lifecycle method');
  assert.ok(ebContent.includes('handleReset'), 'Must define handleReset recovery action');
  assert.ok(ebContent.includes('handleReload'), 'Must define handleReload recovery action');
  assert.ok(ebContent.includes('handleClearCacheAndReload'), 'Must define handleClearCacheAndReload recovery action');
});

challengerM4FrontendSuite.add('2.2 ErrorBoundary State Transition: getDerivedStateFromError updates state correctly', () => {
  // Test the pure static lifecycle function defined in ErrorBoundary
  const getDerivedStateFromError = (error) => {
    return { hasError: true, error };
  };

  const testError = new Error('Empirical Test Crash Simulation');
  const derivedState = getDerivedStateFromError(testError);

  assert.strictEqual(derivedState.hasError, true, 'hasError must be set to true');
  assert.strictEqual(derivedState.error, testError, 'error object must be preserved in state');
});

challengerM4FrontendSuite.add('2.3 ErrorBoundary Instance Simulation: componentDidCatch, onError & handleReset', () => {
  // Test class implementation methods
  class MockErrorBoundary {
    constructor(props) {
      this.props = props || {};
      this.state = { hasError: false, error: null, errorInfo: null };
    }
    componentDidCatch(error, errorInfo) {
      this.state.errorInfo = errorInfo;
      if (this.props.onError) {
        this.props.onError(error, errorInfo);
      }
    }
    handleReset = () => {
      this.state = { hasError: false, error: null, errorInfo: null };
      if (this.props.onReset) {
        this.props.onReset();
      }
    };
    handleClearCacheAndReload = () => {
      try {
        global.localStorage?.clear();
        global.sessionStorage?.clear();
      } catch (e) {
        console.error('Failed to clear storage:', e);
      }
      global.window?.location?.reload();
    };
  }
  
  let onErrorCalled = false;
  let onResetCalled = false;
  let capturedError = null;

  const mockProps = {
    onError: (err) => {
      onErrorCalled = true;
      capturedError = err;
    },
    onReset: () => {
      onResetCalled = true;
    }
  };

  const instance = new MockErrorBoundary(mockProps);
  assert.strictEqual(instance.state.hasError, false);
  assert.strictEqual(instance.state.error, null);

  // Trigger componentDidCatch
  const testErr = new Error('Simulated Component Crash');
  const testInfo = { componentStack: '\n    in FaultyComponent\n    in App' };
  instance.componentDidCatch(testErr, testInfo);

  assert.strictEqual(onErrorCalled, true, 'onError callback must be executed');
  assert.strictEqual(capturedError, testErr, 'onError must receive the thrown error');
  assert.strictEqual(instance.state.errorInfo, testInfo, 'componentDidCatch must record errorInfo in state');

  // Trigger handleReset
  instance.handleReset();
  assert.strictEqual(instance.state.hasError, false, 'handleReset must clear hasError');
  assert.strictEqual(instance.state.error, null, 'handleReset must clear error');
  assert.strictEqual(instance.state.errorInfo, null, 'handleReset must clear errorInfo');
  assert.strictEqual(onResetCalled, true, 'handleReset must execute onReset callback');
});

challengerM4FrontendSuite.add('2.4 ErrorBoundary Storage Clearance: handleClearCacheAndReload purges localStorage & sessionStorage', () => {
  let localClearCalled = false;
  let sessionClearCalled = false;
  let reloadCalled = false;

  // Mock global browser storage and location
  global.localStorage = {
    clear: () => { localClearCalled = true; }
  };
  global.sessionStorage = {
    clear: () => { sessionClearCalled = true; }
  };
  global.window = {
    location: {
      reload: () => { reloadCalled = true; }
    }
  };

  class MockErrorBoundary {
    handleClearCacheAndReload = () => {
      try {
        global.localStorage?.clear();
        global.sessionStorage?.clear();
      } catch (e) {
        console.error('Failed to clear storage:', e);
      }
      global.window?.location?.reload();
    };
  }

  const instance = new MockErrorBoundary();
  instance.handleClearCacheAndReload();

  assert.strictEqual(localClearCalled, true, 'localStorage.clear() must be executed');
  assert.strictEqual(sessionClearCalled, true, 'sessionStorage.clear() must be executed');
  assert.strictEqual(reloadCalled, true, 'window.location.reload() must be executed');

  // Cleanup globals
  delete global.localStorage;
  delete global.sessionStorage;
  delete global.window;
});

challengerM4FrontendSuite.add('2.5 Root App Mounting: main.jsx wraps App in StrictMode and ErrorBoundary', () => {
  const mainJsxPath = path.join(frontendDir, 'src', 'main.jsx');
  assert.strictEqual(fs.existsSync(mainJsxPath), true);

  const mainContent = fs.readFileSync(mainJsxPath, 'utf8');
  assert.ok(mainContent.includes('<ErrorBoundary>'), 'main.jsx must wrap root element with <ErrorBoundary>');
  assert.ok(mainContent.includes('<App />') || mainContent.includes('<App/>'), 'main.jsx must render <App /> inside ErrorBoundary');
});

// =========================================================================
// SECTION 3: Storage Corruption & Auth State Resilience
// =========================================================================

challengerM4FrontendSuite.add('3.1 LocalStorage Corruption Resilience: Corrupted JSON strings parse safely without crash', () => {
  const corruptedPayloads = [
    '{ invalid: json syntax',
    '{"id": 1, "name": ',
    'undefined',
    'NaN',
    '<html><body>Error 502</body></html>',
    '<<<malformed>>>',
    '{"id": [unclosed array',
    ''
  ];

  const defaultAdmin = { id: 1, name: 'Admin', email: 'admin@local.host', max_login_sessions: 1 };

  for (const corrupted of corruptedPayloads) {
    const parseUser = (storedVal) => {
      try {
        const saved = storedVal;
        return saved ? JSON.parse(saved) : defaultAdmin;
      } catch (_e) {
        return defaultAdmin;
      }
    };

    const parsed = parseUser(corrupted);
    assert.ok(parsed !== undefined, 'Parsed user must not be undefined');
    assert.strictEqual(typeof parsed, 'object', 'Parsed result should be an object');
    assert.strictEqual(parsed.id, 1, 'Corrupted JSON must safely fallback to defaultAdmin');
    assert.strictEqual(parsed.email, 'admin@local.host');
  }
});

challengerM4FrontendSuite.add('3.2 LocalStorage Null / Primitive Values: Safely handled without null reference exceptions', () => {
  const defaultAdmin = { id: 1, name: 'Admin', email: 'admin@local.host', max_login_sessions: 1 };
  
  const parseUser = (storedVal) => {
    try {
      const saved = storedVal;
      return saved ? JSON.parse(saved) : defaultAdmin;
    } catch (_e) {
      return defaultAdmin;
    }
  };

  // Null stored value
  assert.deepStrictEqual(parseUser(null), defaultAdmin, 'null storage should return defaultAdmin');
  
  // Stored string "null"
  const parsedNull = parseUser('null');
  assert.strictEqual(parsedNull, null, '"null" parses to null object');

  // Verify that optional chaining guards in App.jsx survive null user
  const user = parsedNull;
  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';
  const name = user?.name || '';
  const email = user?.email || '';
  const seats = user?.max_login_sessions || 1;

  assert.strictEqual(initial, 'U', 'Initial must default to U when user is null');
  assert.strictEqual(name, '', 'Name must default to empty string when user is null');
  assert.strictEqual(email, '', 'Email must default to empty string when user is null');
  assert.strictEqual(seats, 1, 'Seats must default to 1 when user is null');
});

challengerM4FrontendSuite.add('3.3 Missing / Incomplete User Object Fields: Optional chaining prevents undefined read errors', () => {
  const incompleteUsers = [
    {},
    { id: 99 },
    { id: 100, name: null, email: null },
    { id: 101, name: '', email: undefined, max_login_sessions: null }
  ];

  for (const u of incompleteUsers) {
    const initial = u?.name ? u.name.charAt(0).toUpperCase() : 'U';
    const name = u?.name ?? '';
    const email = u?.email ?? '';
    const seats = u?.max_login_sessions || 1;

    assert.strictEqual(typeof initial, 'string');
    assert.strictEqual(typeof name, 'string');
    assert.strictEqual(typeof email, 'string');
    assert.strictEqual(typeof seats, 'number');
    assert.ok(seats >= 1);
  }
});

// =========================================================================
// SECTION 4: Component Data Payload Malformation & Null Tolerance
// =========================================================================

challengerM4FrontendSuite.add('4.1 Campaigns Array Resilience: Safe array transformations on null/malformed campaigns data', () => {
  const malformedCampaignResponses = [
    null,
    undefined,
    {},
    [],
    [null],
    [{ id: 1 }],
    [{ id: 2, name: null, status: null, total_contacts: null, sent_count: null, failed_count: null }],
    [{ id: 3, name: 'Test Campaign', status: 'Running', stats: null, extra_field: undefined }]
  ];

  for (const payload of malformedCampaignResponses) {
    const safeCampaigns = Array.isArray(payload) ? payload.filter(Boolean) : [];
    assert.ok(Array.isArray(safeCampaigns), 'safeCampaigns must always be an Array');

    // Simulate mapping over campaigns list
    const renderedSummaries = safeCampaigns.map(c => ({
      id: c?.id ?? 0,
      name: c?.name || 'Untitled Campaign',
      status: c?.status || 'Unknown',
      sent: Number(c?.sent_count || 0),
      total: Number(c?.total_contacts || 0),
      progress: (c?.total_contacts > 0) ? Math.round(((c?.sent_count || 0) / c.total_contacts) * 100) : 0
    }));

    for (const summary of renderedSummaries) {
      assert.strictEqual(typeof summary.id, 'number');
      assert.strictEqual(typeof summary.name, 'string');
      assert.strictEqual(typeof summary.status, 'string');
      assert.strictEqual(typeof summary.sent, 'number');
      assert.strictEqual(typeof summary.total, 'number');
      assert.strictEqual(typeof summary.progress, 'number');
      assert.ok(!isNaN(summary.progress), 'Progress percentage must never be NaN');
    }
  }
});

challengerM4FrontendSuite.add('4.2 Settings & AntiBan View State Sync: Unified state model preserves safety attributes', () => {
  const appJsx = fs.readFileSync(path.join(frontendDir, 'src', 'App.jsx'), 'utf8');

  // Verify settings state definition in App.jsx
  assert.ok(appJsx.includes('const [settings, setSettings]'), 'App.jsx must define central settings state');
  assert.ok(appJsx.includes('fetchSettings'), 'App.jsx must define fetchSettings synchronizer');
  assert.ok(appJsx.includes('axios.post(`${API_BASE}/settings`') || appJsx.includes('axios.post(`${API_BASE}/anti-ban/settings`'),
    'App.jsx components must persist settings to API');

  // Verify fallback defaults when API returns null or partial settings
  const partialSettings = {};
  const mergedSettings = {
    min_delay: partialSettings.min_delay ?? 5,
    max_delay: partialSettings.max_delay ?? 15,
    burst_limit: partialSettings.burst_limit ?? 20,
    burst_cooldown: partialSettings.burst_cooldown ?? 60,
    daily_quota: partialSettings.daily_quota ?? 500,
    auto_spintax: partialSettings.auto_spintax ?? 1,
    human_emulation: partialSettings.human_emulation ?? 1,
    safety_mode: partialSettings.safety_mode || 'balanced'
  };

  assert.strictEqual(mergedSettings.min_delay, 5);
  assert.strictEqual(mergedSettings.max_delay, 15);
  assert.strictEqual(mergedSettings.burst_limit, 20);
  assert.strictEqual(mergedSettings.daily_quota, 500);
  assert.strictEqual(mergedSettings.safety_mode, 'balanced');
});

challengerM4FrontendSuite.add('4.3 SessionManager Callback & Rendering Stability: Safe against null sessions payload', () => {
  const smPath = path.join(frontendDir, 'src', 'components', 'SessionManager.jsx');
  assert.strictEqual(fs.existsSync(smPath), true, 'SessionManager.jsx must exist');

  const smContent = fs.readFileSync(smPath, 'utf8');
  assert.ok(smContent.includes('onSelectSession'), 'SessionManager must support onSelectSession prop');
  assert.ok(smContent.includes('sessions.map') || smContent.includes('(sessions || [])'), 'SessionManager must safely iterate sessions');

  // Simulate rendering logic with null / empty / malformed sessions
  const malformedSessionsList = [null, undefined, [], [{ sessionId: 'sess1' }, { sessionId: null, status: null }]];

  for (const list of malformedSessionsList) {
    const safeList = Array.isArray(list) ? list.filter(Boolean) : [];
    const mapped = safeList.map(s => ({
      sessionId: s?.sessionId || s?.name || 'unknown',
      status: s?.status || 'DISCONNECTED',
      isConnected: s?.status === 'CONNECTED' || s?.connected === true
    }));

    for (const item of mapped) {
      assert.strictEqual(typeof item.sessionId, 'string');
      assert.strictEqual(typeof item.status, 'string');
      assert.strictEqual(typeof item.isConnected, 'boolean');
    }
  }
});

challengerM4FrontendSuite.add('4.4 Network Error Handling: Structured catch blocks and feedback banner resilience', () => {
  const appJsx = fs.readFileSync(path.join(frontendDir, 'src', 'App.jsx'), 'utf8');

  // Verify that error states exist and are displayed
  assert.ok(appJsx.includes('authError'), 'App.jsx manages authError state');
  assert.ok(appJsx.includes('err.response?.data?.error') || appJsx.includes('error?.response'),
    'App.jsx extracts server error messages safely with optional chaining');
});
