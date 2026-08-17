import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the root application data directory.
 * In packaged desktop or Electron runtime, uses %APPDATA%/WhatsAppAutomation on Windows.
 */
export function getAppDataDir() {
  if (process.env.APPDATA_DIR) {
    return process.env.APPDATA_DIR;
  }
  const isPackaged = process.env.IS_ELECTRON === 'true' || Boolean(process.resourcesPath);
  if (isPackaged && process.env.APPDATA) {
    const dir = path.join(process.env.APPDATA, 'WhatsAppAutomation');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  return path.resolve(__dirname, '..');
}

/**
 * Resolves the SQLite database file path.
 */
export function getDatabasePath() {
  if (process.env.DB_PATH) {
    const dir = path.dirname(process.env.DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return process.env.DB_PATH;
  }
  const isPackaged = process.env.IS_ELECTRON === 'true' || Boolean(process.resourcesPath);
  if (isPackaged && process.env.APPDATA) {
    const dir = path.join(process.env.APPDATA, 'WhatsAppAutomation');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'db.sqlite');
  }
  const dbDir = path.resolve(__dirname, '../database');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  return path.join(dbDir, 'db.sqlite');
}

/**
 * Resolves the sessions directory for whatsapp-web.js / OpenWA LocalAuth.
 */
export function getSessionsDir() {
  if (process.env.SESSIONS_DIR) {
    if (!fs.existsSync(process.env.SESSIONS_DIR)) fs.mkdirSync(process.env.SESSIONS_DIR, { recursive: true });
    return process.env.SESSIONS_DIR;
  }
  const isPackaged = process.env.IS_ELECTRON === 'true' || Boolean(process.resourcesPath);
  if (isPackaged && process.env.APPDATA) {
    const dir = path.join(process.env.APPDATA, 'WhatsAppAutomation', 'sessions');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  return path.resolve(process.cwd(), '.wwebjs_auth');
}

/**
 * Resolves the file uploads directory.
 */
export function getUploadsDir() {
  if (process.env.UPLOADS_DIR) {
    if (!fs.existsSync(process.env.UPLOADS_DIR)) fs.mkdirSync(process.env.UPLOADS_DIR, { recursive: true });
    return process.env.UPLOADS_DIR;
  }
  const isPackaged = process.env.IS_ELECTRON === 'true' || Boolean(process.resourcesPath);
  if (isPackaged && process.env.APPDATA) {
    const dir = path.join(process.env.APPDATA, 'WhatsAppAutomation', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const dir = path.resolve(__dirname, '../uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolves the attachments directory.
 */
export function getAttachmentsDir() {
  if (process.env.ATTACHMENTS_DIR) {
    if (!fs.existsSync(process.env.ATTACHMENTS_DIR)) fs.mkdirSync(process.env.ATTACHMENTS_DIR, { recursive: true });
    return process.env.ATTACHMENTS_DIR;
  }
  const isPackaged = process.env.IS_ELECTRON === 'true' || Boolean(process.resourcesPath);
  if (isPackaged && process.env.APPDATA) {
    const dir = path.join(process.env.APPDATA, 'WhatsAppAutomation', 'attachments');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const dir = path.resolve(__dirname, '../attachments');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolves the campaign reports export directory.
 */
export function getExportsDir() {
  if (process.env.EXPORTS_DIR) {
    if (!fs.existsSync(process.env.EXPORTS_DIR)) fs.mkdirSync(process.env.EXPORTS_DIR, { recursive: true });
    return process.env.EXPORTS_DIR;
  }
  const isPackaged = process.env.IS_ELECTRON === 'true' || Boolean(process.resourcesPath);
  if (isPackaged && process.env.APPDATA) {
    const dir = path.join(process.env.APPDATA, 'WhatsAppAutomation', 'exports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const dir = path.resolve(__dirname, '../exports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export default {
  getAppDataDir,
  getDatabasePath,
  getSessionsDir,
  getUploadsDir,
  getAttachmentsDir,
  getExportsDir
};

