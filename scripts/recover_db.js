import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

const oldPath = path.resolve('database/db.sqlite');
const backupPath = path.resolve('database/db.sqlite.corrupt.bak');
const tempPath = path.resolve('database/db_recovered.sqlite');

if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

try {
  const oldDb = new DatabaseSync(oldPath);
  const newDb = new DatabaseSync(tempPath);
  newDb.exec('PRAGMA foreign_keys = OFF');

  // Initialize schema on newDb
  newDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      max_login_sessions INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      stripe_customer_id TEXT DEFAULT '',
      subscription_status TEXT DEFAULT 'active'
    );
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
    );
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
    );
    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER DEFAULT 1,
      key TEXT,
      value TEXT,
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      campaign_id INTEGER,
      contact_id INTEGER,
      level TEXT,
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
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
    );
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_name TEXT NOT NULL,
      phone_number TEXT DEFAULT '',
      status TEXT DEFAULT 'Disconnected',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS token_blacklist (
      token TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const tables = ['users', 'campaigns', 'contacts', 'logs', 'saved_contacts', 'whatsapp_sessions', 'token_blacklist'];

  for (const table of tables) {
    try {
      const rows = oldDb.prepare('SELECT * FROM ' + table).all();
      if (rows && rows.length > 0) {
        for (const row of rows) {
          const keys = Object.keys(row);
          const placeholders = keys.map(() => '?').join(', ');
          const sql = `INSERT OR IGNORE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
          newDb.prepare(sql).run(...Object.values(row));
        }
        console.log(`Successfully recovered ${rows.length} rows from ${table}`);
      }
    } catch (err) {
      console.error(`Failed to recover table ${table}:`, err.message);
    }
  }

  oldDb.close();
  newDb.close();

  if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  fs.renameSync(oldPath, backupPath);
  fs.renameSync(tempPath, oldPath);

  ['database/db.sqlite-wal', 'database/db.sqlite-shm'].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });

  console.log('Database recovery completed successfully!');
} catch (e) {
  console.error('Fatal recovery error:', e);
}
