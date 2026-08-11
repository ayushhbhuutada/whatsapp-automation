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
  // 0. Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      max_login_sessions INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 1. Campaigns Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Pending', 'Sending', 'Completed', 'Paused', 'Stopped')),
      total_contacts INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 2. Contacts Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
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
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    )
  `);

  // 3. Settings Table (user-scoped)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER DEFAULT 1,
      key TEXT,
      value TEXT,
      PRIMARY KEY (user_id, key)
    )
  `);

  // 4. Logs Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      campaign_id INTEGER,
      contact_id INTEGER,
      level TEXT,
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 5. Saved Contacts (Audience Hub) Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      company TEXT,
      email TEXT,
      tag TEXT DEFAULT 'General',
      placeholder_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 6. WhatsApp Sessions (Multi-Account) Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_name TEXT NOT NULL,
      phone_number TEXT DEFAULT '',
      status TEXT DEFAULT 'Disconnected',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 7. Token Blacklist Table for JWT Revocation
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_blacklist (
      token TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrations for existing database files (add user_id column if missing)
  const addColumnSafely = (table, columnDef) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    } catch (e) {
      // Column likely exists
    }
  };

  addColumnSafely('users', 'stripe_customer_id TEXT DEFAULT ""');
  addColumnSafely('users', 'subscription_status TEXT DEFAULT "active"');
  addColumnSafely('settings', 'user_id INTEGER DEFAULT 1');
  addColumnSafely('campaigns', 'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
  addColumnSafely('contacts', 'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
  addColumnSafely('logs', 'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
  addColumnSafely('saved_contacts', 'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');

  // Initialize Default Settings
  const defaultSettings = [
    { key: 'delay_seconds', value: '5' },
    { key: 'max_retries', value: '2' },
    { key: 'theme', value: 'dark' },
    { key: 'default_attachments_dir', value: path.resolve(__dirname, '../attachments') },
    { key: 'google_sheet_url', value: '' },
    { key: 'enable_notifications', value: 'true' },
    { key: 'default_country_code', value: '91' },
    { key: 'headless', value: 'false' },
    { key: 'keep_browser_open_after_campaign', value: 'true' }
  ];

  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (user_id, key, value) VALUES (?, ?, ?)`);
  for (const setting of defaultSettings) {
    insertSetting.run(1, setting.key, setting.value);
  }

  console.log('Database initialized successfully with multi-tenant user support.');
}

initDb();

export default db;
