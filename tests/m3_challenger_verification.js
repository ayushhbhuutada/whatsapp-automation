// empirical test script for Challenger 1 Milestone 3 (ES Module)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== EMPIRICAL VERIFICATION HARNESS - MILESTONE 3 (CHALLENGER 1) ===');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${message}`);
    failCount++;
  }
}

// 1. Build Verification
console.log('\n--- 1. Production Build Verification ---');
try {
  const buildOutput = execSync('npm run build', { cwd: path.join(__dirname, '../frontend'), encoding: 'utf-8' });
  assert(true, 'Vite production build executed successfully with exit code 0');
  assert(!buildOutput.toLowerCase().includes('error'), 'Build output contains 0 error keywords');
  assert(!buildOutput.toLowerCase().includes('warning'), 'Build output contains 0 bundle warning keywords');
  
  const distHtml = path.join(__dirname, '../frontend/dist/index.html');
  const distCss = path.join(__dirname, '../frontend/dist/assets');
  assert(fs.existsSync(distHtml), 'dist/index.html generated');
  assert(fs.existsSync(distCss), 'dist/assets CSS generated');
} catch (err) {
  assert(false, `Vite production build failed: ${err.message}`);
}

// 2. Font Loading & Tailwind Config Stress Test
console.log('\n--- 2. Typography & Fonts Setup Verification ---');
const htmlPath = path.join(__dirname, '../frontend/index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

assert(htmlContent.includes('fonts.googleapis.com'), 'index.html includes Google Fonts origin link');
assert(htmlContent.includes('Plus+Jakarta+Sans'), 'index.html requests Plus Jakarta Sans font family');
assert(htmlContent.includes('Space+Grotesk'), 'index.html requests Space Grotesk font family');
assert(htmlContent.includes('rel="preconnect"'), 'index.html uses preconnect for font optimization');

const tailwindConfigPath = path.join(__dirname, '../frontend/tailwind.config.js');
const tailwindConfigContent = fs.readFileSync(tailwindConfigPath, 'utf-8');

assert(tailwindConfigContent.includes("'Plus Jakarta Sans'"), 'tailwind.config.js configures Plus Jakarta Sans');
assert(tailwindConfigContent.includes("'Space Grotesk'"), 'tailwind.config.js configures Space Grotesk');
assert(tailwindConfigContent.includes("fontFamily:"), 'tailwind.config.js extends fontFamily theme');

// 3. CSS Active Tab Layout Reflow & Hover GPU Acceleration Stress Test
console.log('\n--- 3. CSS & Micro-Animations Layout Stability ---');
const cssPath = path.join(__dirname, '../frontend/src/index.css');
const cssContent = fs.readFileSync(cssPath, 'utf-8');

// Sidebar link active state reflow check
const sidebarLinkMatch = cssContent.match(/\.sidebar-link\s*\{([^}]+)\}/);
const sidebarActiveMatch = cssContent.match(/\.sidebar-link\.active\s*\{([^}]+)\}/);

assert(sidebarLinkMatch !== null, '.sidebar-link CSS rule exists');
assert(sidebarActiveMatch !== null, '.sidebar-link.active CSS rule exists');

if (sidebarLinkMatch && sidebarActiveMatch) {
  const baseRules = sidebarLinkMatch[1];
  const activeRules = sidebarActiveMatch[1];
  
  assert(baseRules.includes('border: 1px solid transparent'), '.sidebar-link defines 1px transparent border to reserve border space');
  assert(!activeRules.includes('width:'), '.sidebar-link.active does not mutate width property (prevents reflow)');
  assert(!activeRules.includes('padding:'), '.sidebar-link.active does not mutate padding property (prevents reflow)');
  assert(!activeRules.includes('margin:'), '.sidebar-link.active does not mutate margin property (prevents reflow)');
  assert(activeRules.includes('border-color:'), '.sidebar-link.active modifies border-color safely without reflow');
  assert(activeRules.includes('box-shadow:'), '.sidebar-link.active applies glow box-shadow (non-reflowing render)');
}

// Glass card hover micro-animation GPU acceleration check
const glassCardMatch = cssContent.match(/\.glass-card\s*\{([^}]+)\}/);
const glassCardHoverMatch = cssContent.match(/\.glass-card:hover\s*\{([^}]+)\}/);

assert(glassCardMatch !== null, '.glass-card CSS rule exists');
assert(glassCardHoverMatch !== null, '.glass-card:hover CSS rule exists');

if (glassCardMatch && glassCardHoverMatch) {
  const cardRules = glassCardMatch[1];
  const hoverRules = glassCardHoverMatch[1];

  assert(cardRules.includes('will-change: transform'), '.glass-card specifies GPU layer promotion (will-change: transform)');
  assert(cardRules.includes('translateZ(0)'), '.glass-card forces 3D GPU composite mode (transform: translateZ(0))');
  assert(hoverRules.includes('translateY(-2px)'), '.glass-card:hover uses transform: translateY for zero layout shift (CLS == 0)');
  assert(!hoverRules.includes('top:') && !hoverRules.includes('margin-top:'), '.glass-card:hover does NOT mutate flow properties (top/margin-top)');
}

// 4. Test Suite Execution
console.log('\n--- 4. Automated Test Harness Execution ---');
try {
  const testOutput = execSync('node tests/runner.js', { cwd: path.join(__dirname, '..'), encoding: 'utf-8' });
  assert(testOutput.includes('TESTS PASSED SUCCESSFULLY!'), 'Automated runner executes all tests successfully');
} catch (err) {
  assert(false, `Test runner failed: ${err.message}`);
}

console.log('\n==================================================');
console.log(`SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
console.log('==================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
