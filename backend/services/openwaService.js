import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Anti-Ban Stealth Layer: Initialize puppeteer-extra with stealth plugin
try {
  const puppeteerExtra = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteerExtra.use(StealthPlugin());

  // Monkey-patch require.cache so whatsapp-web.js uses puppeteer-extra with Stealth
  const puppeteerPath = require.resolve('puppeteer');
  require.cache[puppeteerPath] = {
    id: puppeteerPath,
    filename: puppeteerPath,
    loaded: true,
    exports: puppeteerExtra
  };
  console.log('[Anti-Ban Stealth] Loaded puppeteer-extra-plugin-stealth and patched runtime.');
} catch (stealthErr) {
  console.warn('[Anti-Ban Stealth] Warning: puppeteer-extra stealth init skipped:', stealthErr.message);
}

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { get } from '../database.js';
import { getSessionsDir, getUploadsDir, getAttachmentsDir } from '../paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Returns detection tiers for multi-layer Chromium fallback
 */
export function getChromiumDetectionTiers() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const progFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
  const progFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

  return [
    // Tier 1: Packaged Chromium
    {
      tier: 1,
      name: 'Packaged Chromium',
      paths: [
        process.resourcesPath ? path.join(process.resourcesPath, 'chromium', 'chrome.exe') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'chromium', 'chrome.exe') : null,
        path.resolve(process.cwd(), 'resources', 'chromium', 'chrome.exe'),
        path.resolve(__dirname, '../../resources/chromium/chrome.exe')
      ].filter(Boolean)
    },
    // Tier 2: Installed Google Chrome
    {
      tier: 2,
      name: 'Google Chrome',
      paths: [
        path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
      ].filter(Boolean)
    },
    // Tier 3: Installed Microsoft Edge
    {
      tier: 3,
      name: 'Microsoft Edge',
      paths: [
        path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : null,
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ].filter(Boolean)
    },
    // Tier 4: Installed Brave Browser
    {
      tier: 4,
      name: 'Brave Browser',
      paths: [
        path.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(progFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        localAppData ? path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') : null,
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
      ].filter(Boolean)
    }
  ];
}

/**
 * Searches tiers in order and returns first valid executable path, or null.
 */
export function findChromiumExecutable() {
  const tiers = getChromiumDetectionTiers();
  for (const group of tiers) {
    for (const p of group.paths) {
      try {
        if (p && fs.existsSync(p)) {
          return p;
        }
      } catch (e) {}
    }
  }
  return null;
}

class OpenWAService {
  constructor() {
    this.defaultBaseUrl = process.env.OPENWA_URL || 'http://localhost:2785';
    this.apiKey = process.env.OPENWA_API_KEY || '';
    
    // In-memory native whatsapp-web.js sessions for non-Docker Node execution
    this.nativeClients = new Map();
    this.sessionQrCodes = new Map();
    this.sessionStatuses = new Map();
    this.initializingSessions = new Map();
    this.qrTimers = new Map();
  }

  async getBaseUrl() {
    try {
      const setting = await get('SELECT value FROM settings WHERE key = ?', ['openwa_url']);
      return setting && setting.value ? setting.value.replace(/\/$/, '') : this.defaultBaseUrl;
    } catch (e) {
      return this.defaultBaseUrl;
    }
  }

  async getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }
    return headers;
  }

  /**
   * Ping external OpenWA HTTP server health
   */
  async checkHealth() {
    const baseUrl = await this.getBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/docs`, { method: 'GET' });
      return { online: res.status < 500, baseUrl };
    } catch (err) {
      return { online: false, baseUrl, error: err.message };
    }
  }

  /**
   * Create or register a session (Supports both REST API & Native Node whatsapp-web.js)
   */
  async createSession(sessionId = 'default', engine = 'whatsapp-web.js') {
    if (this.initializingSessions.has(sessionId)) {
      return await this.initializingSessions.get(sessionId);
    }

    const initPromise = (async () => {
      const health = await this.checkHealth();
      if (health.online) {
        // Use Docker REST Gateway if running
        const baseUrl = await this.getBaseUrl();
        const headers = await this.getHeaders();
        try {
          const res = await fetch(`${baseUrl}/api/sessions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: sessionId, engine })
          });
          const data = await res.json().catch(() => ({}));
          return { success: res.ok, data };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      // Native Node whatsapp-web.js fallback (No Docker)
      if (!this.nativeClients.has(sessionId)) {
        this.sessionStatuses.set(sessionId, 'INITIALIZING');

        const baseSessionsDir = getSessionsDir();
        const authDir = path.resolve(baseSessionsDir, `session-${sessionId}`);
        const curStatus = this.sessionStatuses.get(sessionId);
        if (curStatus === 'DISCONNECTED' || curStatus === 'AUTH_FAILURE') {
          if (fs.existsSync(authDir)) {
            try {
              fs.rmSync(authDir, { recursive: true, force: true });
            } catch (e) {}
          }
        }

        let isHeadless = true; // Default to silent background mode
        try {
          const { get } = await import('../database.js');
          const hSetting = await get("SELECT value FROM settings WHERE key = 'headless'");
          if (hSetting && String(hSetting.value).toLowerCase() === 'false') {
            isHeadless = false;
          }
        } catch (e) {}

        const browserExecutable = findChromiumExecutable();
        const client = new Client({
          authStrategy: new LocalAuth({ clientId: sessionId, dataPath: baseSessionsDir }),
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          puppeteer: {
            executablePath: browserExecutable || undefined,
            headless: isHeadless,
            defaultViewport: null,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-blink-features=AutomationControlled',
              '--disable-features=IsolateOrigins,site-per-process',
              '--no-default-browser-check',
              '--no-first-run',
              '--window-size=1280,800'
            ]
          },
          evalOnNewDoc: () => {
            try {
              Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            } catch (e) {}
            try {
              window.chrome = window.chrome || { runtime: {} };
            } catch (e) {}
            try {
              Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            } catch (e) {}
            try {
              Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            } catch (e) {}
          }
        });

        const updateDbStatus = async (status, phone = '') => {
          try {
            const { run } = await import('../database.js');
            if (phone) {
              await run('UPDATE whatsapp_sessions SET status = ?, phone_number = ? WHERE session_name = ?', [status, phone, sessionId]);
            } else {
              await run('UPDATE whatsapp_sessions SET status = ? WHERE session_name = ?', [status, sessionId]);
            }
          } catch (e) {}
        };

        const hasSavedAuth = fs.existsSync(authDir);

        client.on('qr', async (qrStr) => {
          try {
            const qrDataUrl = await QRCode.toDataURL(qrStr);
            if (this.qrTimers.has(sessionId)) {
              clearTimeout(this.qrTimers.get(sessionId));
              this.qrTimers.delete(sessionId);
            }
            if (hasSavedAuth) {
              // Delay publishing QR code if local auth files exist on disk,
              // giving Puppeteer time to restore existing logged-in session.
              const timer = setTimeout(async () => {
                const currentStatus = this.sessionStatuses.get(sessionId);
                if (currentStatus !== 'CONNECTED') {
                  this.sessionQrCodes.set(sessionId, qrDataUrl);
                  this.sessionStatuses.set(sessionId, 'SCAN_QR_REQUIRED');
                  await updateDbStatus('Scan QR Required');
                }
                this.qrTimers.delete(sessionId);
              }, 4000);
              this.qrTimers.set(sessionId, timer);
            } else {
              this.sessionQrCodes.set(sessionId, qrDataUrl);
              this.sessionStatuses.set(sessionId, 'SCAN_QR_REQUIRED');
              await updateDbStatus('Scan QR Required');
            }
          } catch (err) {
            console.error(`[Native WWeb] QR Code generation error (${sessionId}):`, err);
          }
        });

        client.on('ready', async () => {
          if (this.qrTimers.has(sessionId)) {
            clearTimeout(this.qrTimers.get(sessionId));
            this.qrTimers.delete(sessionId);
          }
          console.log(`[Native WWeb] Session '${sessionId}' is READY and CONNECTED.`);
          this.sessionStatuses.set(sessionId, 'CONNECTED');
          this.sessionQrCodes.delete(sessionId);
          const phone = client.info?.wid?.user || '';
          await updateDbStatus('Connected', phone);
        });

        // Anti-Ban System 1: Track incoming messages for engagement scoring
        client.on('message', async (msg) => {
          try {
            if (msg.fromMe) return; // Ignore our own messages
            // Filter out WhatsApp groups, broadcast channels, and status updates
            if (msg.from && (msg.from.includes('@g.us') || msg.from.includes('broadcast') || msg.from.includes('@broadcast') || msg.from.includes('@newsletter'))) {
              return;
            }
            const senderPhone = msg.from.replace('@c.us', '').replace('@s.whatsapp.net', '');
            // Dynamic import to avoid circular dependency
            const { trackInboundReply } = await import('./antiBanService.js');
            // Get user_id from session
            const { get: dbGet } = await import('../database.js');
            const sessRow = await dbGet('SELECT user_id FROM whatsapp_sessions WHERE session_name = ?', [sessionId]);
            const uid = sessRow ? sessRow.user_id : 1;
            await trackInboundReply(uid, sessionId, senderPhone);
            
            // Auto-detect opt-out keywords and add to blacklist
            const msgBody = (msg.body || '').trim().toLowerCase();
            const optOutKeywords = ['stop', 'unsubscribe', 'opt out', 'opt-out', 'remove me', 'don\'t message', 'dont message', 'block', 'spam', 'ruk ja', 'band kar', 'mat bhej', 'band karo'];
            if (optOutKeywords.some(kw => msgBody === kw || msgBody.startsWith(kw + ' '))) {
              const { addNumberToBlacklist } = await import('./antiBanService.js');
              await addNumberToBlacklist(uid, senderPhone, `Auto-detected opt-out: "${msg.body.slice(0, 50)}"`);
              console.log(`[Anti-Ban] Auto-blacklisted ${senderPhone} (opt-out detected: "${msg.body.slice(0, 30)}")`);
            }
          } catch (e) {
            // Silent fail — don't interrupt normal operation
          }
        });

        client.on('authenticated', async () => {
          if (this.qrTimers.has(sessionId)) {
            clearTimeout(this.qrTimers.get(sessionId));
            this.qrTimers.delete(sessionId);
          }
          console.log(`[Native WWeb] Session '${sessionId}' authenticated.`);
          this.sessionStatuses.set(sessionId, 'CONNECTED');
          this.sessionQrCodes.delete(sessionId);
          const phone = client.info?.wid?.user || '';
          await updateDbStatus('Connected', phone);
        });

        client.on('auth_failure', async (msg) => {
          if (this.qrTimers.has(sessionId)) {
            clearTimeout(this.qrTimers.get(sessionId));
            this.qrTimers.delete(sessionId);
          }
          console.error(`[Native WWeb] Auth failure on session '${sessionId}':`, msg);
          this.sessionStatuses.set(sessionId, 'AUTH_FAILURE');
          await updateDbStatus('Auth Failure');
        });

        client.on('disconnected', async (reason) => {
          console.log(`[Native WWeb] Session '${sessionId}' disconnected:`, reason);
          if (this.qrTimers.has(sessionId)) {
            clearTimeout(this.qrTimers.get(sessionId));
            this.qrTimers.delete(sessionId);
          }
          this.sessionStatuses.set(sessionId, 'DISCONNECTED');
          this.sessionQrCodes.delete(sessionId);
          this.nativeClients.delete(sessionId);
          await updateDbStatus('Disconnected', '');

          try {
            await client.destroy();
          } catch (e) {}
        });

        this.nativeClients.set(sessionId, client);
      }

      return { success: true, data: { name: sessionId, mode: 'native' } };
    })();

    this.initializingSessions.set(sessionId, initPromise);
    try {
      return await initPromise;
    } finally {
      this.initializingSessions.delete(sessionId);
    }
  }

  /**
   * Start a session & trigger QR generation
   */
  async startSession(sessionId = 'default') {
    const health = await this.checkHealth();
    if (health.online) {
      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      try {
        const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/start`, {
          method: 'POST',
          headers
        });
        const data = await res.json().catch(() => ({}));
        return { success: res.ok, data };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // Native Node whatsapp-web.js start
    if (!this.nativeClients.has(sessionId)) {
      await this.createSession(sessionId);
    }
    const client = this.nativeClients.get(sessionId);
    if (client && !client.pupPage) {
      client.initialize().catch(err => {
        console.error(`[Native WWeb] Error initializing client '${sessionId}':`, err.message);
      });
    }
    return { success: true, data: { name: sessionId, status: 'Initializing native client' } };
  }

  /**
   * Get QR Code image/data for session
   */
  async getQrCode(sessionId = 'default') {
    const health = await this.checkHealth();
    if (health.online) {
      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      try {
        const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/qr`, {
          method: 'GET',
          headers
        });
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('json')) {
            const json = await res.json();
            return { success: true, qr: json.qr || json.data || json.qrCode };
          } else {
            const buffer = await res.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            return { success: true, qr: `data:image/png;base64,${base64}` };
          }
        }
        return { success: false, qr: null };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // Native Node lookup
    const qr = this.sessionQrCodes.get(sessionId);
    return { success: !!qr, qr: qr || null };
  }

  /**
   * Get session connection status
   */
  async getSessionStatus(sessionId = 'default') {
    // 1. Native Node status lookup (fast-path for native whatsapp-web.js sessions)
    if (this.nativeClients.has(sessionId) || this.sessionStatuses.has(sessionId)) {
      const client = this.nativeClients.get(sessionId);
      const status = this.sessionStatuses.get(sessionId) || 'DISCONNECTED';
      const isConn = status === 'CONNECTED' || status === 'AUTHENTICATED' || !!(client && client.info && client.info.wid);

      if (isConn) {
        this.sessionStatuses.set(sessionId, 'CONNECTED');
        this.sessionQrCodes.delete(sessionId);
      }

      const qr = this.sessionQrCodes.get(sessionId);

      return {
        success: true,
        connected: isConn,
        status: isConn ? 'Connected' : (status === 'SCAN_QR_REQUIRED' ? 'Scan QR Code Required' : status),
        qrImageUrl: isConn ? null : (qr || null),
        phone_number: client?.info?.wid?.user || '',
        mode: 'native'
      };
    }

    const health = await this.checkHealth();
    if (health.online) {
      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      try {
        const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/status`, {
          method: 'GET',
          headers
        });
        const data = await res.json().catch(() => ({}));
        const state = data.state || data.status || (res.ok ? 'CONNECTED' : 'DISCONNECTED');
        return {
          success: res.ok,
          connected: state.toUpperCase() === 'CONNECTED' || state.toUpperCase() === 'READY',
          status: state,
          data
        };
      } catch (err) {
        return { success: false, connected: false, status: 'DISCONNECTED', error: err.message };
      }
    }

    return {
      success: true,
      connected: false,
      status: 'DISCONNECTED',
      qrImageUrl: null,
      phone_number: '',
      mode: 'native'
    };
  }

  /**
   * Format phone number to WhatsApp JID format (e.g. 919876543210@c.us)
   */
  formatChatId(phone) {
    let cleaned = String(phone).replace(/\D/g, '');
    if (!cleaned.endsWith('@c.us')) {
      cleaned = `${cleaned}@c.us`;
    }
    return cleaned;
  }

  /**
   * Anti-Ban System 4: Assess contact risk level based on chat history
   * Low = has prior conversation, Medium = contact exists but no chat, High = cold contact
   */
  async getContactRiskLevel(sessionId = 'default', phone) {
    try {
      const client = this.nativeClients.get(sessionId);
      if (!client) return { riskLevel: 'high', reason: 'No active session' };
      
      const chatId = this.formatChatId(phone);
      
      try {
        const chat = await client.getChatById(chatId).catch(() => null);
        if (chat) {
          // Check if there are existing messages in the chat
          const messages = await chat.fetchMessages({ limit: 5 }).catch(() => []);
          if (messages && messages.length > 0) {
            // Check if any are incoming (they replied before)
            const hasIncoming = messages.some(m => !m.fromMe);
            if (hasIncoming) {
              return { riskLevel: 'low', reason: 'Prior two-way conversation exists' };
            }
            return { riskLevel: 'medium', reason: 'Chat exists but no incoming messages' };
          }
        }
      } catch (e) {}
      
      return { riskLevel: 'high', reason: 'Cold contact — no prior interaction' };
    } catch (e) {
      return { riskLevel: 'high', reason: 'Error checking risk: ' + e.message };
    }
  }

  /**
   * Anti-Ban System 6: Simulate natural human idle behavior
   * Randomly goes offline, waits, comes back online
   */
  async simulateIdleBehavior(sessionId = 'default') {
    try {
      const client = this.nativeClients.get(sessionId);
      if (!client) return;
      
      // Go offline
      await client.sendPresenceUnavailable().catch(() => {});
      
      // Random idle period: 15-60 seconds
      const idleMs = 15000 + Math.floor(Math.random() * 45000);
      await new Promise(r => setTimeout(r, idleMs));
      
      // Come back online
      await client.sendPresenceAvailable().catch(() => {});
      
      // Small settling delay
      await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 2000)));
    } catch (e) {
      // Silent fail
    }
  }

  /**
   * Check if phone number is registered on WhatsApp
   */
  async isRegisteredUser(sessionId = 'default', phone) {
    const health = await this.checkHealth();
    if (health.online) {
      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      const cleanPhone = String(phone).replace(/\D/g, '');
      try {
        const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/contacts/check-exists?phone=${cleanPhone}`, { headers });
        const data = await res.json().catch(() => ({}));
        return data.exists !== false;
      } catch {
        return true;
      }
    }

    const client = this.nativeClients.get(sessionId);
    if (!client) return true;

    try {
      const cleanPhone = String(phone).replace(/\D/g, '');
      if (typeof client.isRegisteredUser === 'function') {
        const isReg = await client.isRegisteredUser(`${cleanPhone}@c.us`);
        return isReg !== false;
      }
      if (typeof client.getNumberId === 'function') {
        const numberId = await client.getNumberId(cleanPhone);
        return !!numberId;
      }
      return true;
    } catch {
      return true;
    }
  }

  /**
   * Send text message
   */
  async sendTextMessage(sessionId = 'default', phone, text, options = {}) {
    const health = await this.checkHealth();
    if (health.online) {
      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      const chatId = this.formatChatId(phone);

      try {
        const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages/send-text`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ chatId, text })
        });
        const data = await res.json().catch(() => ({}));
        return {
          success: res.ok && (data.success !== false),
          messageId: data.id || data.messageId || null,
          data,
          error: !res.ok ? (data.message || data.error || 'Failed to send message via OpenWA') : null
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // Native Node whatsapp-web.js send
    let client = this.nativeClients.get(sessionId);
    if (!client) {
      await this.startSession(sessionId);
      client = this.nativeClients.get(sessionId);
    }

    const currentStatus = this.sessionStatuses.get(sessionId);
    const isReady = !!(client && (client.info?.wid || currentStatus === 'CONNECTED' || currentStatus === 'AUTHENTICATED'));

    if (!isReady) {
      return { success: false, error: `Session '${sessionId}' is not connected in Native Node. Please scan QR code.` };
    }

    try {
      const chatId = this.formatChatId(phone);

      // Anti-Ban System 6: Enhanced human behavioral simulation (bypassable for bulk turbo)
      if (!options?.skipHumanSimulation) {
        try {
          await client.sendPresenceAvailable().catch(() => {});
          const chat = await client.getChatById(chatId).catch(() => null);
          if (chat) {
            // Step 1: Simulate reading (2-6 second idle before typing)
            const readingDelayMs = 2000 + Math.floor(Math.random() * 4000);
            await new Promise(r => setTimeout(r, readingDelayMs));
            
            // Step 2: Occasionally fetch messages (simulate scrolling through chat)
            if (Math.random() > 0.6) {
              await chat.fetchMessages({ limit: 3 }).catch(() => {});
              await new Promise(r => setTimeout(r, 500 + Math.floor(Math.random() * 1500)));
            }
            
            // Step 3: Start typing with variable speed
            if (typeof chat.sendStateTyping === 'function') {
              await chat.sendStateTyping().catch(() => {});
              
              const textLength = (text || '').length;
              // Typing speed: 30-60ms per character with randomness
              const baseTypingMs = Math.floor(textLength * (30 + Math.random() * 30));
              // Add occasional "thinking" pauses (simulate backspace/rethink)
              const thinkPauses = Math.random() > 0.5 ? Math.floor(Math.random() * 3000) : 0;
              const typingDelayMs = Math.min(8000, Math.max(1200, baseTypingMs + thinkPauses));
              
              await new Promise(r => setTimeout(r, typingDelayMs));
              
              if (typeof chat.clearState === 'function') {
                await chat.clearState().catch(() => {});
              }
            }
          }
        } catch (presenceErr) {}
      }

      const msg = await client.sendMessage(chatId, text);
      return { success: true, messageId: msg?.id?._serialized || msg?.id?.id || 'msg-' + Date.now(), data: msg };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Send media message (image/document)
   */
  async sendMediaMessage(sessionId = 'default', phone, fileUrlOrPath, caption = '', options = {}) {
    const health = await this.checkHealth();
    if (health.online) {
      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      const chatId = this.formatChatId(phone);

      try {
        const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages/send-media`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ chatId, file: fileUrlOrPath, caption })
        });
        const data = await res.json().catch(() => ({}));
        return {
          success: res.ok,
          data,
          error: !res.ok ? (data.message || data.error || 'Failed to send media via OpenWA') : null
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // Native Node whatsapp-web.js media send
    let client = this.nativeClients.get(sessionId);
    if (!client) {
      await this.startSession(sessionId);
      client = this.nativeClients.get(sessionId);
    }

    const currentStatus = this.sessionStatuses.get(sessionId);
    const isReady = !!(client && (client.info?.wid || currentStatus === 'CONNECTED' || currentStatus === 'AUTHENTICATED'));

    if (!isReady) {
      return { success: false, error: `Session '${sessionId}' is not connected in Native Node. Please scan QR code.` };
    }

    try {
      const chatId = this.formatChatId(phone);

      // Anti-Ban System 6: Enhanced human behavioral simulation for media (bypassable for bulk turbo)
      if (!options?.skipHumanSimulation && !options?.isFollowupMedia) {
        try {
          await client.sendPresenceAvailable().catch(() => {});
          const chat = await client.getChatById(chatId).catch(() => null);
          if (chat) {
            // Simulate reading before sending media
            const readingDelayMs = 1500 + Math.floor(Math.random() * 3000);
            await new Promise(r => setTimeout(r, readingDelayMs));
            
            if (typeof chat.sendStateTyping === 'function') {
              await chat.sendStateTyping().catch(() => {});
              // Media messages take longer to "prepare"
              await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 3000)));
            }
            if (typeof chat.clearState === 'function') {
              await chat.clearState().catch(() => {});
            }
          }
        } catch (presenceErr) {}
      }

      let media;
      if (fileUrlOrPath.startsWith('http://') || fileUrlOrPath.startsWith('https://')) {
        media = await MessageMedia.fromUrl(fileUrlOrPath);
      } else {
        const cleanPath = String(fileUrlOrPath).trim().replace(/^["']|["']$/g, '');
        const candidatePaths = [
          path.isAbsolute(cleanPath) ? cleanPath : null,
          path.resolve(process.cwd(), cleanPath),
          path.resolve(getUploadsDir(), cleanPath),
          path.resolve(getAttachmentsDir(), cleanPath),
          path.resolve(process.cwd(), 'uploads', cleanPath),
          path.resolve(process.cwd(), 'backend', 'uploads', cleanPath),
          path.resolve(process.cwd(), 'attachments', cleanPath),
          path.resolve(process.cwd(), 'backend', 'attachments', cleanPath),
          path.resolve(__dirname, '../uploads', cleanPath),
          path.resolve(__dirname, '../attachments', cleanPath)
        ].filter(Boolean);

        let resolvedFile = candidatePaths.find(p => fs.existsSync(p));
        if (resolvedFile) {
          media = MessageMedia.fromFilePath(resolvedFile);
        } else {
          throw new Error(`Attachment file not found: '${cleanPath}'`);
        }
      }

      const msg = await client.sendMessage(chatId, media, { caption });
      return { success: true, messageId: msg?.id?._serialized || msg?.id?.id || 'msg-' + Date.now(), data: msg };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * List sessions
   */
  async listSessions() {
    const health = await this.checkHealth();
    if (health.online) {
      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      try {
        const res = await fetch(`${baseUrl}/api/sessions`, { method: 'GET', headers });
        const data = await res.json().catch(() => []);
        return { success: res.ok, sessions: Array.isArray(data) ? data : (data.sessions || []) };
      } catch (err) {
        return { success: false, sessions: [], error: err.message };
      }
    }

    // Native Node active sessions list
    const sessions = Array.from(this.nativeClients.keys()).map(name => ({
      name,
      status: this.sessionStatuses.get(name) || 'DISCONNECTED',
      engine: 'whatsapp-web.js (native)'
    }));
    return { success: true, sessions };
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId = 'default') {
    if (this.qrTimers.has(sessionId)) {
      clearTimeout(this.qrTimers.get(sessionId));
      this.qrTimers.delete(sessionId);
    }

    const health = await this.checkHealth();
    if (health.online) {
      const baseUrl = await this.getBaseUrl();
      const headers = await this.getHeaders();
      try {
        const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
          headers
        });
        const data = await res.json().catch(() => ({}));
        return { success: res.ok, data };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // Native Node destroy
    if (this.nativeClients.has(sessionId)) {
      const client = this.nativeClients.get(sessionId);
      try {
        await client.logout().catch(() => {});
        await client.destroy().catch(() => {});
      } catch (e) {}
      this.nativeClients.delete(sessionId);
      this.sessionQrCodes.delete(sessionId);
      this.sessionStatuses.set(sessionId, 'DISCONNECTED');
    }

    try {
      const { run } = await import('../database.js');
      await run('UPDATE whatsapp_sessions SET status = "Disconnected", phone_number = "" WHERE session_name = ?', [sessionId]);
    } catch (e) {}

    const baseSessionsDir = getSessionsDir();
    const authDir = path.resolve(baseSessionsDir, `session-${sessionId}`);
    if (fs.existsSync(authDir)) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          if (!fs.existsSync(authDir)) break;
          fs.rmSync(authDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
          break;
        } catch (e) {
          if (attempt < 4) {
            await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
          } else {
            console.warn(`[Native WWeb] Auth dir deletion warning for '${sessionId}':`, e.message);
          }
        }
      }
    }

    return { success: true };
  }

  /**
   * Initialize or reconnect a session (alias for createSession & startSession)
   */
  async initSession(userId = 1, sessionId = 'default') {
    const sid = typeof userId === 'string' && sessionId === 'default' ? userId : sessionId;
    await this.createSession(sid);
    return this.startSession(sid);
  }
}

export const openwaService = new OpenWAService();
export {
  OpenWAService
};
export default openwaService;
