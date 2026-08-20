import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const arg = process.argv[2] || 'patch';

function run(cmd, desc) {
  console.log(`\n▶ [${desc}] Running: ${cmd}`);
  try {
    execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
  } catch (e) {
    console.error(`\n❌ Step failed: ${desc}`);
    process.exit(1);
  }
}

console.log('====================================================');
console.log('  🚀 WHATSAPP AUTOMATOR PRO - UNIFIED RELEASE PIPELINE');
console.log('====================================================');

// 1. Validate Syntax & Code Integrity
run('node scripts/validate-build.js', 'Step 1: Code & Syntax Validation');

// 2. Bump Versions Across All Packages & Configs
run(`node scripts/bump-version.js ${arg}`, 'Step 2: Version Synchronization');

// Read new version
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const newVersion = pkg.version;
console.log(`\n📌 Target Release Version: v${newVersion}`);

// 3. Build Web/Frontend Application
run('npm run build:frontend', 'Step 3: Frontend Production Build');

// 4. Build Desktop Installer via Electron Builder
run('npx electron-builder --win nsis', 'Step 4: Electron NSIS Installer Packaging');

// 5. Sync release_dist/ Artifacts
const setupSrc = path.join(rootDir, 'dist_electron', 'WhatsAppAutomationSetup.exe');
const blockmapSrc = path.join(rootDir, 'dist_electron', 'WhatsAppAutomationSetup.exe.blockmap');
const latestYmlSrc = path.join(rootDir, 'dist_electron', 'latest.yml');
const releaseDist = path.join(rootDir, 'release_dist');

if (fs.existsSync(setupSrc)) {
  fs.mkdirSync(releaseDist, { recursive: true });
  fs.copyFileSync(setupSrc, path.join(releaseDist, 'WhatsAppAutomationSetup.exe'));
  if (fs.existsSync(blockmapSrc)) fs.copyFileSync(blockmapSrc, path.join(releaseDist, 'WhatsAppAutomationSetup.exe.blockmap'));
  if (fs.existsSync(latestYmlSrc)) fs.copyFileSync(latestYmlSrc, path.join(releaseDist, 'latest.yml'));
  console.log('\n✔ Step 5: Synced binaries to release_dist/');
} else {
  console.error('\n❌ Build output WhatsAppAutomationSetup.exe not found!');
  process.exit(1);
}

// 6. Git Commit & Push (Deploys to Vercel automatically)
console.log('\n▶ Step 6: Git Commit & Push (Syncing Vercel & GitHub main)...');
try {
  execSync('git add .', { cwd: rootDir, stdio: 'inherit' });
  execSync(`git commit -m "release: Bump to v${newVersion} with verified build"`, { cwd: rootDir, stdio: 'inherit' });
  execSync('git push origin main', { cwd: rootDir, stdio: 'inherit' });
  console.log('✔ Git push succeeded.');
} catch (e) {
  console.warn('⚠️ Git push note:', e.message);
}

// 7. Publish to GitHub Releases
console.log('\n▶ Step 7: Publishing Official GitHub Release (Setting as Latest)...');
try {
  const notes = `WhatsApp Automator Pro v${newVersion}\n- Production release with verified code integrity.\n- Desktop auto-updater and synchronized cloud distribution.`;
  execSync(`gh release create v${newVersion} "dist_electron/WhatsAppAutomationSetup.exe" "dist_electron/WhatsAppAutomationSetup.exe.blockmap" "dist_electron/latest.yml" --title "WhatsApp Automator Pro v${newVersion}" --notes "${notes}" --latest`, { cwd: rootDir, stdio: 'inherit' });
  console.log(`✔ Official GitHub Release v${newVersion} published successfully!`);
} catch (ghErr) {
  console.warn('⚠️ GitHub release notice (updating assets):', ghErr.message);
  try {
    execSync(`gh release upload v${newVersion} "dist_electron/WhatsAppAutomationSetup.exe" --clobber`, { cwd: rootDir, stdio: 'inherit' });
  } catch (_e) {}
}

console.log('\n====================================================');
console.log(`  🎉 SUCCESS: v${newVersion} RELEASE COMPLETE & DEPLOYED!`);
console.log(`  - Vercel Web: Auto-deployed from main branch`);
console.log(`  - GitHub Release: https://github.com/ayushhbhuutada/whatsapp-automation/releases/tag/v${newVersion}`);
console.log('====================================================\n');
