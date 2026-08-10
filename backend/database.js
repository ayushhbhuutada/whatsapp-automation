import sqlite3 from 'sqlite3';
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

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to the SQLite database at:', dbPath);
    initDb();
  }
});

// Promise-based wrappers
export const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

export const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

function initDb() {
  db.serialize(async () => {
    // Enable Foreign Key support in SQLite
    await run('PRAGMA foreign_keys = ON;');

    // 1. Campaigns Table
    await run(`
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
    await run(`
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
    await run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // 4. Logs Table
    await run(`
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
    await run(`
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

    for (const setting of defaultSettings) {
      await run(`
        INSERT OR IGNORE INTO settings (key, value)
        VALUES (?, ?)
      `, [setting.key, setting.value]);
    }

    console.log('Database initialized successfully.');
  });
}

export default db;
