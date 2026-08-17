/**
 * Milestone 3 Empirical Challenger Test Suite
 * Stress-tests font loading, Tailwind configuration, active tab glow states,
 * card hover micro-animations, layout stability, build output, and test pass rates.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, description) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✔ PASS - ${description}`);
  } else {
    failedTests++;
    console.error(`  ✖ FAIL - ${description}`);
  }
}

console.log('======================================================');
console.log(' Running Suite: Challenger M3 (Typography, Aesthetics & Layout Stability)');
console.log('======================================================');

const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');

// --- 1. Google Fonts Preconnect & Render-Blocking Check ---
console.log('\n--- 1. Checking frontend/index.html Google Fonts ---');
const indexHtmlPath = path.join(frontendDir, 'index.html');
assert(fs.existsSync(indexHtmlPath), 'frontend/index.html exists');

if (fs.existsSync(indexHtmlPath)) {
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  assert(indexHtml.includes('rel="preconnect"') && indexHtml.includes('href="https://fonts.googleapis.com"'),
    'Contains Google Fonts preconnect tag for fonts.googleapis.com');

  assert(indexHtml.includes('rel="preconnect"') && indexHtml.includes('href="https://fonts.gstatic.com"') && indexHtml.includes('crossorigin'),
    'Contains Google Fonts preconnect tag for fonts.gstatic.com with crossorigin');

  assert(indexHtml.includes('https://fonts.googleapis.com/css2'),
    'Contains Google Fonts css2 stylesheet link');

  assert(indexHtml.includes('Plus+Jakarta+Sans') || indexHtml.includes('Plus Jakarta Sans'),
    'Google Fonts stylesheet requests Plus Jakarta Sans font');

  assert(indexHtml.includes('Space+Grotesk') || indexHtml.includes('Space Grotesk'),
    'Google Fonts stylesheet requests Space Grotesk font');

  assert(indexHtml.includes('JetBrains+Mono') || indexHtml.includes('JetBrains Mono'),
    'Google Fonts stylesheet requests JetBrains Mono font');

  assert(indexHtml.includes('display=swap'),
    'Google Fonts stylesheet link uses display=swap to prevent render blocking (FOIT)');
}

// --- 2. Tailwind Font Configuration & Fallback Check ---
console.log('\n--- 2. Checking frontend/tailwind.config.js Font Mapping ---');
const tailwindConfigPath = path.join(frontendDir, 'tailwind.config.js');
assert(fs.existsSync(tailwindConfigPath), 'frontend/tailwind.config.js exists');

if (fs.existsSync(tailwindConfigPath)) {
  const tailwindConfig = fs.readFileSync(tailwindConfigPath, 'utf8');

  assert(tailwindConfig.includes('fontFamily:'), 'tailwind.config.js defines fontFamily');
  assert(tailwindConfig.includes('sans:'), 'fontFamily includes "sans" definition');
  assert(tailwindConfig.includes('display:'), 'fontFamily includes "display" definition');
  assert(tailwindConfig.includes('heading:'), 'fontFamily includes "heading" definition');
  assert(tailwindConfig.includes('jakarta:'), 'fontFamily includes "jakarta" definition');
  assert(tailwindConfig.includes('space:'), 'fontFamily includes "space" definition');
  assert(tailwindConfig.includes('mono:'), 'fontFamily includes "mono" definition');

  // Verify generic fallbacks in stacks
  assert(tailwindConfig.includes('sans-serif'), 'Font stacks include "sans-serif" generic fallback');
  assert(tailwindConfig.includes('monospace'), 'Font stacks include "monospace" generic fallback');
  assert(tailwindConfig.includes('system-ui'), 'Font stacks include "system-ui" generic fallback');

  // Verify proper quotes for fonts with spaces
  assert(tailwindConfig.includes("'Plus Jakarta Sans'") || tailwindConfig.includes('"Plus Jakarta Sans"'),
    'Plus Jakarta Sans is properly quoted in Tailwind config');
  assert(tailwindConfig.includes("'Space Grotesk'") || tailwindConfig.includes('"Space Grotesk"'),
    'Space Grotesk is properly quoted in Tailwind config');
  assert(tailwindConfig.includes("'JetBrains Mono'") || tailwindConfig.includes('"JetBrains Mono"'),
    'JetBrains Mono is properly quoted in Tailwind config');
}

// --- 3. Active Tab Glow & Micro-Animation Layout Stability Check ---
console.log('\n--- 3. Checking frontend/src/index.css & App.jsx CSS Effects ---');
const indexCssPath = path.join(frontendDir, 'src', 'index.css');
const appJsxPath = path.join(frontendDir, 'src', 'App.jsx');

assert(fs.existsSync(indexCssPath), 'frontend/src/index.css exists');
assert(fs.existsSync(appJsxPath), 'frontend/src/App.jsx exists');

if (fs.existsSync(indexCssPath)) {
  const indexCss = fs.readFileSync(indexCssPath, 'utf8');

  // Active tab state glow
  assert(indexCss.includes('.sidebar-link.active'), 'index.css defines .sidebar-link.active class rule');
  assert(indexCss.includes('box-shadow:') && indexCss.includes('rgba(37, 211, 102'),
    'active tab has glowing emerald box-shadow effect');

  // Card hover micro-animations & GPU hardware acceleration
  assert(indexCss.includes('.glass-card'), 'index.css defines .glass-card component class');
  assert(indexCss.includes('will-change: transform;') || indexCss.includes('transform: translateZ(0);'),
    '.glass-card uses GPU layer promotion (will-change / translateZ) to prevent layout reflow');
  assert(indexCss.includes('.glass-card:hover'), 'index.css defines .glass-card:hover micro-animation rule');
  assert(indexCss.includes('translateY(-2px)'), '.glass-card:hover applies smooth translateY lift');
}

if (fs.existsSync(appJsxPath)) {
  const appJsx = fs.readFileSync(appJsxPath, 'utf8');

  // Dynamic active tab class application
  assert(appJsx.includes('sidebar-link ${activeTab ==='),
    'App.jsx dynamically appends "active" class to active sidebar navigation button');

  // Card hover classes
  assert(appJsx.includes('hover:-translate-y-0.5') || appJsx.includes('glass-card'),
    'App.jsx applies glass-card or hover micro-animation classes to dashboard/settings elements');
}

// --- 4. Build & E2E Test Execution ---
console.log('\n--- 4. Empirical Build and Test Suite Verification ---');
try {
  console.log('Running npm run build in frontend...');
  const buildOutput = execSync('npm run build', { cwd: frontendDir, encoding: 'utf8', stdio: 'pipe' });
  assert(true, 'Vite production build completed with exit code 0');
} catch (err) {
  assert(false, `Vite production build failed: ${err.message}`);
}

try {
  console.log('Running node tests/runner.js...');
  const testOutput = execSync('node tests/runner.js', { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' });
  assert(testOutput.includes('TESTS PASSED SUCCESSFULLY!'),
    'Full automated test runner completed with 100% test pass rate');
} catch (err) {
  assert(false, `Automated test runner failed: ${err.message}`);
}

// --- SUMMARY ---
console.log('\n======================================================');
console.log(` CHALLENGER M3 SUMMARY: ${passedTests}/${totalTests} PASS, ${failedTests} FAIL`);
console.log('======================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
