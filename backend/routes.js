import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db, { run, get, all } from './database.js';
import { parseSpreadsheet, parseRawTextContacts, sanitizeContactsList } from './services/excelParser.js';
import { fetchGoogleSheet } from './services/googleSheets.js';
import runner from './services/automationRunner.js';
import {
  parseSpintax,
  generateAutoSpintax,
  buildSpintaxFromMessages,
  checkWarmupStatus,
  calculateHealthScore,
  calculateSmartDelayMs,
  isNumberBlacklisted,
  addNumberToBlacklist
} from './services/antiBanService.js';
import { getMachineId, validateLicenseKey, activateLicense, getLicenseStatus, verifyLicense } from './services/licenseService.js';
import autoUpdateService, { checkForUpdates, downloadUpdate, getDownloadState, applyUpdateAndRestart } from './services/autoUpdateService.js';
import { getUploadsDir } from './paths.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_test_mock_key_secret'
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp-saas-secret-key-2026';

// Middleware to verify JWT Token & Enforce Commercial License Activation
export const authMiddleware = async (req, res, next) => {
  // 1. Whitelist public license & update endpoints that must remain accessible before activation
  const publicPaths = [
    '/license/machine-id',
    '/license/status',
    '/license/activate',
    '/license/issue',
    '/auth/login',
    '/auth/register'
  ];

  if (publicPaths.some(p => req.path.startsWith(p)) || req.path.startsWith('/updates/')) {
    return next();
  }

  const defaultUser = (await get('SELECT id, name, email FROM users WHERE id = 1')) || { id: 1, name: 'Admin User', email: 'admin@local.host' };
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  // 2. For Desktop App / Localhost execution, cryptographically verify active hardware license!
  const isDesktopRequest = process.env.IS_ELECTRON === 'true' || 
    req.hostname === 'localhost' || 
    req.hostname === '127.0.0.1' || 
    token === 'licensed-active-session';

  if (isDesktopRequest) {
    try {
      const licStatus = await getLicenseStatus();
      if (!licStatus.activated) {
        return res.status(401).json({
          error: 'LICENSE_REQUIRED: A valid commercial license key is required to use this application.',
          licenseRequired: true,
          machineId: licStatus.machineId
        });
      }
      req.user = defaultUser;
      return next();
    } catch (e) {
      return res.status(401).json({
        error: 'LICENSE_VERIFICATION_FAILED: ' + e.message,
        licenseRequired: true
      });
    }
  }

  // 3. For Web SaaS requests, verify JWT Token
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'Authentication token required.' });
  }

  try {
    const blacklisted = await get('SELECT token FROM token_blacklist WHERE token = ?', [token]);
    if (blacklisted) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId || decoded.id;
    const user = await get('SELECT id, name, email FROM users WHERE id = ?', [userId]);
    req.user = user || (userId ? { id: userId, email: decoded.email || 'user@test.com', name: decoded.name || 'User' } : defaultUser);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }
};

// Apply authMiddleware to all API routes except public auth registration & login
router.use((req, res, next) => {
  if (req.path === '/auth/register' || req.path === '/auth/login') {
    return next();
  }
  authMiddleware(req, res, next);
});

// ==========================================
// 0. Auth Routes (Public)
// ==========================================
router.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.toLowerCase().trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    const existing = await get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing) {
      return res.status(400).json({ error: 'A user with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await run(`
      INSERT INTO users (name, email, password_hash, max_login_sessions)
      VALUES (?, ?, ?, 1)
    `, [name.trim(), email.toLowerCase().trim(), passwordHash]);

    const token = jwt.sign({ userId: result.id, email: email.toLowerCase().trim() }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Registration successful.',
      token,
      user: { id: result.id, name: name.trim(), email: email.toLowerCase().trim(), max_login_sessions: 1 }
    });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: 'Registration failed due to a server error.' });
  }
});

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await get('SELECT id, name, email, password_hash, max_login_sessions FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login successful.',
      token,
      user: { id: user.id, name: user.name, email: user.email, max_login_sessions: user.max_login_sessions }
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Login failed due to a server error.' });
  }
});

router.post('/auth/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      await run('INSERT OR IGNORE INTO token_blacklist (token) VALUES (?)', [token]);
    } catch (e) {}
  }
  res.json({ message: 'Logged out successfully and token revoked.' });
});

router.get('/auth/me', async (req, res) => {
  try {
    const user = await get('SELECT id, name, email, max_login_sessions FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve user profile.' });
  }
});

// Multer setup for handling file uploads safely
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = getUploadsDir();
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomUUID()}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = [
      '.xlsx', '.xls', '.csv', '.pdf', '.doc', '.docx', '.txt',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
      '.mp4', '.mkv', '.avi', '.mov', '.3gp', '.ogg', '.webm', '.zip'
    ];
    if (allowedExts.includes(ext) || file.fieldname === 'attachments') {
      cb(null, true);
    } else {
      cb(new Error(`File format '${ext}' is not supported.`));
    }
  }
});

// Helper: compiles dynamic message template using placeholders safely with Word/Unicode line-break normalization
function compileTemplate(template, placeholders = {}) {
  let message = (template || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\r\u2028\u000B\u0085\u000C]/g, '\n')
    .replace(/\u2029/g, '\n\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B\uFEFF]/g, '');

  Object.entries(placeholders || {}).forEach(([key, val]) => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`{{\\s*${escapedKey}\\s*}}`, 'gi');
    let strVal = val !== undefined && val !== null ? String(val) : '';
    strVal = strVal
      .replace(/\r\n/g, '\n')
      .replace(/[\r\u2028\u000B\u0085\u000C]/g, '\n')
      .replace(/\u2029/g, '\n\n')
      .replace(/\u00A0/g, ' ');
    message = message.replace(regex, strVal);
  });
  return message;
}

// ==========================================
// 1. Settings Routes (Tenant-Scoped)
// ==========================================
router.get('/settings', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings WHERE user_id = ?', [req.user.id]);
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

router.post('/settings', async (req, res) => {
  const settings = req.body;
  try {
    const toSave = {};
    for (const [key, value] of Object.entries(settings || {})) {
      if (value !== undefined && value !== null && typeof value !== 'object') {
        toSave[key] = String(value);
      }
    }

    // Sync aliases
    if (toSave.min_delay_seconds !== undefined) {
      toSave.min_delay = toSave.min_delay_seconds;
      toSave.minDelaySeconds = toSave.min_delay_seconds;
    } else if (toSave.min_delay !== undefined) {
      toSave.min_delay_seconds = toSave.min_delay;
      toSave.minDelaySeconds = toSave.min_delay;
    } else if (toSave.minDelaySeconds !== undefined) {
      toSave.min_delay_seconds = toSave.minDelaySeconds;
      toSave.min_delay = toSave.minDelaySeconds;
    }

    if (toSave.max_delay_seconds !== undefined) {
      toSave.max_delay = toSave.max_delay_seconds;
      toSave.maxDelaySeconds = toSave.max_delay_seconds;
    } else if (toSave.max_delay !== undefined) {
      toSave.max_delay_seconds = toSave.max_delay;
      toSave.maxDelaySeconds = toSave.max_delay;
    } else if (toSave.maxDelaySeconds !== undefined) {
      toSave.max_delay_seconds = toSave.maxDelaySeconds;
      toSave.max_delay = toSave.maxDelaySeconds;
    }

    if (toSave.burst_interval_messages !== undefined) {
      toSave.burstRestAfter = toSave.burst_interval_messages;
    } else if (toSave.burstRestAfter !== undefined) {
      toSave.burst_interval_messages = toSave.burstRestAfter;
    }

    if (toSave.burst_pause_seconds !== undefined) {
      toSave.burstRestDuration = toSave.burst_pause_seconds;
    } else if (toSave.burstRestDuration !== undefined) {
      toSave.burst_pause_seconds = toSave.burstRestDuration;
    }

    if (toSave.enable_smart_rate_limiter !== undefined) {
      toSave.rateLimiterEnabled = toSave.enable_smart_rate_limiter;
    } else if (toSave.rateLimiterEnabled !== undefined) {
      toSave.enable_smart_rate_limiter = String(toSave.rateLimiterEnabled);
    }

    for (const [key, value] of Object.entries(toSave)) {
      await run(`
        INSERT OR REPLACE INTO settings (user_id, key, value)
        VALUES (?, ?, ?)
      `, [req.user.id, key, String(value)]);
    }
    res.json({ message: 'Settings saved successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

// ==========================================
// 1.1 Anti-Ban Protection Suite Routes
// ==========================================
router.get('/anti-ban/health', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings WHERE user_id = ?', [req.user.id]);
    const settings = {};
    (rows || []).forEach(r => { settings[r.key] = r.value; });
    const health = await calculateHealthScore(req.user.id, settings);
    res.json({ success: true, ...health, score: health.healthScore, status: health.statusLevel, checks: health.recommendations || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to calculate health score.' });
  }
});

router.get('/anti-ban/settings', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings WHERE user_id = ?', [req.user.id]);
    const settings = {};
    (rows || []).forEach(r => { settings[r.key] = r.value; });
    const minDelay = parseInt(settings.min_delay_seconds || settings.min_delay || settings.minDelaySeconds) || 5;
    const maxDelay = parseInt(settings.max_delay_seconds || settings.max_delay || settings.maxDelaySeconds) || 60;
    const burstAfter = parseInt(settings.burst_interval_messages || settings.burstRestAfter) || 25;
    const burstDuration = settings.burst_pause_seconds !== undefined ? parseInt(settings.burst_pause_seconds) : (settings.burstRestDuration !== undefined ? parseInt(settings.burstRestDuration) : 120);
    const rateLimiterEnabled = settings.enable_smart_rate_limiter !== 'false' && settings.enable_smart_rate_limiter !== false && settings.rateLimiterEnabled !== false;

    res.json({
      success: true,
      settings,
      minDelaySeconds: minDelay,
      maxDelaySeconds: maxDelay,
      burstRestAfter: burstAfter,
      burstRestDuration: burstDuration,
      rateLimiterEnabled
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch anti-ban settings.' });
  }
});

router.post('/anti-ban/settings', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ success: false, error: 'Invalid settings payload format' });
  }

  try {
    const toSave = {};
    if (Array.isArray(body)) {
      if (body.length === 0 || !body.every(item => item && typeof item === 'object' && 'key' in item)) {
        return res.status(400).json({ success: false, error: 'Invalid settings payload format' });
      }
      body.forEach(item => { toSave[item.key] = String(item.value ?? ''); });
    } else if (Array.isArray(body.settings)) {
      if (body.settings.length === 0 || !body.settings.every(item => item && typeof item === 'object' && 'key' in item)) {
        return res.status(400).json({ success: false, error: 'Invalid settings payload format' });
      }
      body.settings.forEach(item => { toSave[item.key] = String(item.value ?? ''); });
    } else {
      if (body.settings && typeof body.settings === 'object') {
        Object.entries(body.settings).forEach(([k, v]) => {
          if (v !== undefined && v !== null && typeof v !== 'object') {
            toSave[k] = String(v);
          }
        });
      }
      Object.entries(body).forEach(([k, v]) => {
        if (k !== 'settings' && v !== undefined && v !== null && typeof v !== 'object') {
          toSave[k] = String(v);
        }
      });
      if (Object.keys(toSave).length === 0 && Object.keys(body).length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid settings payload format' });
      }
    }

    // Synchronize aliases
    if (toSave.minDelaySeconds !== undefined) {
      toSave.min_delay_seconds = toSave.minDelaySeconds;
      toSave.min_delay = toSave.minDelaySeconds;
    } else if (toSave.min_delay_seconds !== undefined) {
      toSave.min_delay = toSave.min_delay_seconds;
      toSave.minDelaySeconds = toSave.min_delay_seconds;
    } else if (toSave.min_delay !== undefined) {
      toSave.min_delay_seconds = toSave.min_delay;
      toSave.minDelaySeconds = toSave.min_delay;
    }

    if (toSave.maxDelaySeconds !== undefined) {
      toSave.max_delay_seconds = toSave.maxDelaySeconds;
      toSave.max_delay = toSave.maxDelaySeconds;
    } else if (toSave.max_delay_seconds !== undefined) {
      toSave.max_delay = toSave.max_delay_seconds;
      toSave.maxDelaySeconds = toSave.max_delay_seconds;
    } else if (toSave.max_delay !== undefined) {
      toSave.max_delay_seconds = toSave.max_delay;
      toSave.maxDelaySeconds = toSave.max_delay;
    }

    if (toSave.burstRestAfter !== undefined) {
      toSave.burst_interval_messages = toSave.burstRestAfter;
    } else if (toSave.burst_interval_messages !== undefined) {
      toSave.burstRestAfter = toSave.burst_interval_messages;
    }

    if (toSave.burstRestDuration !== undefined) {
      toSave.burst_pause_seconds = toSave.burstRestDuration;
    } else if (toSave.burst_pause_seconds !== undefined) {
      toSave.burstRestDuration = toSave.burst_pause_seconds;
    }

    if (toSave.rateLimiterEnabled !== undefined) {
      toSave.enable_smart_rate_limiter = String(toSave.rateLimiterEnabled);
    } else if (toSave.enable_smart_rate_limiter !== undefined) {
      toSave.rateLimiterEnabled = toSave.enable_smart_rate_limiter;
    }

    if (toSave.warmupEnabled !== undefined) {
      toSave.enable_number_warmup = String(toSave.warmupEnabled);
      toSave.warmup_enabled = String(toSave.warmupEnabled);
    } else if (toSave.enable_number_warmup !== undefined) {
      toSave.warmupEnabled = toSave.enable_number_warmup;
      toSave.warmup_enabled = toSave.enable_number_warmup;
    } else if (toSave.warmup_enabled !== undefined) {
      toSave.warmupEnabled = toSave.warmup_enabled;
      toSave.enable_number_warmup = toSave.warmup_enabled;
    }

    if (toSave.spintaxEnabled !== undefined) {
      toSave.enable_spintax = String(toSave.spintaxEnabled);
    } else if (toSave.enable_spintax !== undefined) {
      toSave.spintaxEnabled = toSave.enable_spintax;
    }

    if (toSave.healthMonitorEnabled !== undefined) {
      toSave.enable_health_monitoring = String(toSave.healthMonitorEnabled);
    } else if (toSave.enable_health_monitoring !== undefined) {
      toSave.healthMonitorEnabled = toSave.enable_health_monitoring;
    }

    if (toSave.warmupDay1 !== undefined) {
      toSave.warmup_stage1_limit = String(toSave.warmupDay1);
    }
    if (toSave.warmupDay2 !== undefined) {
      toSave.warmup_stage2_limit = String(toSave.warmupDay2);
    }
    if (toSave.warmupDay3 !== undefined) {
      toSave.warmup_stage3_limit = String(toSave.warmupDay3);
    }
    if (toSave.warmupDay7 !== undefined) {
      toSave.warmup_stage4_limit = String(toSave.warmupDay7);
    }

    for (const [key, value] of Object.entries(toSave)) {
      await run(`
        INSERT OR REPLACE INTO settings (user_id, key, value)
        VALUES (?, ?, ?)
      `, [req.user.id, key, String(value ?? '')]);
    }
    res.json({ success: true, message: 'Anti-ban settings updated.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update anti-ban settings.' });
  }
});

router.get('/anti-ban/blacklist', async (req, res) => {
  try {
    const list = await all('SELECT * FROM blacklisted_numbers WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    res.json({ success: true, blacklist: list || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch blacklisted numbers.' });
  }
});

router.post('/anti-ban/blacklist', async (req, res) => {
  const phone = req.body && (req.body.number || req.body.phone);
  const clean = phone ? String(phone).replace(/\D/g, '') : '';
  if (!phone || clean.length < 5) {
    return res.status(400).json({ success: false, error: 'Invalid phone number' });
  }
  try {
    await addNumberToBlacklist(req.user.id, phone, req.body.reason || 'User Opt-Out');
    res.json({ success: true, message: 'Phone number added to opt-out blacklist.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to add number to blacklist.' });
  }
});

router.delete('/anti-ban/blacklist/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const raw = String(id).trim();
    const clean = raw.replace(/\D/g, '');
    const isNumericId = /^\d+$/.test(raw) && !raw.startsWith('+') && clean.length < 7;

    if (isNumericId) {
      // Disambiguated as database primary key row ID
      const result = await run('DELETE FROM blacklisted_numbers WHERE id = ? AND user_id = ?', [parseInt(raw), req.user.id]);
      if (!result || result.changes === 0) {
        return res.status(400).json({ success: false, error: 'Blacklist entry not found' });
      }
      return res.json({ success: true, message: 'Number removed from opt-out blacklist.', deletedCount: result.changes });
    }

    // Otherwise, treat as phone number string
    const last10 = clean.length >= 10 ? clean.slice(-10) : clean;
    const result = await run(`
      DELETE FROM blacklisted_numbers 
      WHERE user_id = ? AND (
        phone = ? OR number = ? 
        OR phone = ? OR number = ?
        OR phone LIKE ? OR ? LIKE '%' || phone
      )
    `, [req.user.id, raw, raw, clean, last10, `%${last10}`, clean]);

    res.json({ success: true, message: 'Number removed from opt-out blacklist.', deletedCount: result.changes });
  } catch (error) {
    console.error('Delete blacklist error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete from blacklist.' });
  }
});

const handleSpintaxTest = (req, res) => {
  const text = req.body.text || req.body.template || '';
  const parsedText = parseSpintax(text, req.body);
  res.json({ success: true, result: parsedText, parsedText });
};

router.post('/anti-ban/spintax/test', handleSpintaxTest);
router.post('/anti-ban/spintax-preview', handleSpintaxTest);

router.post('/anti-ban/spintax/auto-generate', (req, res) => {
  const text = req.body.text || req.body.template || '';
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'Message text is required.' });
  }
  const generatedSpintax = generateAutoSpintax(text);
  const testSample = parseSpintax(generatedSpintax);
  res.json({ success: true, original: text, spintax: generatedSpintax, result: testSample });
});

// Automatic Multi-Message Spintax Fusion Studio Endpoint
router.post('/anti-ban/spintax/combine', (req, res) => {
  const { messages = [], mode = 'full' } = req.body;
  if (!Array.isArray(messages) || messages.filter(m => (m || '').trim()).length === 0) {
    return res.status(400).json({ success: false, error: 'Please provide at least 2 message variations to structure spintax.' });
  }

  const structuredSpintax = buildSpintaxFromMessages(messages, mode);
  
  // Generate 5 distinct live preview samples
  const liveSamples = [];
  for (let i = 0; i < 5; i++) {
    liveSamples.push(parseSpintax(structuredSpintax));
  }

  res.json({
    success: true,
    spintax: structuredSpintax,
    totalVariations: messages.filter(m => (m || '').trim()).length,
    samples: liveSamples
  });
});

  // ============================================================
  // ADVANCED ANTI-BAN: Number Reputation System
  // ============================================================
  
  // Get all number reputations
  router.get('/number-reputation', async (req, res) => {
    try {
      const userId = req.user?.id || 1;
      const { getAllNumberReputations } = await import('./services/antiBanService.js');
      const reputations = await getAllNumberReputations(userId);
      res.json({ success: true, reputations });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
  
  // Get single number reputation
  router.get('/number-reputation/:sessionName', async (req, res) => {
    try {
      const userId = req.user?.id || 1;
      const { getNumberReputation } = await import('./services/antiBanService.js');
      const rep = await getNumberReputation(userId, req.params.sessionName);
      res.json({ success: true, reputation: rep });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
  
  // Report restriction event
  router.post('/number-reputation/:sessionName/restrict', async (req, res) => {
    try {
      const userId = req.user?.id || 1;
      const { recordRestrictionEvent } = await import('./services/antiBanService.js');
      const result = await recordRestrictionEvent(userId, req.params.sessionName, req.body.notes || '');
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
  
  // Clear cooldown (manual override)
  router.post('/number-reputation/:sessionName/clear-cooldown', async (req, res) => {
    try {
      const userId = req.user?.id || 1;
      await run(`UPDATE number_reputation SET cooldown_until = NULL, updated_at = ? WHERE user_id = ? AND session_name = ?`, 
        [new Date().toISOString(), userId, req.params.sessionName]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
  
  // Get engagement stats
  router.get('/engagement-stats', async (req, res) => {
    try {
      const userId = req.user?.id || 1;
      const campaignId = req.query.campaignId ? parseInt(req.query.campaignId) : null;
      const { calculateEngagementScore } = await import('./services/antiBanService.js');
      const score = await calculateEngagementScore(userId, campaignId);
      res.json({ success: true, engagement: score });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

// ==========================================
// 1.5 Audience & Address Book Routes (Tenant-Scoped)
// ==========================================
router.get('/audience/contacts', async (req, res) => {
  const { search, tag } = req.query;
  let sql = 'SELECT * FROM saved_contacts WHERE user_id = ?';
  const params = [req.user.id];

  if (tag && tag !== 'All') {
    sql += ' AND tag = ?';
    params.push(tag);
  }

  if (search) {
    sql += ' AND (name LIKE ? OR phone LIKE ? OR company LIKE ? OR email LIKE ?)';
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam, searchParam);
  }

  sql += ' ORDER BY created_at DESC';

  try {
    const contacts = await all(sql, params);
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch saved contacts.' });
  }
});

router.post('/audience/contacts', async (req, res) => {
  const { name, phone, company, email, tag = 'General', custom_data, bulk_text } = req.body;

  try {
    if (bulk_text && bulk_text.trim()) {
      const parsedContacts = parseRawTextContacts(bulk_text);
      let count = 0;
      for (const c of parsedContacts) {
        if (!c.phone) continue;
        await run(`
          INSERT INTO saved_contacts (user_id, name, phone, company, email, tag, placeholder_data)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          req.user.id,
          c.name,
          c.phone,
          c.company || '',
          '',
          tag || 'General',
          JSON.stringify(c.placeholderData || { name: c.name, phone: c.phone, company: c.company })
        ]);
        count++;
      }
      return res.json({ message: `Successfully added ${count} contacts to Audience Hub.` });
    }

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and Phone number are required.' });
    }

    const hasPlus = phone.trim().startsWith('+');
    const cleanPhone = phone.trim().replace(/\D/g, '');
    const finalPhone = hasPlus ? '+' + cleanPhone : cleanPhone;

    const result = await run(`
      INSERT INTO saved_contacts (user_id, name, phone, company, email, tag, placeholder_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      req.user.id,
      name.trim(),
      finalPhone,
      company ? company.trim() : '',
      email ? email.trim() : '',
      tag ? tag.trim() : 'General',
      JSON.stringify(custom_data || { name, phone: finalPhone, company, email })
    ]);

    res.json({ message: 'Contact saved successfully.', id: result.id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save contact.' });
  }
});

router.put('/audience/contacts/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, company, email, tag, custom_data } = req.body;

  try {
    const existing = await get('SELECT * FROM saved_contacts WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Contact not found or unauthorized.' });
    }

    const hasPlus = phone ? phone.trim().startsWith('+') : (existing.phone || '').startsWith('+');
    const cleanPhone = phone ? phone.trim().replace(/\D/g, '') : existing.phone;
    const finalPhone = phone ? (hasPlus ? '+' + cleanPhone : cleanPhone) : existing.phone;

    await run(`
      UPDATE saved_contacts
      SET name = ?, phone = ?, company = ?, email = ?, tag = ?, placeholder_data = ?
      WHERE id = ? AND user_id = ?
    `, [
      name !== undefined ? name.trim() : existing.name,
      finalPhone,
      company !== undefined ? company.trim() : existing.company,
      email !== undefined ? email.trim() : existing.email,
      tag !== undefined ? tag.trim() : existing.tag,
      JSON.stringify(custom_data || { name, phone: finalPhone, company, email }),
      id,
      req.user.id
    ]);

    res.json({ message: 'Contact updated successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update contact.' });
  }
});

router.delete('/audience/contacts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await get('SELECT id FROM saved_contacts WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Contact not found or unauthorized.' });
    }

    await run('DELETE FROM saved_contacts WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ message: 'Contact deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete contact.' });
  }
});

router.post('/audience/contacts/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Please select contacts to delete.' });
  }

  try {
    const placeholders = ids.map(() => '?').join(',');
    const params = [...ids, req.user.id];
    await run(`DELETE FROM saved_contacts WHERE id IN (${placeholders}) AND user_id = ?`, params);
    res.json({ message: `Successfully deleted ${ids.length} contacts.` });
  } catch (error) {
    console.error('Error in bulk delete contacts:', error);
    res.status(500).json({ error: 'Failed to bulk delete contacts.' });
  }
});

router.get('/audience/tags', async (req, res) => {
  try {
    const rows = await all("SELECT DISTINCT tag FROM saved_contacts WHERE user_id = ? AND tag IS NOT NULL AND tag != '' ORDER BY tag ASC", [req.user.id]);
    const tags = rows.map(r => r.tag);
    res.json(tags);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tags.' });
  }
});

router.post('/audience/import-sheet', async (req, res) => {
  const { sheetUrl, tag = 'Google Sheets' } = req.body;
  if (!sheetUrl) {
    return res.status(400).json({ error: 'Google Sheets URL is required.' });
  }

  try {
    const fetchedContacts = await fetchGoogleSheet(sheetUrl);
    let count = 0;
    for (const c of fetchedContacts) {
      if (!c.phone) continue;
      await run(`
        INSERT INTO saved_contacts (user_id, name, phone, company, tag, placeholder_data)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        req.user.id,
        c.name,
        c.phone,
        c.company || '',
        tag,
        JSON.stringify(c.placeholderData || { name: c.name, phone: c.phone, company: c.company })
      ]);
      count++;
    }
    await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, 'google_sheet_url', ?)", [req.user.id, sheetUrl]);
    res.json({ message: `Successfully imported ${count} contacts from Google Sheet into tag "${tag}".`, count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to import contacts from Google Sheet.' });
  }
});

// ==========================================
// 2. Campaign Routes (Tenant-Scoped)
// ==========================================
router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await all('SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch campaigns.' });
  }
});

router.post('/campaigns', (req, res, next) => {
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'attachments', maxCount: 10 }])(req, res, (err) => {
    if (err) {
      if (req.body && req.body.source !== 'file') {
        return next();
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  const targetUserId = req.user?.id || 1;
  const { name, source = 'file', sheetUrl, tag, rawText, attachmentPath } = req.body;
  const rawTemplate = req.body.template || '';
  const template = String(rawTemplate)
    .replace(/\r\n/g, '\n')
    .replace(/[\r\u2028\u000B\u0085\u000C]/g, '\n')
    .replace(/\u2029/g, '\n\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B\uFEFF]/g, '');
  const cleanAttachment = attachmentPath ? String(attachmentPath).trim().replace(/^["']+|["']+$|^\s*["']|["']\s*$/g, '').trim() : '';

  // Collect uploaded attachment files if present
  let uploadedAttachmentsStr = '';
  if (req.files && req.files['attachments'] && req.files['attachments'].length > 0) {
    uploadedAttachmentsStr = req.files['attachments'].map(f => f.filename).join(', ');
  }

  const combinedAttachment = [cleanAttachment, uploadedAttachmentsStr].filter(Boolean).join(', ');

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Campaign name is required.' });
  }

  let contacts = [];

  try {
    if (source === 'file') {
      const excelFile = req.file || (req.files && req.files['file'] && req.files['file'][0]);
      if (!excelFile) {
        return res.status(400).json({ error: 'Please upload a spreadsheet file (.xlsx, .xls, or .csv).' });
      }
      try {
        contacts = parseSpreadsheet(excelFile.path);
      } finally {
        try {
          if (fs.existsSync(excelFile.path)) {
            fs.unlinkSync(excelFile.path);
          }
        } catch (e) {}
      }
    } else if (source === 'raw_text') {
      if (!rawText || !rawText.trim()) {
        return res.status(400).json({ error: 'Please enter phone numbers or paste CSV text.' });
      }
      contacts = parseRawTextContacts(rawText);
    } else if (source === 'sheet') {
      if (!sheetUrl || !sheetUrl.trim()) {
        return res.status(400).json({ error: 'Please provide a valid Google Sheets URL.' });
      }
      contacts = await fetchGoogleSheet(sheetUrl);
      await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, 'google_sheet_url', ?)", [targetUserId, sheetUrl]);
    } else if (source === 'group') {
      if (!tag) {
        return res.status(400).json({ error: 'Please select an audience contact group/tag.' });
      }
      const rows = await all('SELECT * FROM saved_contacts WHERE user_id = ? AND tag = ?', [targetUserId, tag]);
      contacts = rows.map((r, idx) => ({
        name: r.name,
        phone: r.phone,
        company: r.company || '',
        message: '',
        attachment: combinedAttachment || '',
        placeholderData: r.placeholder_data ? JSON.parse(r.placeholder_data) : { name: r.name, phone: r.phone, company: r.company },
        rowIndex: idx + 1
      }));
    } else if (source === 'all_saved') {
      const rows = await all('SELECT * FROM saved_contacts WHERE user_id = ?', [targetUserId]);
      contacts = rows.map((r, idx) => ({
        name: r.name,
        phone: r.phone,
        company: r.company || '',
        message: '',
        attachment: combinedAttachment || '',
        placeholderData: r.placeholder_data ? JSON.parse(r.placeholder_data) : { name: r.name, phone: r.phone, company: r.company },
        rowIndex: idx + 1
      }));
    } else {
      return res.status(400).json({ error: 'Invalid contact source selected. Choose Spreadsheet, Quick Paste, Google Sheet, or Saved Audience.' });
    }

    // Fetch user default country code setting for sanitization
    const ccSetting = await get("SELECT value FROM settings WHERE user_id = ? AND key = 'default_country_code'", [targetUserId]);
    const defaultCc = ccSetting ? ccSetting.value : '91';

    // Sanitize and deduplicate contacts list
    contacts = sanitizeContactsList(contacts, defaultCc);

    if (contacts.length === 0) {
      return res.status(400).json({ 
        error: 'No valid phone numbers found. Please check your recipient list or spreadsheet format.' 
      });
    }

    const { scheduledAt, sessionMode = 'auto_split', sessionName, sessionId, selectedSessions, autoFragment, fragmentMaxPerWindow } = req.body;
    let finalSessionMode = sessionMode || 'auto_split';
    let finalSessionName = sessionName || sessionId || (finalSessionMode === 'auto_split' ? 'auto_split' : 'default');

    if (selectedSessions) {
      if (Array.isArray(selectedSessions) && selectedSessions.length > 0) {
        finalSessionName = selectedSessions.join(',');
        finalSessionMode = 'custom_subset';
      } else if (typeof selectedSessions === 'string' && selectedSessions.trim()) {
        try {
          const parsed = JSON.parse(selectedSessions);
          if (Array.isArray(parsed) && parsed.length > 0) {
            finalSessionName = parsed.join(',');
            finalSessionMode = 'custom_subset';
          } else {
            finalSessionName = selectedSessions.trim();
            finalSessionMode = selectedSessions.includes(',') ? 'custom_subset' : finalSessionMode;
          }
        } catch (e) {
          finalSessionName = selectedSessions.trim();
          finalSessionMode = selectedSessions.includes(',') ? 'custom_subset' : finalSessionMode;
        }
      }
    }

    const isAutoFragment = autoFragment === 'true' || autoFragment === true ? 'true' : 'false';
    const maxPerWindow = parseInt(fragmentMaxPerWindow) || 25;
    const initialStatus = scheduledAt && new Date(scheduledAt) > new Date() ? 'Scheduled' : 'Pending';

    const campaignResult = await run(`
      INSERT INTO campaigns (user_id, name, status, total_contacts, sent_count, failed_count, scheduled_at, session_mode, session_name, auto_fragment, fragment_max_per_window)
      VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
    `, [targetUserId, name.trim(), initialStatus, contacts.length, scheduledAt || null, finalSessionMode, finalSessionName, isAutoFragment, maxPerWindow]);

    const campaignId = campaignResult.id;

    const insertContactStmt = db.prepare(`
      INSERT INTO contacts (user_id, campaign_id, name, phone, company, message_template, placeholder_data, attachment_path, status, row_index, variant_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)
    `);

    try {
      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];

        let compiledMsg = '';
        if (!template.trim() || template.trim() === '{{Message}}') {
          compiledMsg = contact.message || '';
        } else {
          compiledMsg = compileTemplate(template, contact.placeholderData || { name: contact.name, phone: contact.phone });
        }
        
        const rawContactAttach = contact.attachment ? String(contact.attachment).trim() : '';
        const allAttach = [rawContactAttach, combinedAttachment]
          .filter(Boolean)
          .join(',')
          .split(',')
          .map(s => s.trim().replace(/^["']+|["']+$|^\s*["']|["']\s*$/g, ''))
          .filter(Boolean);
        const finalAttachment = Array.from(new Set(allAttach)).join(', ');
        const variantName = contact.variantName || req.body.variantName || 'A';

        insertContactStmt.run(
          targetUserId,
          campaignId,
          contact.name || 'Recipient',
          contact.phone || '',
          contact.company || '',
          compiledMsg,
          JSON.stringify(contact.placeholderData || { name: contact.name, phone: contact.phone, company: contact.company }),
          finalAttachment,
          contact.rowIndex || (i + 1),
          variantName
        );
      }
    } catch (insertErr) {
      throw insertErr;
    }

    res.json({ 
      message: 'Campaign created successfully.',
      campaignId,
      totalContacts: contacts.length,
      sessionMode: finalSessionMode,
      sessionName: finalSessionName
    });

  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: error?.message || 'Failed to create campaign.' });
  }
});

// Download Generated Excel Delivery Report (.xlsx)
router.get('/campaigns/:id/report/download', async (req, res) => {
  const { id } = req.params;
  try {
    const campaign = await get('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found or unauthorized.' });
    }

    let filePath = campaign.report_path;
    if (!filePath || !fs.existsSync(filePath)) {
      // Automatically generate on the fly if not yet created
      filePath = await runner.generateCampaignExcelReport(campaign.id);
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(500).json({ error: 'Failed to generate campaign Excel report.' });
    }

    const safeCampaignName = (campaign.name || 'Campaign').replace(/[^a-zA-Z0-9_-]/g, '_');
    const downloadFilename = `${safeCampaignName}_Delivery_Report.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    return res.download(filePath, downloadFilename);
  } catch (error) {
    console.error('Error downloading campaign report:', error);
    res.status(500).json({ error: 'Failed to download campaign delivery report.' });
  }
});

// Trigger Excel Report Generation On-Demand
router.post('/campaigns/:id/report/generate', async (req, res) => {
  const { id } = req.params;
  try {
    const campaign = await get('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found or unauthorized.' });
    }

    const filePath = await runner.generateCampaignExcelReport(campaign.id);
    if (!filePath) {
      return res.status(500).json({ error: 'Failed to generate Excel report.' });
    }

    res.json({
      success: true,
      message: 'Excel delivery report generated successfully.',
      reportPath: filePath,
      downloadUrl: `/api/campaigns/${id}/report/download`
    });
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report.' });
  }
});

router.delete('/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await get('SELECT id FROM campaigns WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Campaign not found or unauthorized.' });
    }

    // If currently running, cleanup first
    const status = runner.getStatus();
    if (status.currentCampaignId === parseInt(id)) {
      await runner.stopCampaign(parseInt(id));
    }

    await run('DELETE FROM campaigns WHERE id = ? AND user_id = ?', [id, req.user.id]);
    await run('DELETE FROM contacts WHERE campaign_id = ? AND user_id = ?', [id, req.user.id]);
    await run('DELETE FROM logs WHERE campaign_id = ? AND user_id = ?', [id, req.user.id]);

    res.json({ message: 'Campaign deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete campaign.' });
  }
});

// Helper function to clone a campaign and its contacts into a new pending campaign
async function duplicateCampaignHelper(sourceCampaign, userId, res) {
  const newName = `${sourceCampaign.name} (Copy)`;
  const contacts = await all('SELECT * FROM contacts WHERE campaign_id = ? AND user_id = ? ORDER BY id ASC', [sourceCampaign.id, userId]);
  
  // Create duplicated campaign record in Pending status with reset metrics
  const newCampRes = await run(`
    INSERT INTO campaigns (
      user_id, name, status, total_contacts, sent_count, failed_count, duration,
      session_mode, session_name, auto_fragment, fragment_max_per_window, scheduled_at
    ) VALUES (?, ?, 'Pending', ?, 0, 0, 0, ?, ?, ?, ?, NULL)
  `, [
    userId,
    newName,
    (contacts || []).length,
    sourceCampaign.session_mode || 'auto_split',
    sourceCampaign.session_name || 'default',
    sourceCampaign.auto_fragment || 'false',
    sourceCampaign.fragment_max_per_window || 25
  ]);

  const newCampaignId = newCampRes.id;

  // Duplicate all contacts associated with the source campaign
  for (const c of (contacts || [])) {
    await run(`
      INSERT INTO contacts (
        user_id, campaign_id, name, phone, company, message_template, placeholder_data, attachment_path, status, row_index, variant_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)
    `, [
      userId,
      newCampaignId,
      c.name,
      c.phone,
      c.company || '',
      c.message_template,
      c.placeholder_data || null,
      c.attachment_path || '',
      c.row_index || 0,
      c.variant_name || null
    ]);
  }

  const duplicatedCampaign = await get('SELECT * FROM campaigns WHERE id = ?', [newCampaignId]);
  
  return res.json({
    success: true,
    message: `Campaign '${sourceCampaign.name}' duplicated successfully as '${newName}'.`,
    campaign: duplicatedCampaign,
    contactCount: (contacts || []).length
  });
}

// Duplicate the most recent / last campaign for the user
router.post('/campaigns/duplicate-last', async (req, res) => {
  try {
    const lastCampaign = await get('SELECT * FROM campaigns WHERE user_id = ? ORDER BY id DESC LIMIT 1', [req.user.id]);
    if (!lastCampaign) {
      return res.status(404).json({ error: 'No previous campaign found to duplicate.' });
    }
    return await duplicateCampaignHelper(lastCampaign, req.user.id, res);
  } catch (error) {
    console.error('Error duplicating last campaign:', error);
    res.status(500).json({ error: 'Failed to duplicate last campaign: ' + error.message });
  }
});

// Duplicate specific campaign by ID
router.post('/campaigns/:id/duplicate', async (req, res) => {
  const { id } = req.params;
  try {
    const campaign = await get('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found or unauthorized.' });
    }
    return await duplicateCampaignHelper(campaign, req.user.id, res);
  } catch (error) {
    console.error('Error duplicating campaign:', error);
    res.status(500).json({ error: 'Failed to duplicate campaign: ' + error.message });
  }
});


// ==========================================
// 3. Contacts Routes (Tenant-Scoped)
// ==========================================
router.get('/contacts', async (req, res) => {
  const { campaignId, search, status } = req.query;
  let sql = 'SELECT * FROM contacts WHERE user_id = ?';
  const params = [req.user.id];

  if (campaignId) {
    sql += ' AND campaign_id = ?';
    params.push(campaignId);
  }

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  if (search) {
    sql += ' AND (name LIKE ? OR phone LIKE ? OR company LIKE ?)';
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam);
  }

  sql += ' ORDER BY id ASC';

  try {
    const contacts = await all(sql, params);
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch recipient contacts.' });
  }
});

// ==========================================
// 4. Logs Routes (Tenant-Scoped)
// ==========================================
router.get('/logs', async (req, res) => {
  const { campaignId } = req.query;
  let sql = 'SELECT * FROM logs WHERE (user_id = ? OR user_id IS NULL)';
  const params = [req.user.id];

  if (campaignId) {
    sql += ' AND campaign_id = ?';
    params.push(campaignId);
  }

  sql += ' ORDER BY id DESC LIMIT 200';

  try {
    const logs = await all(sql, params);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

// ==========================================
// 5. Automation Control Routes (Ownership Enforced)
// ==========================================
router.get('/automation/status', (req, res) => {
  res.json(runner.getStatus());
});

router.post('/automation/control', async (req, res) => {
  const { action, campaignId } = req.body;

  if (!action || !campaignId) {
    return res.status(400).json({ error: 'Action and campaignId are required.' });
  }

  const id = parseInt(campaignId);

  try {
    const campaign = await get('SELECT id FROM campaigns WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found or unauthorized.' });
    }

    switch (action) {
      case 'start':
        await runner.startCampaign(id);
        break;
      case 'pause':
        await runner.pauseCampaign(id);
        break;
      case 'resume':
        await runner.resumeCampaign(id);
        break;
      case 'stop':
        await runner.stopCampaign(id);
        break;
      default:
        return res.status(400).json({ error: 'Invalid control action.' });
    }
    res.json(runner.getStatus());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Automation control failed.' });
  }
});

// Helper: Checks if current user has available seat quota for a new active session
async function checkSeatQuota(userId) {
  const user = await get('SELECT max_login_sessions FROM users WHERE id = ?', [userId]);
  const maxSeats = user ? (user.max_login_sessions || 1) : 1;
  const currentSession = await runner.checkSession();
  
  const activeCount = currentSession.connected || currentSession.browserOpen ? 1 : 0;
  
  return {
    allowed: activeCount < maxSeats,
    activeCount,
    maxSeats,
    availableSeats: Math.max(0, maxSeats - activeCount)
  };
}

// Endpoint: User Quota Details
router.get('/user/quota', async (req, res) => {
  try {
    const quota = await checkSeatQuota(req.user.id);
    res.json({
      userId: req.user.id,
      max_login_sessions: quota.maxSeats,
      active_sessions: quota.activeCount,
      available_seats: quota.availableSeats
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve user seat quota.' });
  }
});

// Endpoint: Create Razorpay Order for Seat Purchase
router.post('/billing/razorpay-order', async (req, res) => {
  const { additionalSeats = 1 } = req.body;
  const seats = Math.max(1, parseInt(additionalSeats) || 1);
  const pricePerSeatInPaise = 99900; // Profile slot license pack (Paise)

  try {
    const user = await get('SELECT id, email, name, max_login_sessions FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const isMock = !keyId || keyId === 'rzp_test_mock_key_id' || keyId === 'rzp_test_change_me';

    if (isMock) {
      return res.json({
        mock: true,
        orderId: `order_mock_${Date.now()}`,
        amount: pricePerSeatInPaise * seats,
        currency: 'INR',
        key: 'rzp_test_mock_key_id',
        user: { name: user.name, email: user.email }
      });
    }

    const order = await razorpay.orders.create({
      amount: pricePerSeatInPaise * seats,
      currency: 'INR',
      receipt: `seat_receipt_${user.id}_${Date.now()}`,
      notes: {
        userId: user.id.toString(),
        additionalSeats: seats.toString()
      }
    });

    res.json({
      mock: false,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
      user: { name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Razorpay order creation error:', error);
    res.status(500).json({ error: 'Failed to create Razorpay order.' });
  }
});

// Endpoint: Verify Razorpay Payment Signature
router.post('/billing/razorpay-verify', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, additionalSeats = 1 } = req.body;
  const seatsToAdd = Math.max(1, parseInt(additionalSeats) || 1);

  try {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const isMock = !keySecret || keySecret === 'rzp_test_mock_key_secret' || keySecret === 'rzp_secret_change_me';

    if (!isMock) {
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing Razorpay signature parameters.' });
      }

      const generatedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (generatedSignature !== razorpay_signature) {
        return res.status(400).json({ error: 'Payment verification failed: Invalid Razorpay signature.' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      return res.status(400).json({ error: 'Mock payments are disabled in production environment.' });
    }

    const user = await get('SELECT max_login_sessions FROM users WHERE id = ?', [req.user.id]);
    const currentSeats = user ? (user.max_login_sessions || 1) : 1;
    const newSeatLimit = currentSeats + seatsToAdd;

    await run('UPDATE users SET max_login_sessions = ? WHERE id = ?', [newSeatLimit, req.user.id]);

    res.json({
      message: `Razorpay Payment Verified! Added ${seatsToAdd} login ID seat(s).`,
      max_login_sessions: newSeatLimit
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Payment verification failed.' });
  }
});

// ==========================================
// Multi-Session Management Endpoints (Tenant-Scoped)
// ==========================================
router.get('/automation/sessions', async (req, res) => {
  try {
    const sessions = await all('SELECT * FROM whatsapp_sessions WHERE user_id = ? ORDER BY id ASC', [req.user.id]);

    const mapped = await Promise.all(sessions.map(async (s) => {
      const liveStatus = await runner.checkSession(s.session_name);
      return {
        ...s,
        connected: liveStatus.connected,
        status: liveStatus.connected ? 'Connected' : (liveStatus.qrImageUrl ? 'Scan QR Required' : (liveStatus.status || 'Disconnected')),
        phone_number: s.phone_number || liveStatus.phone_number || '',
        qrImageUrl: liveStatus.qrImageUrl,
        engine: s.engine || 'whatsapp-web.js'
      };
    }));

    res.json(mapped);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch WhatsApp sessions.' });
  }
});

router.post('/automation/sessions/create', async (req, res) => {
  const { session_name } = req.body;
  const name = session_name ? session_name.trim() : `WhatsApp Account #${Date.now().toString().slice(-4)}`;

  try {
    const existing = await all('SELECT * FROM whatsapp_sessions WHERE user_id = ?', [req.user.id]);
    const user = await get('SELECT max_login_sessions FROM users WHERE id = ?', [req.user.id]);
    const maxSeats = user ? (user.max_login_sessions || 1) : 1;

    if (existing.length >= maxSeats) {
      return res.status(403).json({
        error: `Session quota limit reached (${existing.length}/${maxSeats} profiles). Add more login seats to connect additional WhatsApp numbers.`
      });
    }

    const result = await run(`
      INSERT INTO whatsapp_sessions (user_id, session_name, status)
      VALUES (?, ?, 'Disconnected')
    `, [req.user.id, name]);

    const newSession = await get('SELECT * FROM whatsapp_sessions WHERE id = ? AND user_id = ?', [result.id, req.user.id]);
    res.json({ message: 'New WhatsApp session profile created successfully.', session: newSession });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create WhatsApp session profile.' });
  }
});

router.delete('/automation/sessions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await get(
      'SELECT id, session_name FROM whatsapp_sessions WHERE (id = ? OR session_name = ?) AND user_id = ?',
      [id, id, req.user.id]
    );

    const sessionNameToDelete = existing ? existing.session_name : id;

    // Disconnect active client and purge auth cache directory
    try {
      await runner.logoutSession(sessionNameToDelete);
    } catch (e) {
      console.error('Error logging out session during deletion:', e);
    }

    if (existing) {
      await run('DELETE FROM whatsapp_sessions WHERE id = ? AND user_id = ?', [existing.id, req.user.id]);
    }

    res.json({ message: `WhatsApp session profile '${sessionNameToDelete}' deleted and unlinked successfully.` });
  } catch (error) {
    console.error('Error deleting session profile:', error);
    res.status(500).json({ error: 'Failed to delete session profile.' });
  }
});

router.get('/automation/session', async (req, res) => {
  try {
    const session = await runner.checkSession();
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch automation session status.' });
  }
});

router.post('/automation/session/connect', async (req, res) => {
  try {
    const sessionName = req.body.session || req.query.session || 'default';
    const engine = req.body.engine || 'whatsapp-web.js';
    const quota = await checkSeatQuota(req.user.id);
    const session = await runner.checkSession(sessionName);
    if (!session.connected && !quota.allowed) {
      return res.status(403).json({
        error: `Seat quota limit reached (${quota.activeCount}/${quota.maxSeats} active seats). Please upgrade your subscription plan.`
      });
    }
    const result = await runner.connectSession(sessionName, engine);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to connect WhatsApp session.' });
  }
});

router.post('/automation/logout', async (req, res) => {
  try {
    const { session } = req.body;
    const sessionName = session || 'default';
    await runner.logoutSession(sessionName);
    res.json({ message: `WhatsApp session '${sessionName}' logged out successfully.` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to logout WhatsApp session.' });
  }
});

// ==========================================
// 6. SaaS Multi-Tenant & Per-Seat Management Routes
// ==========================================

async function getUserOrganization(userId) {
  let member = await get("SELECT om.*, o.name as org_name, o.owner_id, o.plan_tier, o.seat_limit, o.monthly_price_per_seat, o.subscription_status FROM org_members om JOIN organizations o ON om.org_id = o.id WHERE om.user_id = ?", [userId]);
  
  if (!member) {
    let org = await get("SELECT * FROM organizations WHERE owner_id = ?", [userId]);
    if (!org) {
      const user = await get("SELECT name FROM users WHERE id = ?", [userId]);
      const orgName = `${user ? user.name : 'User'}'s Workspace`;
      const res = await run("INSERT INTO organizations (name, owner_id, plan_tier, seat_limit, monthly_price_per_seat) VALUES (?, ?, 'pro_desktop', 5, 0.00)", [orgName, userId]);
      org = { id: res.id, name: orgName, owner_id: userId, plan_tier: 'pro_desktop', seat_limit: 5, monthly_price_per_seat: 0.00, subscription_status: 'active' };
    }
    await run("INSERT OR IGNORE INTO org_members (org_id, user_id, role) VALUES (?, ?, 'owner')", [org.id, userId]);
    member = { org_id: org.id, user_id: userId, role: 'owner', org_name: org.name, owner_id: userId, plan_tier: org.plan_tier, seat_limit: org.seat_limit, monthly_price_per_seat: org.monthly_price_per_seat, subscription_status: org.subscription_status };
  }
  return member;
}

router.get('/saas/organization', async (req, res) => {
  try {
    const memberInfo = await getUserOrganization(req.user.id);
    const orgId = memberInfo.org_id;

    const org = await get("SELECT * FROM organizations WHERE id = ?", [orgId]);
    const members = await all(`
      SELECT om.id as member_id, om.role, om.joined_at, u.id as user_id, u.name, u.email 
      FROM org_members om 
      JOIN users u ON om.user_id = u.id 
      WHERE om.org_id = ?
      ORDER BY om.id ASC
    `, [orgId]);

    const pendingInvites = await all(`
      SELECT id, email, token, role, status, created_at 
      FROM seat_invites 
      WHERE org_id = ? AND status = 'pending'
      ORDER BY id DESC
    `, [orgId]);

    const usedSeats = (members || []).length;
    const remainingSeats = Math.max(0, (org.seat_limit || 5) - usedSeats);
    const monthlyTotal = ((org.seat_limit || 5) * (org.monthly_price_per_seat || 0.00)).toFixed(2);

    res.json({
      success: true,
      organization: {
        id: org.id,
        name: org.name,
        owner_id: org.owner_id,
        plan_tier: org.plan_tier,
        seat_limit: org.seat_limit,
        monthly_price_per_seat: org.monthly_price_per_seat,
        subscription_status: org.subscription_status,
        monthly_total: monthlyTotal,
        user_role: memberInfo.role
      },
      used_seats: usedSeats,
      remaining_seats: remainingSeats,
      members: members || [],
      pending_invites: pendingInvites || []
    });
  } catch (error) {
    console.error('Error fetching organization:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch SaaS organization details.' });
  }
});

router.post('/saas/organization/invite', async (req, res) => {
  const { email, role = 'member' } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid email address is required.' });
  }

  try {
    const memberInfo = await getUserOrganization(req.user.id);
    if (memberInfo.role !== 'owner' && memberInfo.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only Organization Owners and Admins can invite team members.' });
    }

    const orgId = memberInfo.org_id;
    const org = await get("SELECT * FROM organizations WHERE id = ?", [orgId]);

    const members = await all("SELECT id FROM org_members WHERE org_id = ?", [orgId]);
    const pendingInvites = await all("SELECT id FROM seat_invites WHERE org_id = ? AND status = 'pending'", [orgId]);

    const occupiedCount = (members || []).length + (pendingInvites || []).length;
    if (occupiedCount >= org.seat_limit) {
      return res.status(400).json({
        success: false,
        error: `Seat quota limit reached (${occupiedCount}/${org.seat_limit} seats occupied). Upgrade seat capacity to invite more team members.`
      });
    }

    const existingMember = await get("SELECT om.id FROM org_members om JOIN users u ON om.user_id = u.id WHERE om.org_id = ? AND LOWER(u.email) = ?", [orgId, email.toLowerCase()]);
    if (existingMember) {
      return res.status(400).json({ success: false, error: 'User is already a member of this workspace.' });
    }

    const inviteToken = crypto.randomBytes(16).toString('hex');
    await run(`
      INSERT INTO seat_invites (org_id, invited_by_user_id, email, token, role, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `, [orgId, req.user.id, email.toLowerCase().trim(), inviteToken, role]);

    const inviteLink = `${req.protocol}://${req.get('host')}/accept-invite?token=${inviteToken}`;

    res.json({
      success: true,
      message: `Invitation generated for ${email}.`,
      inviteToken,
      inviteLink,
      role
    });
  } catch (error) {
    console.error('Error creating invite:', error);
    res.status(500).json({ success: false, error: 'Failed to create seat invitation.' });
  }
});

router.post('/saas/organization/accept-invite', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: 'Invite token is required.' });
  }

  try {
    const invite = await get("SELECT * FROM seat_invites WHERE token = ? AND status = 'pending'", [token]);
    if (!invite) {
      return res.status(400).json({ success: false, error: 'Invalid or expired invitation token.' });
    }

    if (invite.email && req.user.email && invite.email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ success: false, error: 'Invitation email does not match logged in user account.' });
    }

    const org = await get("SELECT * FROM organizations WHERE id = ?", [invite.org_id]);
    const members = await all("SELECT id FROM org_members WHERE org_id = ?", [invite.org_id]);
    if ((members || []).length >= org.seat_limit) {
      return res.status(400).json({ success: false, error: 'Organization has reached maximum seat capacity.' });
    }

    await run("INSERT OR REPLACE INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)", [invite.org_id, req.user.id, invite.role || 'member']);
    await run("UPDATE seat_invites SET status = 'accepted' WHERE id = ?", [invite.id]);

    res.json({
      success: true,
      message: `Successfully joined ${org.name} as ${invite.role}.`
    });
  } catch (error) {
    console.error('Error accepting invite:', error);
    res.status(500).json({ success: false, error: 'Failed to accept invitation.' });
  }
});

router.delete('/saas/organization/members/:memberUserId', async (req, res) => {
  const targetUserId = parseInt(req.params.memberUserId);
  try {
    const memberInfo = await getUserOrganization(req.user.id);
    if (memberInfo.role !== 'owner' && memberInfo.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only Owners and Admins can revoke member seats.' });
    }

    const org = await get("SELECT * FROM organizations WHERE id = ?", [memberInfo.org_id]);
    if (targetUserId === org.owner_id) {
      return res.status(400).json({ success: false, error: 'Cannot remove workspace owner.' });
    }

    await run("DELETE FROM org_members WHERE org_id = ? AND user_id = ?", [memberInfo.org_id, targetUserId]);
    res.json({ success: true, message: 'Team member seat revoked and slot freed.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to revoke member seat.' });
  }
});

router.delete('/saas/organization/invites/:inviteId', async (req, res) => {
  const inviteId = parseInt(req.params.inviteId);
  try {
    const memberInfo = await getUserOrganization(req.user.id);
    if (memberInfo.role !== 'owner' && memberInfo.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Only owners or admins can cancel invites.' });
    }
    await run("DELETE FROM seat_invites WHERE id = ? AND org_id = ?", [inviteId, memberInfo.org_id]);
    res.json({ success: true, message: 'Pending seat invite canceled.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to cancel invite.' });
  }
});

router.post('/saas/organization/update-seats', async (req, res) => {
  const { seat_limit } = req.body;
  const newLimit = parseInt(seat_limit);
  if (!newLimit || newLimit < 1) {
    return res.status(400).json({ success: false, error: 'Valid seat limit number is required.' });
  }

  try {
    const memberInfo = await getUserOrganization(req.user.id);
    if (memberInfo.role !== 'owner') {
      return res.status(403).json({ success: false, error: 'Only Organization Owners can change seat capacity.' });
    }

    await run("UPDATE organizations SET seat_limit = ? WHERE id = ?", [newLimit, memberInfo.org_id]);
    res.json({ success: true, message: `Seat capacity updated to ${newLimit} seats.`, seat_limit: newLimit });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update seat capacity.' });
  }
});

// ==========================================
// 7. Desktop Application License & Machine Locking Endpoints
// ==========================================
router.get('/license/machine-id', (req, res) => {
  try {
    const machineId = getMachineId();
    res.json({
      success: true,
      machineId
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to retrieve hardware machine ID.' });
  }
});

router.get('/license/status', async (req, res) => {
  try {
    const status = await getLicenseStatus();
    res.json({
      success: true,
      activated: status.activated,
      machineId: status.machineId,
      license: status.license,
      isGracePeriod: status.isGracePeriod,
      daysRemaining: status.daysRemaining,
      licenseDetails: status.license,
      error: status.error
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch license status.' });
  }
});

router.post('/license/activate', async (req, res) => {
  const { licenseKey } = req.body || {};
  if (!licenseKey || typeof licenseKey !== 'string') {
    return res.status(400).json({ success: false, error: 'License key is required.' });
  }

  try {
    const activation = await activateLicense(licenseKey);
    if (activation.success) {
      res.json({
        success: true,
        activated: true,
        message: activation.message,
        license: activation.license,
        isGracePeriod: activation.isGracePeriod,
        daysRemaining: activation.daysRemaining,
        machineId: activation.machineId
      });
    } else {
      res.status(400).json({
        success: false,
        activated: false,
        error: activation.error || 'License activation failed.'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: 'License activation failed: ' + error.message });
  }
});

// ==========================================
// 8. Admin Commercial License Management Endpoints
// ==========================================

// Generate a signed commercial license
router.post('/admin/licenses/generate', async (req, res) => {
  try {
    const { 
      clientName, 
      clientEmail, 
      machineId, 
      validityDays = 365, 
      sessionsLimit = 5,
      turboAllowed = true,
      multiSessionAllowed = true,
      notes = '' 
    } = req.body || {};

    if (!clientEmail || !machineId) {
      return res.status(400).json({ success: false, error: 'Client email and Machine ID are required.' });
    }

    const { createLicenseKey } = await import('./utils/licenseGenerator.js');
    const { run } = await import('./database.js');

    const days = parseInt(validityDays) || 365;
    const expiryDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const maxSessions = parseInt(sessionsLimit) || 5;

    const features = [
      'unlimited_campaigns',
      'anti_ban_warmup',
      'spintax_engine',
      'audience_hub_import'
    ];
    if (turboAllowed) features.push('turbo_mode_bypass');
    if (multiSessionAllowed) features.push('multi_device_sessions');

    const licenseKey = createLicenseKey({
      customer: clientName || clientEmail,
      client_name: clientName || clientEmail,
      nodeLockId: machineId.trim(),
      expiryDate,
      maxSessions,
      features,
      gracePeriodDays: 14
    });

    // Save to database table
    await run(`
      INSERT INTO issued_licenses (
        client_name, client_email, machine_id, license_key,
        plan_type, validity_days, sessions_limit, turbo_allowed,
        multi_session_allowed, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `, [
      clientName || clientEmail,
      clientEmail.trim(),
      machineId.trim(),
      licenseKey,
      days >= 3650 ? 'lifetime_commercial' : 'pro_commercial',
      days,
      maxSessions,
      turboAllowed ? 1 : 0,
      multiSessionAllowed ? 1 : 0,
      notes
    ]);

    res.json({
      success: true,
      licenseKey,
      clientName: clientName || clientEmail,
      clientEmail: clientEmail.trim(),
      machineId: machineId.trim(),
      validityDays: days,
      expiresAt: expiryDate,
      maxSessions,
      features
    });
  } catch (error) {
    console.error('Error generating admin license:', error);
    res.status(500).json({ success: false, error: 'Failed to generate license: ' + error.message });
  }
});

// Fetch all issued licenses
router.get('/admin/licenses/history', async (req, res) => {
  try {
    const { all } = await import('./database.js');
    const licenses = await all(`SELECT * FROM issued_licenses ORDER BY id DESC`);
    res.json({
      success: true,
      licenses: (licenses || []).map(lic => {
        const createdTime = new Date(lic.created_at).getTime();
        const expiryTime = createdTime + (lic.validity_days * 24 * 60 * 60 * 1000);
        const daysLeft = Math.max(0, Math.ceil((expiryTime - Date.now()) / (24 * 60 * 60 * 1000)));
        return {
          ...lic,
          expires_at: new Date(expiryTime).toISOString(),
          days_remaining: daysLeft,
          is_expired: daysLeft === 0
        };
      })
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Decode and inspect any license token
router.post('/admin/licenses/decode', async (req, res) => {
  try {
    const { licenseKey } = req.body || {};
    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({ success: false, error: 'License key is required.' });
    }

    const { verifyLicenseToken, fromBase64Url } = await import('./utils/licenseGenerator.js');
    const verification = verifyLicenseToken(licenseKey.trim());
    
    let payload = null;
    const parts = licenseKey.trim().split('.');
    if (parts.length === 3 && parts[0] === 'WALIC') {
      try {
        payload = JSON.parse(fromBase64Url(parts[1]).toString('utf8'));
      } catch (_e) {}
    }

    res.json({
      success: true,
      valid: verification.valid,
      reason: verification.reason,
      payload: payload || verification.payload
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Revoke a license
router.post('/admin/licenses/revoke', async (req, res) => {
  try {
    const { id, licenseKey } = req.body || {};
    const { run } = await import('./database.js');
    const now = new Date().toISOString();
    
    if (id) {
      await run(`UPDATE issued_licenses SET status = 'revoked', revoked_at = ? WHERE id = ?`, [now, id]);
    } else if (licenseKey) {
      await run(`UPDATE issued_licenses SET status = 'revoked', revoked_at = ? WHERE license_key = ?`, [now, licenseKey.trim()]);
    } else {
      return res.status(400).json({ success: false, error: 'License ID or key is required.' });
    }

    res.json({ success: true, message: 'License revoked successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reactivate a previously revoked license
router.post('/admin/licenses/reactivate', async (req, res) => {
  try {
    const { id, licenseKey } = req.body || {};
    const { run } = await import('./database.js');
    
    if (id) {
      await run(`UPDATE issued_licenses SET status = 'active', revoked_at = NULL WHERE id = ?`, [id]);
    } else if (licenseKey) {
      await run(`UPDATE issued_licenses SET status = 'active', revoked_at = NULL WHERE license_key = ?`, [licenseKey.trim()]);
    } else {
      return res.status(400).json({ success: false, error: 'License ID or key is required.' });
    }

    res.json({ success: true, message: 'License reactivated successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a license record
router.post('/admin/licenses/delete', async (req, res) => {
  try {
    const { id, licenseKey } = req.body || {};
    const { run } = await import('./database.js');
    
    if (id) {
      await run(`DELETE FROM issued_licenses WHERE id = ?`, [id]);
    } else if (licenseKey) {
      await run(`DELETE FROM issued_licenses WHERE license_key = ?`, [licenseKey.trim()]);
    } else {
      return res.status(400).json({ success: false, error: 'License ID or key is required.' });
    }

    res.json({ success: true, message: 'License record deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 9. Automated Self-Serve Checkout, Dynamic Store Config & Payment Webhooks
// ==========================================

export const DEFAULT_STORE_CONFIG = {
  brandName: 'WhatsApp Automator Pro',
  brandTagline: 'Commercial Desktop Automation Suite',
  supportEmail: 'support@rudraexpression.in',
  supportWhatsapp: '+919876543210',
  downloadUrl: 'https://github.com/ayushhbhuutada/whatsapp-automation/releases/download/v1.0.0/WhatsAppAutomationSetup.exe',
  razorpayKeyId: '',
  razorpayKeySecret: '',
  plans: [
    {
      id: 'starter',
      name: 'Starter Monthly',
      price: '₹999',
      priceInPaise: 99900,
      period: '/ month',
      badge: 'Starter',
      desc: 'Ideal for small businesses starting out with single-account outreach.',
      validityDays: 30,
      sessionsLimit: 1,
      turboAllowed: false,
      multiSessionAllowed: false,
      features: [
        '1 WhatsApp Profile',
        'Spintax Content Randomizer',
        'Anti-Ban Daily Warmup Engine',
        'Excel & Google Sheets Import',
        'Offline Local Database',
        'Standard Dispatch Speeds'
      ]
    },
    {
      id: 'pro',
      name: 'Pro Growth',
      price: '₹4,999',
      priceInPaise: 499900,
      period: '/ year',
      badge: '⭐ Most Popular',
      desc: 'High-speed multi-device automation for power users and growing teams.',
      validityDays: 365,
      sessionsLimit: 5,
      turboAllowed: true,
      multiSessionAllowed: true,
      popular: true,
      features: [
        '5 WhatsApp Profiles in Parallel',
        'Multi-Device Auto-Split Load Balancing',
        '6 Advanced Anti-Ban Systems',
        'Engagement Circuit Breaker',
        'Turbo Mode Bypass Control',
        '1 Year Full Updates & Support'
      ]
    },
    {
      id: 'agency',
      name: 'Agency VIP',
      price: '₹14,999',
      priceInPaise: 1499900,
      period: 'Lifetime Access',
      badge: '👑 Lifetime VIP',
      desc: 'Enterprise capabilities for agencies handling high-volume client broadcasting.',
      validityDays: 3650,
      sessionsLimit: 20,
      turboAllowed: true,
      multiSessionAllowed: true,
      features: [
        '20 WhatsApp Profiles Concurrently',
        'Multi-Device Auto-Split Load Balancing',
        'All 6 Anti-Ban Systems & Fingerprinting',
        'Unlimited Campaigns & Contacts',
        'Lifetime Offline Commercial License',
        'Team Seats & Multi-User Access'
      ]
    }
  ]
};

export async function getStoreConfig() {
  try {
    const { get } = await import('./database.js');
    const row = await get("SELECT value FROM settings WHERE key = 'store_config'");
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      return {
        ...DEFAULT_STORE_CONFIG,
        ...parsed,
        plans: Array.isArray(parsed.plans) && parsed.plans.length > 0 ? parsed.plans : DEFAULT_STORE_CONFIG.plans
      };
    }
  } catch (e) {
    console.warn('Could not load store config from DB:', e.message);
  }
  return DEFAULT_STORE_CONFIG;
}

// Public Store Config (for Landing page & checkout)
router.get('/config/public', async (_req, res) => {
  try {
    const config = await getStoreConfig();
    res.json({
      success: true,
      brandName: config.brandName,
      brandTagline: config.brandTagline,
      supportEmail: config.supportEmail,
      supportWhatsapp: config.supportWhatsapp,
      downloadUrl: config.downloadUrl,
      razorpayKeyId: config.razorpayKeyId || process.env.RAZORPAY_KEY_ID || '',
      plans: config.plans
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin Store Config (Full access for settings panel)
router.get('/admin/config', async (_req, res) => {
  try {
    const config = await getStoreConfig();
    res.json({
      success: true,
      config
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin Update Store Config (Save modified plans, prices, branding, download links)
router.post('/admin/config/update', async (req, res) => {
  try {
    const { config } = req.body || {};
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ success: false, error: 'Valid config object is required.' });
    }

    const { run } = await import('./database.js');
    const jsonStr = JSON.stringify(config);
    await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (1, 'store_config', ?)", [jsonStr]);

    res.json({
      success: true,
      message: 'Store & Pricing configuration updated successfully.',
      config
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create Checkout Order for Commercial License
router.post('/checkout/create-license-order', async (req, res) => {
  const { planId = 'pro', customerName = '', customerEmail = '', machineId = '*' } = req.body || {};
  const storeConfig = await getStoreConfig();
  const plan = (storeConfig.plans || []).find(p => p.id === planId) || storeConfig.plans[1] || DEFAULT_STORE_CONFIG.plans[1];

  if (!customerEmail) {
    return res.status(400).json({ success: false, error: 'Customer email is required for license delivery.' });
  }

  try {
    const keyId = storeConfig.razorpayKeyId || process.env.RAZORPAY_KEY_ID;
    const isMock = !keyId || keyId === 'rzp_test_mock_key_id' || keyId === 'rzp_test_change_me';

    if (isMock) {
      return res.json({
        success: true,
        mock: true,
        orderId: `lic_mock_${Date.now()}`,
        amount: plan.priceInPaise,
        currency: 'INR',
        planId,
        planName: plan.name,
        key: 'rzp_test_mock_key_id',
        customer: { name: customerName || 'Customer', email: customerEmail }
      });
    }

    const order = await razorpay.orders.create({
      amount: plan.priceInPaise,
      currency: 'INR',
      receipt: `lic_rcpt_${Date.now()}`,
      notes: {
        planId,
        customerName: customerName || customerEmail,
        customerEmail,
        machineId: machineId || '*'
      }
    });

    res.json({
      success: true,
      mock: false,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planId,
      planName: plan.name,
      key: keyId,
      customer: { name: customerName, email: customerEmail }
    });
  } catch (error) {
    console.error('Checkout order creation error:', error);
    res.status(500).json({ success: false, error: 'Failed to create checkout order: ' + error.message });
  }
});

// Verify Payment & Auto-Issue License Key On-Screen
router.post('/checkout/verify-license-payment', async (req, res) => {
  const { 
    razorpay_order_id, 
    razorpay_payment_id, 
    razorpay_signature, 
    planId = 'pro', 
    customerName = 'Customer', 
    customerEmail = '', 
    machineId = '*' 
  } = req.body || {};

  if (!customerEmail) {
    return res.status(400).json({ success: false, error: 'Customer email is required.' });
  }

  const storeConfig = await getStoreConfig();
  const plan = (storeConfig.plans || []).find(p => p.id === planId) || storeConfig.plans[1] || DEFAULT_STORE_CONFIG.plans[1];

  try {
    const keySecret = storeConfig.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET;
    const isMock = !keySecret || keySecret === 'rzp_test_mock_key_secret' || keySecret === 'rzp_secret_change_me';

    if (!isMock) {
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ success: false, error: 'Missing payment signature parameters.' });
      }

      const generatedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (generatedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, error: 'Payment signature verification failed.' });
      }
    }

    const { createLicenseKey } = await import('./utils/licenseGenerator.js');
    const { run } = await import('./database.js');

    const expiryDate = new Date(Date.now() + plan.validityDays * 24 * 60 * 60 * 1000).toISOString();
    const features = [
      'unlimited_campaigns',
      'anti_ban_warmup',
      'spintax_engine',
      'audience_hub_import'
    ];
    if (plan.turboAllowed) features.push('turbo_mode_bypass');
    if (plan.multiSessionAllowed) features.push('multi_device_sessions');

    const licenseKey = createLicenseKey({
      customer: customerName || customerEmail,
      client_name: customerName || customerEmail,
      nodeLockId: (machineId && machineId.trim()) || '*',
      expiryDate,
      maxSessions: plan.sessionsLimit,
      features,
      gracePeriodDays: 14
    });

    // Persist in issued_licenses
    await run(`
      INSERT INTO issued_licenses (
        client_name, client_email, machine_id, license_key,
        plan_type, validity_days, sessions_limit, turbo_allowed,
        multi_session_allowed, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `, [
      customerName || customerEmail,
      customerEmail.trim(),
      (machineId && machineId.trim()) || '*',
      licenseKey,
      planId,
      plan.validityDays,
      plan.sessionsLimit,
      plan.turboAllowed ? 1 : 0,
      plan.multiSessionAllowed ? 1 : 0,
      `Auto-Issued via Online Checkout (${razorpay_payment_id || 'mock_pay'})`
    ]);

    res.json({
      success: true,
      licenseKey,
      planName: plan.name,
      customerName: customerName || customerEmail,
      customerEmail: customerEmail.trim(),
      machineId: (machineId && machineId.trim()) || '*',
      validityDays: plan.validityDays,
      expiresAt: expiryDate,
      sessionsLimit: plan.sessionsLimit,
      downloadUrl: storeConfig.downloadUrl || DEFAULT_STORE_CONFIG.downloadUrl
    });
  } catch (error) {
    console.error('License payment verification error:', error);
    res.status(500).json({ success: false, error: 'License issue failed: ' + error.message });
  }
});

// Automated Inbound Webhook (Razorpay / Stripe / Generic)
router.post('/webhooks/payment', async (req, res) => {
  try {
    const event = req.body?.event || req.body?.type || 'payment.captured';
    const payload = req.body?.payload?.payment?.entity || req.body?.data?.object || req.body;
    
    const email = payload.email || payload.customer_email || payload.notes?.customerEmail || 'customer@automated.license';
    const name = payload.notes?.customerName || payload.name || 'Automated Customer';
    const planId = payload.notes?.planId || 'pro';
    
    const storeConfig = await getStoreConfig();
    const plan = (storeConfig.plans || []).find(p => p.id === planId) || storeConfig.plans[1] || DEFAULT_STORE_CONFIG.plans[1];

    const { createLicenseKey } = await import('./utils/licenseGenerator.js');
    const { run } = await import('./database.js');

    const expiryDate = new Date(Date.now() + plan.validityDays * 24 * 60 * 60 * 1000).toISOString();
    const features = [
      'unlimited_campaigns',
      'anti_ban_warmup',
      'spintax_engine',
      'audience_hub_import'
    ];
    if (plan.turboAllowed) features.push('turbo_mode_bypass');
    if (plan.multiSessionAllowed) features.push('multi_device_sessions');

    const licenseKey = createLicenseKey({
      customer: name,
      client_name: name,
      nodeLockId: payload.notes?.machineId || '*',
      expiryDate,
      maxSessions: plan.sessionsLimit,
      features,
      gracePeriodDays: 14
    });

    await run(`
      INSERT INTO issued_licenses (
        client_name, client_email, machine_id, license_key,
        plan_type, validity_days, sessions_limit, turbo_allowed,
        multi_session_allowed, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `, [
      name,
      email,
      payload.notes?.machineId || '*',
      licenseKey,
      planId,
      plan.validityDays,
      plan.sessionsLimit,
      plan.turboAllowed ? 1 : 0,
      plan.multiSessionAllowed ? 1 : 0,
      `Webhook Event: ${event} (ID: ${payload.id || Date.now()})`
    ]);

    console.log(`[Webhook] Auto-issued commercial license key for ${email} (${plan.name})`);

    res.json({
      success: true,
      event,
      licenseKey,
      issuedTo: email
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// AUTO-UPDATE SYSTEM ENDPOINTS (GitHub & Vercel)
// ============================================================

// 1. Check for available updates
router.get('/updates/check', async (req, res) => {
  try {
    const settingsRows = await all('SELECT key, value FROM settings WHERE key IN (?, ?, ?)', [
      'update_source_type', 'github_repo', 'vercel_update_url'
    ]);
    const config = {};
    settingsRows.forEach(r => { config[r.key] = r.value; });

    const sourceType = req.query.source || config.update_source_type || 'github';
    const githubRepo = req.query.repo || config.github_repo || 'ayushhbhuutada/whatsapp-automation';
    const vercelUrl = req.query.vercelUrl || config.vercel_update_url || '';

    const updateInfo = await checkForUpdates({
      sourceType,
      githubRepo,
      vercelUrl
    });

    res.json({
      success: true,
      ...updateInfo
    });
  } catch (error) {
    console.error('[Updates] Check error:', error);
    res.status(500).json({
      success: false,
      updateAvailable: false,
      error: error.message
    });
  }
});

// 2. Start downloading update
router.post('/updates/download', async (req, res) => {
  try {
    const { downloadUrl, version = 'latest' } = req.body;
    if (!downloadUrl) {
      return res.status(400).json({ success: false, error: 'downloadUrl is required.' });
    }

    // Start download asynchronously in background
    downloadUpdate(downloadUrl, version)
      .then((result) => {
        console.log('[Updates] Download completed:', result);
      })
      .catch((err) => {
        console.error('[Updates] Download error:', err.message);
      });

    res.json({
      success: true,
      message: 'Update download started in background.',
      status: getDownloadState()
    });
  } catch (error) {
    console.error('[Updates] Download initiate error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Get live download progress
router.get('/updates/progress', (req, res) => {
  res.json({
    success: true,
    progress: getDownloadState()
  });
});

// 4. Trigger update installation & app restart
router.post('/updates/install', (req, res) => {
  try {
    const { installerPath } = req.body;
    const result = applyUpdateAndRestart(installerPath);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Updates] Install error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Get & Save update configuration
router.get('/updates/config', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)', [
      'check_updates_on_startup', 'update_source_type', 'github_repo', 'vercel_update_url'
    ]);
    const config = {
      check_updates_on_startup: 'true',
      update_source_type: 'github',
      github_repo: 'ayushhbhuutada/whatsapp-automation',
      vercel_update_url: ''
    };
    rows.forEach(r => { config[r.key] = r.value; });
    res.json({ success: true, config, currentVersion: autoUpdateService.currentAppVersion });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/updates/config', async (req, res) => {
  try {
    const {
      check_updates_on_startup,
      update_source_type,
      github_repo,
      vercel_update_url
    } = req.body;

    const updates = [
      ['check_updates_on_startup', check_updates_on_startup !== undefined ? String(check_updates_on_startup) : undefined],
      ['update_source_type', update_source_type],
      ['github_repo', github_repo],
      ['vercel_update_url', vercel_update_url]
    ].filter(([_, v]) => v !== undefined);

    for (const [k, v] of updates) {
      await run('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (1, ?, ?)', [k, v]);
    }

    res.json({ success: true, message: 'Update settings saved successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;


