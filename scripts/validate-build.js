import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('\n🔍 [VALIDATION] Running Pre-Build Code Integrity & Syntax Check...\n');

let errorCount = 0;
let checkedFiles = 0;

const directoriesToScan = ['backend', 'electron', 'scripts', 'tools'];
const ignoreDirectories = ['node_modules', '.git', 'dist_electron', 'dist_build', 'dist_portable', 'dist', '.wwebjs_auth', '.wwebjs_cache', 'uploads', 'attachments'];

function scanDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (!ignoreDirectories.includes(entry.name)) {
        scanDirectory(fullPath);
      }
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs') || entry.name.endsWith('.mjs')) {
      checkedFiles++;
      try {
        execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
      } catch (err) {
        errorCount++;
        console.error(`\n❌ [SYNTAX ERROR] ${relPath}`);
        console.error(err.stderr ? err.stderr.toString().trim() : err.message);
      }
    }
  }
}

for (const dir of directoriesToScan) {
  scanDirectory(path.join(rootDir, dir));
}

const jsonFiles = [
  path.join(rootDir, 'package.json'),
  path.join(rootDir, 'frontend', 'package.json'),
  path.join(rootDir, 'frontend', 'public', 'version.json')
];

for (const jsonFile of jsonFiles) {
  if (fs.existsSync(jsonFile)) {
    checkedFiles++;
    try {
      const content = fs.readFileSync(jsonFile, 'utf8');
      JSON.parse(content);
    } catch (e) {
      errorCount++;
      console.error(`\n❌ [JSON ERROR] ${path.relative(rootDir, jsonFile)}: ${e.message}`);
    }
  }
}

try {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const frontendPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'frontend', 'package.json'), 'utf8'));
  const versionJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'frontend', 'public', 'version.json'), 'utf8'));

  if (rootPkg.version !== frontendPkg.version || rootPkg.version !== versionJson.version) {
    console.warn(`\n⚠️ [VERSION WARNING] Version mismatch detected:`);
    console.warn(`  - package.json: ${rootPkg.version}`);
    console.warn(`  - frontend/package.json: ${frontendPkg.version}`);
    console.warn(`  - version.json: ${versionJson.version}`);
  }
} catch (_vErr) {}

console.log(`\n📊 Scanned ${checkedFiles} source files.`);

if (errorCount > 0) {
  console.error(`\n🚫 Build validation FAILED with ${errorCount} error(s)! Aborting packaging.\n`);
  process.exit(1);
} else {
  console.log('✅ All JavaScript and configuration files passed syntax and integrity checks.\n');
  process.exit(0);
}
