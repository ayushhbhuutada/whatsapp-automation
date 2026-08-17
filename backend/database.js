import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDatabasePath } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = getDatabasePath();
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

console.log(`Connected to the SQLite database at: ${dbPath}`);

export const run = (sql, params = []) => {
  try {
    const stmt = db.prepare(sql);
    const info = stmt.run(...params);
    return Promise.resolve({ id: Number(info.lastInsertRowid), changes: info.changes });
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
      max_login_sessions INTEGER DEFAULT 10,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    INSERT OR IGNORE INTO users (id, name, email, password_hash, max_login_sessions)
    VALUES (1, 'Admin User', 'admin@local.host', 'default_hash', 10)
  `);

  // 1. Campaigns Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Pending', 'Sending', 'Completed', 'Paused', 'Stopped', 'Scheduled', 'Draft')),
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

  // 8. Daily Send Tracker (Anti-Ban Warmup) Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_send_tracker (
      user_id INTEGER DEFAULT 1,
      date_str TEXT,
      date TEXT,
      sent_count INTEGER DEFAULT 0,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, date_str)
    )
  `);

  // 9. Blacklisted Numbers (Opt-out Tracker) Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS blacklisted_numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 1,
      phone TEXT NOT NULL,
      number TEXT,
      reason TEXT DEFAULT 'Opt-out',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_blacklisted_user_phone ON blacklisted_numbers(user_id, phone)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_campaign_status ON contacts(campaign_id, status)`);
  } catch (e) {}

  // 10. Number Reputation Tracking (Anti-Ban System 5)
  db.exec(`
    CREATE TABLE IF NOT EXISTS number_reputation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_name TEXT NOT NULL,
      restriction_count INTEGER DEFAULT 0,
      last_restricted_at TEXT,
      cooldown_until TEXT,
      trust_score INTEGER DEFAULT 100,
      total_sent INTEGER DEFAULT 0,
      total_reported INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, session_name)
    )
  `);

  // 11. Engagement Tracking (Anti-Ban System 1)
  db.exec(`
    CREATE TABLE IF NOT EXISTS engagement_tracker (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      campaign_id INTEGER,
      session_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('outbound', 'inbound')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 12. Campaign Send Windows (Anti-Ban System 2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_send_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      window_date TEXT NOT NULL,
      window_slot TEXT NOT NULL CHECK(window_slot IN ('morning', 'afternoon', 'evening')),
      messages_sent INTEGER DEFAULT 0,
      max_messages INTEGER DEFAULT 25,
      completed_at TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      UNIQUE(campaign_id, window_date, window_slot)
    )
  `);

  // Migrations for existing database files
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
  addColumnSafely('campaigns', 'session_name TEXT DEFAULT "default"');
  addColumnSafely('whatsapp_sessions', 'engine TEXT DEFAULT "whatsapp-web.js"');
  addColumnSafely('campaigns', 'scheduled_at TEXT');
  addColumnSafely('campaigns', 'report_path TEXT');
  addColumnSafely('campaigns', 'session_mode TEXT DEFAULT "auto_split"');
  addColumnSafely('contacts', 'variant_name TEXT DEFAULT "A"');
  addColumnSafely('contacts', 'sent_via_session TEXT');
  addColumnSafely('campaigns', 'auto_fragment TEXT DEFAULT "false"');
  addColumnSafely('campaigns', 'fragment_max_per_window INTEGER DEFAULT 25');

  // Initialize Default Settings (Optimized for High-Capacity 1,000+ Message Outreach with Daily Limits Removed)
  const defaultSettings = [
    { key: 'delay_seconds', value: '1' },
    { key: 'max_retries', value: '2' },
    { key: 'theme', value: 'dark' },
    { key: 'default_attachments_dir', value: path.resolve(__dirname, '../attachments') },
    { key: 'google_sheet_url', value: '' },
    { key: 'enable_notifications', value: 'true' },
    { key: 'default_country_code', value: '91' },
    { key: 'headless', value: 'true' },
    { key: 'keep_browser_open_after_campaign', value: 'true' },
    { key: 'openwa_url', value: 'http://localhost:2785' },
    { key: 'openwa_engine', value: 'whatsapp-web.js' },
    { key: 'daily_limit', value: '25' },
    { key: 'warmup_stage1_limit', value: '25' },
    { key: 'warmup_stage2_limit', value: '50' },
    { key: 'warmup_stage3_limit', value: '75' },
    { key: 'warmup_stage4_limit', value: '100' },
    { key: 'min_delay', value: '8' },
    { key: 'min_delay_seconds', value: '8' },
    { key: 'max_delay', value: '45' },
    { key: 'max_delay_seconds', value: '45' },
    { key: 'warmup_enabled', value: 'true' },
    { key: 'enable_number_warmup', value: 'true' },
    { key: 'enable_daily_warmup', value: 'true' },
    { key: 'auto_pause_health', value: 'true' },
    { key: 'auto_pause_high_risk', value: 'true' },
    { key: 'enable_spintax', value: 'true' },
    { key: 'enable_auto_emoji', value: 'false' },
    { key: 'enable_health_monitoring', value: 'true' },
    { key: 'enable_smart_rate_limiter', value: 'true' },
    { key: 'burst_interval_messages', value: '20' },
    { key: 'burst_pause_seconds', value: '120' },
    { key: 'enable_unsubscribe_protection', value: 'true' },
    { key: 'bypass_all_safety', value: 'false' },
    { key: 'turbo_blast_mode', value: 'false' },
    { key: 'enable_engagement_breaker', value: 'true' },
    { key: 'enable_human_simulation', value: 'true' },
    { key: 'enable_risk_scoring', value: 'true' },
    { key: 'enable_deep_diversification', value: 'true' },
    { key: 'enable_cooldown_enforcement', value: 'true' },
    { key: 'enable_night_pause', value: 'false' },
    { key: 'night_pause_start_hour', value: '23' },
    { key: 'night_pause_end_hour', value: '7' }
  ];

  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (user_id, key, value) VALUES (?, ?, ?)`);
  for (const setting of defaultSettings) {
    insertSetting.run(1, setting.key, setting.value);
  }

  // SaaS Multi-Tenant Tables: Organizations, Org Members, Seat Invites
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      plan_tier TEXT DEFAULT 'pro_desktop',
      seat_limit INTEGER DEFAULT 5,
      monthly_price_per_seat REAL DEFAULT 0.00,
      subscription_status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS org_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(org_id, user_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS seat_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      invited_by_user_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      role TEXT DEFAULT 'member',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Seed default Organization for Admin User (user_id = 1) if not exists
  try {
    const defaultOrg = db.prepare("SELECT id FROM organizations WHERE owner_id = 1").get();
    if (!defaultOrg) {
      const orgRes = db.prepare("INSERT INTO organizations (name, owner_id, plan_tier, seat_limit, monthly_price_per_seat) VALUES (?, 1, 'pro_desktop', 5, 0.00)").run('Default Workspace');
      db.prepare("INSERT OR IGNORE INTO org_members (org_id, user_id, role) VALUES (?, 1, 'owner')").run(orgRes.lastInsertRowid);
    } else {
      db.prepare("UPDATE organizations SET plan_tier = 'pro_desktop', monthly_price_per_seat = 0.00 WHERE owner_id = 1").run();
    }
  } catch (e) {}

  console.log('Database initialized successfully with multi-tenant user support & SaaS Seat Management.');
}

initDb();

export default db;
