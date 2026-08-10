import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(__dirname, process.env.DATABASE_PATH)
  : path.resolve(__dirname, '../database/db.sqlite');

// Ensure database directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Ensure default attachments directory exists in root
const attachmentsDir = path.resolve(__dirname, '../attachments');
if (!fs.existsSync(attachmentsDir)) {
  fs.mkdirSync(attachmentsDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);
console.log('Connected to the SQLite database at:', dbPath);

// Enable WAL mode and foreign keys
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Promise-based wrappers (API-compatible with old sqlite3 wrappers)
export const run = (sql, params = []) => {
  try {
    const stmt = db.prepare(sql);
    const result = stmt.run(...params);
    return Promise.resolve({ id: result.lastInsertRowid, changes: result.changes });
  } catch (err) {
    return Promise.reject(err);
  }
};

export const get = (sql, params = []) => {
  try {
    const stmt = db.prepare(sql);
    const row = stmt.get(...params);
    return Promise.resolve(row);
  } catch (err) {
    return Promise.reject(err);
  }
};

export const all = (sql, params = []) => {
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    return Promise.resolve(rows);
  } catch (err) {
    return Promise.reject(err);
  }
};

function initDb() {
  // 1. Campaigns Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Pending', 'Sending', 'Completed', 'Paused', 'Stopped')),
      total_contacts INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Contacts Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      company TEXT,
      message_template TEXT,
      placeholder_data TEXT,
      attachment_path TEXT,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Sending', 'Sent', 'Failed', 'Skipped')),
      error_reason TEXT,
      sent_at TEXT,
      row_index INTEGER,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    )
  `);

  // 3. Settings Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // 4. Logs Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      contact_id INTEGER,
      level TEXT,
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 5. Saved Contacts (Audience Hub) Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      company TEXT,
      email TEXT,
      tag TEXT DEFAULT 'General',
      placeholder_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Initialize Default Settings
  const defaultSettings = [
    { key: 'delay_seconds', value: '5' },
    { key: 'max_retries', value: '2' },
    { key: 'theme', value: 'dark' },
    { key: 'default_attachments_dir', value: path.resolve(__dirname, '../attachments') },
    { key: 'google_sheet_url', value: '' },
    { key: 'enable_notifications', value: 'true' },
    { key: 'default_country_code', value: '91' },
    { key: 'headless', value: 'false' }
  ];

  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const setting of defaultSettings) {
    insertSetting.run(setting.key, setting.value);
  }

  console.log('Database initialized successfully.');
}

initDb();

export default db;
