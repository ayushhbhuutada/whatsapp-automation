import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { run, get, all } from './database.js';
import { parseSpreadsheet, parseRawTextContacts } from './services/excelParser.js';
import { fetchGoogleSheet } from './services/googleSheets.js';
import runner from './services/automationRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Multer setup for handling file uploads (xlsx, xls, csv)
const uploadsDir = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) and CSV (.csv) files are supported.'));
    }
  }
});

// Helper: compiles dynamic message template using placeholders
function compileTemplate(template, placeholders) {
  let message = template;
  Object.entries(placeholders).forEach(([key, val]) => {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
    message = message.replace(regex, val);
  });
  return message;
}

// ==========================================
// 1. Settings Routes
// ==========================================
router.get('/settings', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM settings');
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/settings', async (req, res) => {
  const settings = req.body;
  try {
    for (const [key, value] of Object.entries(settings)) {
      await run(`
        INSERT OR REPLACE INTO settings (key, value)
        VALUES (?, ?)
      `, [key, String(value)]);
    }
    res.json({ message: 'Settings saved successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 1.5 Audience & Address Book Routes
// ==========================================
router.get('/audience/contacts', async (req, res) => {
  const { search, tag } = req.query;
  let sql = 'SELECT * FROM saved_contacts WHERE 1=1';
  const params = [];

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
    res.status(500).json({ error: error.message });
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
          INSERT INTO saved_contacts (name, phone, company, email, tag, placeholder_data)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
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
      INSERT INTO saved_contacts (name, phone, company, email, tag, placeholder_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      name.trim(),
      finalPhone,
      company ? company.trim() : '',
      email ? email.trim() : '',
      tag ? tag.trim() : 'General',
      JSON.stringify(custom_data || { name, phone: finalPhone, company, email })
    ]);

    res.json({ message: 'Contact saved successfully.', id: result.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/audience/contacts/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, company, email, tag, custom_data } = req.body;

  try {
    const existing = await get('SELECT * FROM saved_contacts WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Contact not found.' });
    }

    const hasPlus = phone ? phone.trim().startsWith('+') : existing.phone.startsWith('+');
    const cleanPhone = phone ? phone.trim().replace(/\D/g, '') : existing.phone;
    const finalPhone = phone ? (hasPlus ? '+' + cleanPhone : cleanPhone) : existing.phone;

    await run(`
      UPDATE saved_contacts
      SET name = ?, phone = ?, company = ?, email = ?, tag = ?, placeholder_data = ?
      WHERE id = ?
    `, [
      name !== undefined ? name.trim() : existing.name,
      finalPhone,
      company !== undefined ? company.trim() : existing.company,
      email !== undefined ? email.trim() : existing.email,
      tag !== undefined ? tag.trim() : existing.tag,
      JSON.stringify(custom_data || { name, phone: finalPhone, company, email }),
      id
    ]);

    res.json({ message: 'Contact updated successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/audience/contacts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await run('DELETE FROM saved_contacts WHERE id = ?', [id]);
    res.json({ message: 'Contact deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/audience/tags', async (req, res) => {
  try {
    const rows = await all("SELECT DISTINCT tag FROM saved_contacts WHERE tag IS NOT NULL AND tag != '' ORDER BY tag ASC");
    const tags = rows.map(r => r.tag);
    res.json(tags);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
        INSERT INTO saved_contacts (name, phone, company, tag, placeholder_data)
        VALUES (?, ?, ?, ?, ?)
      `, [
        c.name,
        c.phone,
        c.company || '',
        tag,
        JSON.stringify(c.placeholderData || { name: c.name, phone: c.phone, company: c.company })
      ]);
      count++;
    }
    await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_sheet_url', ?)", [sheetUrl]);
    res.json({ message: `Successfully imported ${count} contacts from Google Sheet into tag "${tag}".`, count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. Campaign Routes
// ==========================================
router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await all('SELECT * FROM campaigns ORDER BY created_at DESC');
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/campaigns', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
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

  if (!name) {
    return res.status(400).json({ error: 'Campaign name is required.' });
  }

  let contacts = [];

  try {
    if (source === 'group') {
      if (!tag) {
        return res.status(400).json({ error: 'Please select a contact group/tag.' });
      }
      const rows = await all('SELECT * FROM saved_contacts WHERE tag = ?', [tag]);
      contacts = rows.map((r, idx) => ({
        name: r.name,
        phone: r.phone,
        company: r.company || '',
        message: '',
        attachment: cleanAttachment || '',
        placeholderData: r.placeholder_data ? JSON.parse(r.placeholder_data) : { name: r.name, phone: r.phone, company: r.company },
        rowIndex: idx + 1
      }));
    } else if (source === 'all_saved') {
      const rows = await all('SELECT * FROM saved_contacts');
      contacts = rows.map((r, idx) => ({
        name: r.name,
        phone: r.phone,
        company: r.company || '',
        message: '',
        attachment: cleanAttachment || '',
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
      await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_sheet_url', ?)", [sheetUrl]);
    } else if (source === 'file') {
      if (!req.file) {
        return res.status(400).json({ error: 'Please upload a spreadsheet file.' });
      }
      contacts = parseSpreadsheet(req.file.path);
      fs.unlink(req.file.path, () => {});
    } else {
      return res.status(400).json({ error: 'Invalid contact source selected.' });
    }

    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No recipients found in selected source.' });
    }

    const campaignResult = await run(`
      INSERT INTO campaigns (name, status, total_contacts, sent_count, failed_count)
      VALUES (?, 'Pending', ?, 0, 0)
    `, [name, contacts.length]);

    const campaignId = campaignResult.id;

    for (const contact of contacts) {
      let compiledMsg = '';
      if (!template.trim() || template.trim() === '{{Message}}') {
        compiledMsg = contact.message || '';
      } else {
        compiledMsg = compileTemplate(template, contact.placeholderData || { name: contact.name, phone: contact.phone });
      }
      
      const rawContactAttach = contact.attachment ? String(contact.attachment).trim().replace(/^["']+|["']+$|^\s*["']|["']\s*$/g, '').trim() : '';
      const finalAttachment = rawContactAttach || cleanAttachment || '';

      await run(`
        INSERT INTO contacts (campaign_id, name, phone, company, message_template, placeholder_data, attachment_path, status, row_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
      `, [
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
    res.status(500).json({ error: error.message });
  }
});


router.delete('/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // If currently running, cleanup first
    const status = runner.getStatus();
    if (status.currentCampaignId === parseInt(id)) {
      await runner.stopCampaign(parseInt(id));
    }
    await run('DELETE FROM campaigns WHERE id = ?', [id]);
    await run('DELETE FROM contacts WHERE campaign_id = ?', [id]);
    await run('DELETE FROM logs WHERE campaign_id = ?', [id]);
    res.json({ message: 'Campaign deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 3. Contacts Routes (Filters & Search)
// ==========================================
router.get('/contacts', async (req, res) => {
  const { campaignId, search, status } = req.query;
  let sql = 'SELECT * FROM contacts WHERE 1=1';
  const params = [];

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
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 4. Logs Routes
// ==========================================
router.get('/logs', async (req, res) => {
  const { campaignId } = req.query;
  let sql = 'SELECT * FROM logs';
  const params = [];

  if (campaignId) {
    sql += ' WHERE campaign_id = ?';
    params.push(campaignId);
  }

  sql += ' ORDER BY id DESC LIMIT 200';

  try {
    const logs = await all(sql, params);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 5. Automation Control Routes
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
    res.status(500).json({ error: error.message });
  }
});

router.get('/automation/session', async (req, res) => {
  try {
    const session = await runner.checkSession();
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/automation/session/connect', async (req, res) => {
  try {
    const session = await runner.connectSession();
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/automation/logout', async (req, res) => {
  try {
    await runner.logoutSession();
    res.json({ message: 'WhatsApp session logged out and cleared successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
