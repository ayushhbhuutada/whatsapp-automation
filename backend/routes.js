import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { run, get, all } from './database.js';
import { parseSpreadsheet, parseRawTextContacts } from './services/excelParser.js';
import { fetchGoogleSheet } from './services/googleSheets.js';
import runner from './services/automationRunner.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_test_mock_key_secret'
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp-saas-secret-key-2026';

// Middleware to verify JWT Token (Strict - No User 1 Fallback)
export const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const blacklisted = await get('SELECT token FROM token_blacklist WHERE token = ?', [token]);
    if (blacklisted) {
      return res.status(401).json({ error: 'Unauthorized: Token has been revoked.' });
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await get('SELECT id, name, email, max_login_sessions FROM users WHERE id = ?', [decoded.userId]);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: User account not found' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

// Apply authMiddleware to all API routes except public auth endpoints
router.use((req, res, next) => {
  if (req.path.startsWith('/auth/')) {
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
const uploadsDir = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) and CSV (.csv) files are supported.'));
    }
  }
});

// Helper: compiles dynamic message template using placeholders safely
function compileTemplate(template, placeholders) {
  let message = template;
  Object.entries(placeholders).forEach(([key, val]) => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`{{\\s*${escapedKey}\\s*}}`, 'gi');
    message = message.replace(regex, val !== undefined && val !== null ? String(val) : '');
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
    for (const [key, value] of Object.entries(settings)) {
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

    const hasPlus = phone ? phone.trim().startsWith('+') : existing.phone.startsWith('+');
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
  const { name, template = '', source, sheetUrl, tag, rawText, attachmentPath } = req.body;
  const cleanAttachment = attachmentPath ? String(attachmentPath).trim().replace(/^["']+|["']+$|^\s*["']|["']\s*$/g, '').trim() : '';

  // Collect uploaded attachment files if present
  let uploadedAttachmentsStr = '';
  if (req.files && req.files['attachments'] && req.files['attachments'].length > 0) {
    uploadedAttachmentsStr = req.files['attachments'].map(f => f.filename).join(', ');
  }

  const combinedAttachment = [cleanAttachment, uploadedAttachmentsStr].filter(Boolean).join(', ');

  if (!name) {
    return res.status(400).json({ error: 'Campaign name is required.' });
  }

  let contacts = [];

  try {
    if (source === 'group') {
      if (!tag) {
        return res.status(400).json({ error: 'Please select a contact group/tag.' });
      }
      const rows = await all('SELECT * FROM saved_contacts WHERE user_id = ? AND tag = ?', [req.user.id, tag]);
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
      const rows = await all('SELECT * FROM saved_contacts WHERE user_id = ?', [req.user.id]);
      contacts = rows.map((r, idx) => ({
        name: r.name,
        phone: r.phone,
        company: r.company || '',
        message: '',
        attachment: combinedAttachment || '',
        placeholderData: r.placeholder_data ? JSON.parse(r.placeholder_data) : { name: r.name, phone: r.phone, company: r.company },
        rowIndex: idx + 1
      }));
    } else if (source === 'raw_text') {
      if (!rawText || !rawText.trim()) {
        return res.status(400).json({ error: 'Please enter phone numbers or CSV text.' });
      }
      contacts = parseRawTextContacts(rawText);
    } else if (source === 'sheet') {
      if (!sheetUrl) {
        return res.status(400).json({ error: 'Please provide a Google Sheets URL.' });
      }
      contacts = await fetchGoogleSheet(sheetUrl);
      await run("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, 'google_sheet_url', ?)", [req.user.id, sheetUrl]);
    } else if (source === 'file') {
      const excelFile = req.file || (req.files && req.files['file'] && req.files['file'][0]);
      if (!excelFile) {
        return res.status(400).json({ error: 'Please upload a spreadsheet file.' });
      }
      contacts = parseSpreadsheet(excelFile.path);
      fs.unlink(excelFile.path, () => {});
    } else {
      return res.status(400).json({ error: 'Invalid contact source selected.' });
    }

    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No recipients found in selected source.' });
    }

    const campaignResult = await run(`
      INSERT INTO campaigns (user_id, name, status, total_contacts, sent_count, failed_count)
      VALUES (?, ?, 'Pending', ?, 0, 0)
    `, [req.user.id, name.trim(), contacts.length]);

    const campaignId = campaignResult.id;

    for (const contact of contacts) {
      let compiledMsg = '';
      if (!template.trim() || template.trim() === '{{Message}}') {
        compiledMsg = contact.message || '';
      } else {
        compiledMsg = compileTemplate(template, contact.placeholderData || { name: contact.name, phone: contact.phone });
      }
      
      const rawContactAttach = contact.attachment ? String(contact.attachment).trim().replace(/^["']+|["']+$|^\s*["']|["']\s*$/g, '').trim() : '';
      const finalAttachment = [rawContactAttach, combinedAttachment].filter(Boolean).join(', ');

      await run(`
        INSERT INTO contacts (user_id, campaign_id, name, phone, company, message_template, placeholder_data, attachment_path, status, row_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
      `, [
        req.user.id,
        campaignId,
        contact.name,
        contact.phone,
        contact.company || '',
        compiledMsg,
        JSON.stringify(contact.placeholderData || {}),
        finalAttachment,
        contact.rowIndex || null
      ]);
    }

    res.json({ 
      message: 'Campaign created successfully.',
      campaignId,
      totalContacts: contacts.length
    });

  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Failed to create campaign.' });
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
  let sql = 'SELECT * FROM logs WHERE user_id = ?';
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
  const pricePerSeatInPaise = 99900; // ₹999.00 per month per login ID

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
    let sessions = await all('SELECT * FROM whatsapp_sessions WHERE user_id = ? ORDER BY id ASC', [req.user.id]);
    if (sessions.length === 0) {
      await run(`
        INSERT INTO whatsapp_sessions (user_id, session_name, status)
        VALUES (?, 'Primary WhatsApp Account', 'Disconnected')
      `, [req.user.id]);
      sessions = await all('SELECT * FROM whatsapp_sessions WHERE user_id = ? ORDER BY id ASC', [req.user.id]);
    }

    const currentLiveSession = await runner.checkSession();

    const mapped = sessions.map((s, index) => {
      if (index === 0) {
        return {
          ...s,
          connected: currentLiveSession.connected,
          status: currentLiveSession.connected ? 'Connected' : (currentLiveSession.qrImageUrl ? 'Scan QR Required' : 'Disconnected'),
          qrImageUrl: currentLiveSession.qrImageUrl
        };
      }
      return { ...s, connected: false, qrImageUrl: null };
    });

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
        error: `Seat limit reached (${existing.length}/${maxSeats} seats used). Upgrade your seats to add more login IDs.`
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
    const existing = await get('SELECT id FROM whatsapp_sessions WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Session profile not found or unauthorized.' });
    }

    await run('DELETE FROM whatsapp_sessions WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ message: 'WhatsApp session profile deleted.' });
  } catch (error) {
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
    const quota = await checkSeatQuota(req.user.id);
    const session = await runner.checkSession();
    if (!session.connected && !quota.allowed) {
      return res.status(403).json({
        error: `Seat quota limit reached (${quota.activeCount}/${quota.maxSeats} active seats). Please upgrade your subscription plan.`
      });
    }
    const result = await runner.connectSession();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to connect WhatsApp session.' });
  }
});

router.post('/automation/logout', async (req, res) => {
  try {
    await runner.logoutSession();
    res.json({ message: 'WhatsApp session logged out successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to logout WhatsApp session.' });
  }
});

export default router;
