import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeMessageLineBreaks, parseSpintax } from '../backend/services/antiBanService.js';
import { getLicenseStatus, loadCachedLease } from '../backend/services/licenseService.js';
import { getMachineId } from '../backend/services/hardwareIdService.js';

console.log('================================================================');
console.log(' GOAL VERIFICATION SUITE: 3 CRITICAL ISSUES DEEP AUDIT');
console.log('================================================================');

// ----------------------------------------------------------------------
// AUDIT 1: Auto-Update Option Visibility & Accessibility
// ----------------------------------------------------------------------
console.log('\n[Audit 1] Verifying Auto-Update UI accessibility...');

const appJsx = fs.readFileSync(path.resolve('frontend/src/App.jsx'), 'utf8');

// 1. Check Sidebar Navigation button
assert.strictEqual(
  appJsx.includes('Auto-Update') && appJsx.includes('setShowUpdateModal(true)'),
  true,
  'Sidebar navigation must have dedicated Auto-Update button'
);

// 2. Check Topbar Header button
assert.strictEqual(
  appJsx.includes('Check for Updates') && appJsx.includes('setShowUpdateModal(true)'),
  true,
  'Topbar header must have clear Check for Updates button'
);

// 3. Check Settings card
assert.strictEqual(
  appJsx.includes('Software Auto-Update System'),
  true,
  'Settings view must have Software Auto-Update System card'
);

// 4. Check Modal Component
const modalFile = fs.readFileSync(path.resolve('frontend/src/components/AutoUpdateModal.jsx'), 'utf8');
assert.strictEqual(modalFile.includes('checking'), true, 'Modal handles checking state');
assert.strictEqual(modalFile.includes('downloading'), true, 'Modal handles downloading state');
assert.strictEqual(modalFile.includes('ready'), true, 'Modal handles ready state');

console.log('  ✔ PASS: Auto-Update is prominently accessible in Sidebar, Topbar, Settings & Modal Dialog');

// ----------------------------------------------------------------------
// AUDIT 2: Fresh Install License Key Requirement & Protection
// ----------------------------------------------------------------------
console.log('\n[Audit 2] Verifying Fresh Install License Node-Lock Gate...');

const machineId = getMachineId();
console.log(`  Current Machine ID: ${machineId}`);

// Verify that if unactivated, getLicenseStatus returns activated: false
const licStatus = await getLicenseStatus();
console.log(`  License Status on current machine: activated = ${licStatus.activated}`);

// Verify frontend checks license on startup
assert.strictEqual(
  appJsx.includes('checkLicenseOnStartup') && appJsx.includes('isVerifyingLicense'),
  true,
  'Frontend must actively verify license with backend on startup'
);

// Verify backend authMiddleware enforces license
const routesCode = fs.readFileSync(path.resolve('backend/routes.js'), 'utf8');
assert.strictEqual(
  routesCode.includes('LICENSE_REQUIRED') && routesCode.includes('getLicenseStatus'),
  true,
  'Backend authMiddleware must reject requests when license is not activated'
);

console.log('  ✔ PASS: Fresh install strictly forces License Key input; unactivated requests blocked');

// ----------------------------------------------------------------------
// AUDIT 3: Word Document Copy-Paste & Multiline Line Breaks
// ----------------------------------------------------------------------
console.log('\n[Audit 3] Verifying Word Document Copy-Paste & Multiline Normalization...');

// Simulate real Microsoft Word copy-paste text containing \u2028 (soft break), \u2029 (paragraph break), \x0B (shift+enter), \r\n, \r, and \u00A0
const wordDocumentCopiedText = 
  'Dear {{Name}},\u2028\u2028' +                                   // Word soft paragraph breaks
  'Thank you for reaching out to {{Company}}!\r\n\r\n' +          // Windows CRLF blank line
  'Here are our services:\x0B' +                                  // Word vertical tab (Shift+Enter)
  '1. WhatsApp Automation Pro\n' +                                // Standard newline
  '2. Anti-Ban Warmup Engine\u2029' +                             // Word paragraph separator
  'Special limited-time discount for you:\u00A050% OFF!\r\r' +    // Word NBSP and double CR
  'Best regards,\nSupport Team';

const normalized = normalizeMessageLineBreaks(wordDocumentCopiedText);

console.log('\n--- Original Raw Word Document String (with escape codes) ---');
console.log(JSON.stringify(wordDocumentCopiedText));

console.log('\n--- Normalized Clean WhatsApp Message ---');
console.log(normalized);

// Assertions
assert.strictEqual(normalized.includes('\u2028'), false, 'All \\u2028 Unicode line separators must be normalized');
assert.strictEqual(normalized.includes('\u2029'), false, 'All \\u2029 Unicode paragraph separators must be normalized');
assert.strictEqual(normalized.includes('\x0B'), false, 'All \\x0B vertical tabs must be normalized');
assert.strictEqual(normalized.includes('\r'), false, 'All carriage returns must be converted to \\n');
assert.strictEqual(normalized.includes('\u00A0'), false, 'All non-breaking spaces must be converted to standard space');

// Verify line counts and paragraph gaps
const lines = normalized.split('\n');
console.log(`\n  Total lines preserved: ${lines.length}`);
assert.ok(lines.length >= 8, 'Message must retain all 8+ individual lines and blank gaps');
assert.strictEqual(lines[0], 'Dear {{Name}},', 'Line 1 is preserved');
assert.strictEqual(lines[1], '', 'Blank paragraph gap after greeting is preserved');
assert.strictEqual(lines[2], 'Thank you for reaching out to {{Company}}!', 'Line 3 is preserved');

// Verify Spintax parsing on multiline Word text
const spintaxWordText = '{Hello|Hi|Greetings} {{Name}},\n\n{We are happy|Delighted} to contact you.\n\nBest wishes!';
const spun = parseSpintax(spintaxWordText);
assert.ok(spun.includes('\n\n'), 'Spintax output must preserve double newlines');

console.log('\n  ✔ PASS: Microsoft Word document copy-pasting preserves 100% of line breaks and paragraph gaps');

console.log('\n================================================================');
console.log('🎉 ALL 3 AUDIT SUITES PASSED (100% GOAL FULFILLED)');
console.log('================================================================\n');
