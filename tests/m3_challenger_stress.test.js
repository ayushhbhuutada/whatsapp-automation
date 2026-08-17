import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTestSuite } from './test_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');

export const challengerM3Suite = createTestSuite('Challenger M3: Responsive UI/UX Aesthetics, Typography & Hover Stability Harness');

challengerM3Suite.add('Google Fonts Preconnect: index.html defines preconnect tags for fonts.googleapis.com and fonts.gstatic.com', () => {
  const indexHtmlPath = path.join(frontendDir, 'index.html');
  assert.strictEqual(fs.existsSync(indexHtmlPath), true);
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  assert.ok(indexHtml.includes('rel="preconnect"') && indexHtml.includes('href="https://fonts.googleapis.com"'));
  assert.ok(indexHtml.includes('rel="preconnect"') && indexHtml.includes('href="https://fonts.gstatic.com"') && indexHtml.includes('crossorigin'));
});

challengerM3Suite.add('Google Fonts Render Blocking Prevention: index.html stylesheet link uses display=swap', () => {
  const indexHtmlPath = path.join(frontendDir, 'index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  assert.ok(indexHtml.includes('https://fonts.googleapis.com/css2'));
  assert.ok(indexHtml.includes('Plus+Jakarta+Sans') || indexHtml.includes('Plus Jakarta Sans'));
  assert.ok(indexHtml.includes('Space+Grotesk') || indexHtml.includes('Space Grotesk'));
  assert.ok(indexHtml.includes('JetBrains+Mono') || indexHtml.includes('JetBrains Mono'));
  assert.ok(indexHtml.includes('display=swap'));
});

challengerM3Suite.add('Tailwind Config: Extended fontFamily includes sans, display, heading, jakarta, space, mono with fallbacks', () => {
  const tailwindConfigPath = path.join(frontendDir, 'tailwind.config.js');
  assert.strictEqual(fs.existsSync(tailwindConfigPath), true);
  const config = fs.readFileSync(tailwindConfigPath, 'utf8');

  assert.ok(config.includes('sans:'));
  assert.ok(config.includes('display:'));
  assert.ok(config.includes('heading:'));
  assert.ok(config.includes('jakarta:'));
  assert.ok(config.includes('space:'));
  assert.ok(config.includes('mono:'));
  assert.ok(config.includes('sans-serif'));
  assert.ok(config.includes('monospace'));
  assert.ok(config.includes('system-ui'));
});

challengerM3Suite.add('Active Tab State Glow: index.css defines .sidebar-link.active with glowing emerald box-shadow', () => {
  const indexCssPath = path.join(frontendDir, 'src', 'index.css');
  assert.strictEqual(fs.existsSync(indexCssPath), true);
  const css = fs.readFileSync(indexCssPath, 'utf8');

  assert.ok(css.includes('.sidebar-link.active'));
  assert.ok(css.includes('box-shadow:'));
  assert.ok(css.includes('rgba(37, 211, 102'));
});

challengerM3Suite.add('Card Hover GPU Acceleration: glass-card uses GPU layer promotion to prevent reflows during micro-animations', () => {
  const indexCssPath = path.join(frontendDir, 'src', 'index.css');
  const css = fs.readFileSync(indexCssPath, 'utf8');

  assert.ok(css.includes('.glass-card'));
  assert.ok(css.includes('will-change: transform;') || css.includes('transform: translateZ(0);'));
  assert.ok(css.includes('.glass-card:hover'));
  assert.ok(css.includes('translateY(-2px)'));
});

challengerM3Suite.add('App.jsx Active Link Dynamic Binding: Navigation sidebar appends active class string on tab match', () => {
  const appJsxPath = path.join(frontendDir, 'src', 'App.jsx');
  assert.strictEqual(fs.existsSync(appJsxPath), true);
  const appJsx = fs.readFileSync(appJsxPath, 'utf8');

  assert.ok(appJsx.includes('sidebar-link ${activeTab ==='));
});
