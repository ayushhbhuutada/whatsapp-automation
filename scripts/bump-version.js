import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const arg = process.argv[2];

if (!arg) {
  console.error('Usage: node scripts/bump-version.js <new_version | patch | minor | major>');
  process.exit(1);
}

// 1. Read current version from root package.json
const rootPkgPath = path.join(rootDir, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
const currentVersion = rootPkg.version || '1.0.0';

let newVersion = arg;

if (['patch', 'minor', 'major'].includes(arg.toLowerCase())) {
  const parts = currentVersion.split('.').map(Number);
  while (parts.length < 3) parts.push(0);

  if (arg.toLowerCase() === 'patch') {
    parts[2] = (parts[2] || 0) + 1;
  } else if (arg.toLowerCase() === 'minor') {
    parts[1] = (parts[1] || 0) + 1;
    parts[2] = 0;
  } else if (arg.toLowerCase() === 'major') {
    parts[0] = (parts[0] || 0) + 1;
    parts[1] = 0;
    parts[2] = 0;
  }
  newVersion = parts.join('.');
}

// Strip leading 'v' if provided
newVersion = newVersion.replace(/^v/i, '');

console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);

// 1. Update root package.json
rootPkg.version = newVersion;
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n', 'utf8');
console.log(`✔ Updated root package.json -> ${newVersion}`);

// 2. Update frontend/package.json
const frontendPkgPath = path.join(rootDir, 'frontend', 'package.json');
if (fs.existsSync(frontendPkgPath)) {
  const frontendPkg = JSON.parse(fs.readFileSync(frontendPkgPath, 'utf8'));
  frontendPkg.version = newVersion;
  fs.writeFileSync(frontendPkgPath, JSON.stringify(frontendPkg, null, 2) + '\n', 'utf8');
  console.log(`✔ Updated frontend/package.json -> ${newVersion}`);
}

// 3. Update frontend/src/App.jsx initial state
const appJsxPath = path.join(rootDir, 'frontend', 'src', 'App.jsx');
if (fs.existsSync(appJsxPath)) {
  let appJsx = fs.readFileSync(appJsxPath, 'utf8');
  appJsx = appJsx.replace(/const \[appVersion, setAppVersion\] = useState\(['"][^'"]+['"]\);/, `const [appVersion, setAppVersion] = useState('${newVersion}');`);
  fs.writeFileSync(appJsxPath, appJsx, 'utf8');
  console.log(`✔ Updated frontend/src/App.jsx -> v${newVersion}`);
}

// 4. Update electron/splash.html default version tag
const splashPath = path.join(rootDir, 'electron', 'splash.html');
if (fs.existsSync(splashPath)) {
  let splash = fs.readFileSync(splashPath, 'utf8');
  splash = splash.replace(/<div class="version-tag" id="version">v[^<]+<\/div>/, `<div class="version-tag" id="version">v${newVersion}</div>`);
  fs.writeFileSync(splashPath, splash, 'utf8');
  console.log(`✔ Updated electron/splash.html -> v${newVersion}`);
}

// 5. Update frontend/public/version.json for Vercel & GitHub releases
const publicVersionPath = path.join(rootDir, 'frontend', 'public', 'version.json');
if (fs.existsSync(publicVersionPath)) {
  try {
    const vJson = JSON.parse(fs.readFileSync(publicVersionPath, 'utf8'));
    vJson.version = newVersion;
    vJson.latestVersion = newVersion;
    vJson.releaseName = `WhatsApp Automator Pro v${newVersion}`;
    vJson.downloadUrl = `https://github.com/ayushhbhuutada/whatsapp-automation/releases/download/v${newVersion}/WhatsAppAutomationSetup.exe`;
    vJson.publishedAt = new Date().toISOString();
    fs.writeFileSync(publicVersionPath, JSON.stringify(vJson, null, 2) + '\n', 'utf8');
    console.log(`✔ Updated frontend/public/version.json -> v${newVersion}`);
  } catch (_e) {}
}

console.log(`\n🎉 Project successfully updated to version v${newVersion}!`);
