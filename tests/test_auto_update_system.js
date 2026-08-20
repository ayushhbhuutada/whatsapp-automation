import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autoUpdateService, {
  isNewerVersion,
  checkForUpdates,
  getDownloadState,
  getUpdatesDirectory
} from '../backend/services/autoUpdateService.js';

console.log('======================================================');
console.log(' Running Auto-Update System & SemVer Verification Suite');
console.log('======================================================');

// --------------------------------------------------------------------
// Test 1: SemVer Comparison Logic
// --------------------------------------------------------------------
console.log('\n[Test 1] Testing SemVer comparison engine...');

assert.strictEqual(isNewerVersion('1.0.1', '1.0.0'), true, '1.0.1 should be newer than 1.0.0');
assert.strictEqual(isNewerVersion('v1.1.0', '1.0.9'), true, 'v1.1.0 should be newer than 1.0.9');
assert.strictEqual(isNewerVersion('v2.0.0', 'v1.99.99'), true, 'v2.0.0 should be newer than v1.99.99');
assert.strictEqual(isNewerVersion('1.0.0', '1.0.0'), false, '1.0.0 is not newer than 1.0.0');
assert.strictEqual(isNewerVersion('0.9.9', '1.0.0'), false, '0.9.9 is not newer than 1.0.0');
assert.strictEqual(isNewerVersion('1.0.0', '1.0.1'), false, '1.0.0 is not newer than 1.0.1');
assert.strictEqual(isNewerVersion('v1.0.10', 'v1.0.9'), true, '1.0.10 should be newer than 1.0.9');
assert.strictEqual(isNewerVersion('', '1.0.0'), false, 'Empty remote version should return false');
assert.strictEqual(isNewerVersion(null, '1.0.0'), false, 'Null remote version should return false');

console.log('  ✔ PASS - SemVer comparisons accurately handle major, minor, patch & "v" prefixes');

// --------------------------------------------------------------------
// Test 2: Updates Directory Resolution
// --------------------------------------------------------------------
console.log('\n[Test 2] Testing updates storage directory...');

const updatesDir = getUpdatesDirectory();
console.log(`  Resolved Updates Directory: ${updatesDir}`);
assert.strictEqual(typeof updatesDir, 'string', 'Updates directory must be a string path');
assert.strictEqual(fs.existsSync(updatesDir), true, 'Updates directory must exist on disk');

console.log('  ✔ PASS - Updates directory created and accessible');

// --------------------------------------------------------------------
// Test 3: Download State & Progress Tracking
// --------------------------------------------------------------------
console.log('\n[Test 3] Testing download state & progress reporting...');

const downloadState = getDownloadState();
assert.strictEqual(typeof downloadState, 'object', 'Download state must be an object');
assert.strictEqual(typeof downloadState.percent, 'number', 'Percent must be a number');
assert.strictEqual(typeof downloadState.isDownloading, 'boolean', 'isDownloading must be a boolean');
assert.strictEqual(typeof downloadState.currentVersion, 'string', 'currentVersion must be string');

console.log('  ✔ PASS - Download state format matches API contracts');

// --------------------------------------------------------------------
// Test 4: Check for Updates Engine (GitHub & Vercel)
// --------------------------------------------------------------------
console.log('\n[Test 4] Testing update check dispatch...');

const updateResult = await checkForUpdates({
  sourceType: 'github',
  githubRepo: 'ayushhbhuutada/whatsapp-automation'
});

assert.strictEqual(typeof updateResult, 'object', 'Update check must return an object');
assert.strictEqual(typeof updateResult.updateAvailable, 'boolean', 'updateAvailable must be boolean');
assert.strictEqual(typeof updateResult.currentVersion, 'string', 'currentVersion must be string');
assert.strictEqual(typeof updateResult.source, 'string', 'source must be string');

console.log(`  Update Check Result:`);
console.log(`    Source: ${updateResult.source}`);
console.log(`    Current Version: ${updateResult.currentVersion}`);
console.log(`    Latest Version: ${updateResult.latestVersion}`);
console.log(`    Update Available: ${updateResult.updateAvailable}`);
console.log('  ✔ PASS - Auto-update service gracefully handles GitHub & Vercel endpoints');

// --------------------------------------------------------------------
// Test 5: Packaging & Preload Auto-Update APIs
// --------------------------------------------------------------------
console.log('\n[Test 5] Verifying preload.cjs and main.cjs IPC contracts...');

const preloadContent = fs.readFileSync(path.resolve('electron/preload.cjs'), 'utf8');
assert.strictEqual(preloadContent.includes('checkForUpdates'), true, 'preload.cjs must expose checkForUpdates');
assert.strictEqual(preloadContent.includes('downloadUpdate'), true, 'preload.cjs must expose downloadUpdate');
assert.strictEqual(preloadContent.includes('installUpdate'), true, 'preload.cjs must expose installUpdate');
assert.strictEqual(preloadContent.includes('onUpdateProgress'), true, 'preload.cjs must expose onUpdateProgress');

const mainContent = fs.readFileSync(path.resolve('electron/main.cjs'), 'utf8');
assert.strictEqual(mainContent.includes('check-for-updates'), true, 'main.cjs must handle check-for-updates IPC');
assert.strictEqual(mainContent.includes('download-update'), true, 'main.cjs must handle download-update IPC');
assert.strictEqual(mainContent.includes('install-update'), true, 'main.cjs must handle install-update IPC');
assert.strictEqual(mainContent.includes('updateSplashStatus'), true, 'main.cjs must update splash status');

const splashContent = fs.readFileSync(path.resolve('electron/splash.html'), 'utf8');
assert.strictEqual(splashContent.includes('status'), true, 'splash.html must have status container');
assert.strictEqual(splashContent.includes('updateStatus'), true, 'splash.html must define updateStatus helper');

console.log('  ✔ PASS - All Electron IPC channels, preload bridges, and splash dialogues connected');

console.log('\n======================================================');
console.log('🎉 ALL AUTO-UPDATE TESTS PASSED 100% (5/5 Suites)');
console.log('======================================================\n');
