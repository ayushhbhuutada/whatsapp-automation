import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { run, get, all } from '../database.js';
import { updateGoogleSheetStatus } from './googleSheets.js';
import { openwaService } from './openwaService.js';
import { getExportsDir } from '../paths.js';
import {
  parseSpintax,
  isNumberBlacklisted,
  checkWarmupStatus,
  incrementDailySendCount,
  calculateSmartDelayMs,
  isNightQuietHours,
  trackOutboundMessage,
  calculateEngagementScore,
  checkWindowQuota,
  incrementWindowCount,
  deepDiversifyMessage,
  getContactDelayMultiplier,
  getNumberReputation,
  incrementReputationSendCount,
  recoverTrustScore
} from './antiBanService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AutomationRunner {
  constructor() {
    this.currentCampaignId = null;
    this.status = 'Idle'; // Idle, Running, Paused, Stopped
    this.keepRunning = false;
    this.isStarting = false;
    this.recoverStrandedContacts().catch(() => {});
  }

  async recoverStrandedContacts(campaignId = null) {
    try {
      if (campaignId) {
        await run("UPDATE contacts SET status = 'Pending', sent_via_session = NULL WHERE campaign_id = ? AND status = 'Sending'", [campaignId]);
      } else {
        await run("UPDATE contacts SET status = 'Pending', sent_via_session = NULL WHERE status = 'Sending'");
      }
    } catch (e) {}
  }

  async log(campaignId, contactId, level, message, userId = 1) {
    console.log(`[${level}] Campaign ${campaignId}: ${message}`);
    try {
      await run(`
        INSERT INTO logs (user_id, campaign_id, contact_id, level, message)
        VALUES (?, ?, ?, ?, ?)
      `, [userId || 1, campaignId, contactId, level, message]);
    } catch (err) {
      console.error('Failed to write log to DB:', err.message);
    }
  }

  getStatus() {
    return {
      status: this.status,
      currentCampaignId: this.currentCampaignId
    };
  }

  async getSettingsMap(userId = 1) {
    const sRows = await all('SELECT key, value FROM settings WHERE user_id = ?', [userId]);
    const settingsMap = {};
    (sRows || []).forEach(r => { settingsMap[r.key] = r.value; });
    return settingsMap;
  }

  async start(campaignId) {
    return this.startCampaign(campaignId);
  }

  async checkSession(sessionId = 'default') {
    try {
      const statusRes = await openwaService.getSessionStatus(sessionId);
      if (statusRes.connected) {
        return {
          connected: true,
          status: 'Connected',
          hasSavedSession: true,
          qrImageUrl: null,
          engine: 'whatsapp-web.js'
        };
      }
      const qrRes = await openwaService.getQrCode(sessionId);
      if (qrRes.success && qrRes.qr) {
        return {
          connected: false,
          status: 'Scan QR Code Required',
          hasSavedSession: false,
          qrImageUrl: qrRes.qr,
          engine: 'whatsapp-web.js'
        };
      }
      return {
        connected: false,
        status: statusRes.status || 'Not Connected',
        hasSavedSession: false,
        qrImageUrl: null,
        engine: 'whatsapp-web.js'
      };
    } catch (e) {
      return {
        connected: false,
        status: 'Not Connected',
        hasSavedSession: false,
        qrImageUrl: null,
        engine: 'whatsapp-web.js'
      };
    }
  }

  async connectSession(sessionId = 'default', engine = 'whatsapp-web.js') {
    await openwaService.createSession(sessionId, engine);
    await openwaService.startSession(sessionId);
    await new Promise(r => setTimeout(r, 1500));
    return await this.checkSession(sessionId);
  }

  /**
   * Discovers all active, connected WhatsApp sessions for a given user.
   */
  async getConnectedSessions(userId = 1) {
    const dbSessions = await all('SELECT session_name, status, phone_number FROM whatsapp_sessions WHERE user_id = ?', [userId]);
    const connected = [];

    for (const s of (dbSessions || [])) {
      const sName = s.session_name || 'default';
      const state = await this.checkSession(sName);
      if (state.connected) {
        connected.push({
          sessionId: sName,
          phone: s.phone_number || '',
          engine: 'whatsapp-web.js'
        });
      }
    }

    // Fallback: If no sessions in DB or none connected, check 'default'
    if (connected.length === 0) {
      const defState = await this.checkSession('default');
      if (defState.connected) {
        connected.push({ sessionId: 'default', phone: '', engine: 'whatsapp-web.js' });
      }
    }

    return connected;
  }

  async startCampaign(campaignId) {
    if (this.status === 'Running' || this.isStarting) {
      throw new Error('Automation is already starting or running.');
    }
    this.isStarting = true;
    try {
      await this.recoverStrandedContacts(campaignId);
      this.currentCampaignId = campaignId;
      this.status = 'Running';
      this.keepRunning = true;
      await run("UPDATE campaigns SET status = 'Sending' WHERE id = ?", [campaignId]);
      await this.log(campaignId, null, 'info', 'Starting campaign execution with Parallel Multi-Device Engine.');
      this.runLoop(campaignId).catch(async (error) => {
        console.error('Error in automation loop:', error);
        this.status = 'Failed';
        await run("UPDATE campaigns SET status = 'Stopped' WHERE id = ?", [campaignId]);
        await this.log(campaignId, null, 'error', `Automation loop crashed: ${error.message}`);
        await this.cleanup();
      });
    } finally {
      this.isStarting = false;
    }
  }

  async pauseCampaign(campaignId) {
    if (this.currentCampaignId !== campaignId || this.status !== 'Running') return;
    this.status = 'Paused';
    this.keepRunning = false;
    await run("UPDATE campaigns SET status = 'Paused' WHERE id = ?", [campaignId]);
    await this.log(campaignId, null, 'info', 'Campaign execution paused by user.');
  }

  async resumeCampaign(campaignId) {
    if (this.isStarting || this.status === 'Running') {
      throw new Error('Automation is already starting or running.');
    }
    if (this.currentCampaignId && this.currentCampaignId !== campaignId && this.status !== 'Idle') {
      throw new Error(`Another campaign (#${this.currentCampaignId}) is currently active.`);
    }
    this.isStarting = true;
    try {
      await this.recoverStrandedContacts(campaignId);
      this.currentCampaignId = campaignId;
      this.status = 'Running';
      this.keepRunning = true;
      await run("UPDATE campaigns SET status = 'Sending' WHERE id = ?", [campaignId]);
      await this.log(campaignId, null, 'info', 'Campaign execution resumed.');
      this.runLoop(campaignId).catch(async (error) => {
        console.error('Error in automation loop:', error);
        this.status = 'Failed';
        await run("UPDATE campaigns SET status = 'Stopped' WHERE id = ?", [campaignId]);
        await this.log(campaignId, null, 'error', `Automation loop crashed: ${error.message}`);
        await this.cleanup();
      });
    } finally {
      this.isStarting = false;
    }
  }

  async stopCampaign(campaignId) {
    if (this.currentCampaignId !== campaignId) return;
    this.status = 'Stopped';
    this.keepRunning = false;
    await run("UPDATE campaigns SET status = 'Stopped' WHERE id = ?", [campaignId]);
    await this.log(campaignId, null, 'info', 'Campaign execution stopped by user.');
    try {
      await this.generateCampaignExcelReport(campaignId);
    } catch (e) {}
    await this.cleanup();
  }

  async cleanup() {
    this.status = 'Idle';
    this.currentCampaignId = null;
    this.keepRunning = false;
  }

  async logoutSession(sessionId = 'default') {
    await openwaService.deleteSession(sessionId);
    if (this.currentCampaignId === null || this.status === 'Idle') {
      await this.cleanup();
    }
  }

  /**
   * Generates a comprehensive Excel (.xlsx) delivery audit report for a campaign.
   */
  async generateCampaignExcelReport(campaignId) {
    try {
      const campaign = await get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      if (!campaign) return null;

      const contacts = await all(`
        SELECT id, name, phone, company, status, sent_via_session, sent_at, error_reason, message_template, variant_name, row_index
        FROM contacts 
        WHERE campaign_id = ? 
        ORDER BY row_index ASC, id ASC
      `, [campaignId]);

      const total = contacts.length;
      const sent = contacts.filter(c => c.status === 'Sent').length;
      const failed = contacts.filter(c => c.status === 'Failed').length;
      const skipped = contacts.filter(c => c.status === 'Skipped').length;
      const successRate = total > 0 ? `${((sent / total) * 100).toFixed(1)}%` : '0%';

      const sessionsUsed = Array.from(new Set(contacts.map(c => c.sent_via_session).filter(Boolean)));
      const sessionsStr = sessionsUsed.length > 0 ? sessionsUsed.join(', ') : (campaign.session_name || 'default');

      // 1. Sheet 1: Campaign Executive Summary
      const summaryData = [
        ['WhatsApp Campaign Execution Summary Report', ''],
        ['Generated On', new Date().toLocaleString()],
        ['', ''],
        ['Campaign ID', campaign.id],
        ['Campaign Name', campaign.name],
        ['Status', campaign.status],
        ['Total Recipients', total],
        ['Successfully Sent', sent],
        ['Failed', failed],
        ['Skipped (Blacklisted / Invalid)', skipped],
        ['Delivery Success Rate', successRate],
        ['Execution Duration (Seconds)', campaign.duration || 0],
        ['WhatsApp Sender Profiles Used', sessionsStr],
        ['Session Routing Mode', campaign.session_mode || 'auto_split'],
        ['Created At', campaign.created_at || '']
      ];

      // 2. Sheet 2: Detailed Contacts & Delivery Audit
      const auditHeaders = [
        '#',
        'Recipient Name',
        'Phone Number',
        'Company',
        'Delivery Status',
        'WhatsApp Sender Profile',
        'Sent Timestamp',
        'Error / Failure Details',
        'Variant',
        'Message Preview'
      ];

      const auditRows = contacts.map((c, idx) => [
        c.row_index || (idx + 1),
        c.name || 'N/A',
        c.phone || '',
        c.company || '',
        c.status || 'Pending',
        c.sent_via_session || 'N/A',
        c.sent_at ? new Date(c.sent_at).toLocaleString() : '',
        c.error_reason || '',
        c.variant_name || 'A',
        c.message_template ? (c.message_template.length > 100 ? c.message_template.substring(0, 100) + '...' : c.message_template) : ''
      ]);

      const wb = XLSX.utils.book_new();

      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      wsSummary['!cols'] = [{ wch: 32 }, { wch: 45 }];
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Executive Summary');

      const wsAudit = XLSX.utils.aoa_to_sheet([auditHeaders, ...auditRows]);
      wsAudit['!cols'] = [
        { wch: 6 },
        { wch: 22 },
        { wch: 18 },
        { wch: 20 },
        { wch: 16 },
        { wch: 24 },
        { wch: 22 },
        { wch: 35 },
        { wch: 10 },
        { wch: 45 }
      ];
      XLSX.utils.book_append_sheet(wb, wsAudit, 'Recipients Audit');

      const exportsDir = getExportsDir();
      const filename = `Campaign_${campaignId}_Report_${Date.now()}.xlsx`;
      const filePath = path.join(exportsDir, filename);

      XLSX.writeFile(wb, filePath);

      await run('UPDATE campaigns SET report_path = ? WHERE id = ?', [filePath, campaignId]);
      await this.log(campaignId, null, 'info', `✓ Excel delivery audit report generated: ${filename}`, campaign.user_id || 1);

      return filePath;
    } catch (err) {
      console.error(`Failed to generate Excel report for campaign #${campaignId}:`, err);
      return null;
    }
  }

  /**
   * Main Campaign Loop with Multi-Device Auto-Splitting & 2x Parallel Execution
   */
  async runLoop(campaignId) {
    const campaign = await get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
    if (!campaign) {
      this.status = 'Stopped';
      this.keepRunning = false;
      return;
    }

    const userId = campaign.user_id || 1;

    // 1. Determine Session Pool for Multi-Device Auto-Splitting or Custom Subset
    let activeSessions = [];
    const mode = campaign.session_mode || 'auto_split';
    const specifiedSession = String(campaign.session_name || '').trim();

    if (mode === 'custom_subset' || (specifiedSession && specifiedSession.includes(','))) {
      // User selected specific subset of numbers for load balancing
      const requestedList = specifiedSession.split(',').map(s => s.trim()).filter(Boolean);
      const connected = await this.getConnectedSessions(userId);
      const connectedSet = new Set(connected.map(s => s.sessionId));

      for (const reqSession of requestedList) {
        if (connectedSet.has(reqSession)) {
          activeSessions.push(reqSession);
        } else {
          // Attempt auto-connect if requested profile is not active
          const conn = await this.connectSession(reqSession);
          if (conn && conn.connected) {
            activeSessions.push(reqSession);
          }
        }
      }
    } else if (mode === 'auto_split' || specifiedSession === 'auto_split' || !specifiedSession || specifiedSession === 'all') {
      const connected = await this.getConnectedSessions(userId);
      activeSessions = connected.map(s => s.sessionId);
    } else if (specifiedSession && specifiedSession !== 'default') {
      activeSessions = [specifiedSession];
    } else {
      activeSessions = ['default'];
    }

    // 2. Load settings
    const settingsRows = await get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'delay_seconds']);
    const delayMs = (settingsRows ? parseInt(settingsRows.value) || 5 : 5) * 1000;

    const sheetUrlSetting = await get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'google_sheet_url']);
    const googleSheetUrl = sheetUrlSetting ? sheetUrlSetting.value : '';

    const countryCodeSetting = await get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'default_country_code']);
    const defaultCountryCode = countryCodeSetting ? countryCodeSetting.value.replace(/\D/g, '') : '91';

    const maxRetriesSetting = await get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'max_retries']);
    const maxRetries = maxRetriesSetting ? Math.max(0, parseInt(maxRetriesSetting.value) || 0) : 2;

    const antiBanSettings = await this.getSettingsMap(userId);
    const isBypassed = antiBanSettings.bypass_all_safety === 'true' || 
                       antiBanSettings.bypass_all_safety === true || 
                       antiBanSettings.turbo_blast_mode === 'true' || 
                       antiBanSettings.turbo_blast_mode === true;

    // --- Anti-Ban System 5: Filter out sessions in cooldown (can be bypassed in turbo mode) ---
    if (!isBypassed && antiBanSettings.enable_cooldown_enforcement !== 'false' && antiBanSettings.enable_cooldown_enforcement !== false) {
      const { getNumberReputation: getReputation } = await import('./antiBanService.js');
      const filteredSessions = [];
      for (const sid of activeSessions) {
        const rep = await getReputation(userId, sid);
        if (rep.inCooldown) {
          await this.log(campaignId, null, 'warning', `[${sid}] Session is in cooldown (${rep.cooldownRemaining} remaining). Excluding from this campaign.`, userId);
        } else {
          filteredSessions.push(sid);
        }
      }
      if (filteredSessions.length === 0) {
        await this.log(campaignId, null, 'error', 'All sessions are in cooldown. Cannot send. Pausing campaign.', userId);
        await run("UPDATE campaigns SET status = 'Paused' WHERE id = ?", [campaignId]);
        await this.cleanup();
        return;
      }
      activeSessions = filteredSessions;
    }

    // Verify at least one session is connected
    if (activeSessions.length === 0) {
      await this.log(campaignId, null, 'info', "Attempting to connect default WhatsApp session 'default'...", userId);
      const connResult = await this.connectSession('default');
      if (connResult.connected) {
        activeSessions = ['default'];
      } else {
        await this.log(campaignId, null, 'error', 'No connected WhatsApp session found. Please connect your WhatsApp profile(s) via QR code first.', userId);
        await run("UPDATE campaigns SET status = 'Stopped' WHERE id = ?", [campaignId]);
        await this.cleanup();
        return;
      }
    }

    const numWorkers = activeSessions.length;
    await this.log(
      campaignId, 
      null, 
      'info', 
      mode === 'custom_subset' || specifiedSession.includes(',')
        ? `🎯 Custom Multi-Number Load Balancing active! Broadcasting across ${numWorkers} selected WhatsApp profile(s) in parallel: [${activeSessions.join(', ')}] (${numWorkers}x parallel speed)`
        : `⚡ Multi-Device Parallel Engine active! Broadcasting across ${numWorkers} connected WhatsApp profile(s) in parallel: [${activeSessions.join(', ')}] (${numWorkers}x speed)`,
      userId
    );

    const startTime = Date.now();

    // 3. Spawn Parallel Workers for each Connected WhatsApp Session
    const workerPromises = activeSessions.map((sessionId, workerIdx) => {
      return this.runSessionWorker({
        campaignId,
        sessionId,
        workerIdx,
        totalWorkers: numWorkers,
        userId,
        antiBanSettings,
        maxRetries,
        defaultCountryCode,
        googleSheetUrl,
        delayMs
      });
    });

    await Promise.all(workerPromises);

    // 4. Finalize Campaign & Generate Excel Delivery Report
    const remaining = await get("SELECT COUNT(*) as count FROM contacts WHERE campaign_id = ? AND status IN ('Pending', 'Sending')", [campaignId]);
    if (!remaining || remaining.count === 0) {
      await this.log(campaignId, null, 'info', 'All campaign contacts processed successfully.', userId);
      await run("UPDATE campaigns SET status = 'Completed' WHERE id = ?", [campaignId]);
      this.status = 'Completed';
    } else {
      await run("UPDATE campaigns SET status = 'Paused' WHERE id = ?", [campaignId]);
      this.status = 'Paused';
    }

    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    await run('UPDATE campaigns SET duration = duration + ? WHERE id = ?', [durationSeconds, campaignId]);
    await run("UPDATE campaigns SET sent_count = (SELECT COUNT(*) FROM contacts WHERE campaign_id = ? AND status = 'Sent'), failed_count = (SELECT COUNT(*) FROM contacts WHERE campaign_id = ? AND status = 'Failed') WHERE id = ?", [campaignId, campaignId, campaignId]);

    // Automatically generate Excel Report at end of campaign
    try {
      await this.generateCampaignExcelReport(campaignId);
    } catch (e) {}
    await this.cleanup();
  }

  /**
   * Individual worker loop that processes contacts through a dedicated WhatsApp session concurrently
   */
  async runSessionWorker(params) {
    const {
      campaignId,
      sessionId,
      workerIdx,
      totalWorkers,
      userId,
      antiBanSettings,
      maxRetries,
      defaultCountryCode,
      googleSheetUrl,
      delayMs
    } = params;

    let workerMsgCount = 0;

    while (this.keepRunning) {
      // Verify that this worker's WhatsApp session is still connected before claiming
      const sessionState = await openwaService.getSessionStatus(sessionId);
      if (!sessionState || !sessionState.connected) {
        await this.log(campaignId, null, 'warning', `[${sessionId}] WhatsApp session disconnected. Halting worker.`, userId);
        break;
      }

      // Atomic contact claiming from queue
      const contact = await get(`
        SELECT * FROM contacts 
        WHERE campaign_id = ? AND status = 'Pending' 
        ORDER BY id ASC LIMIT 1
      `, [campaignId]);

      if (!contact) {
        // No more pending contacts for this worker
        break;
      }

      // Mark as Sending under this specific worker session
      const claimRes = await run(`
        UPDATE contacts 
        SET status = 'Sending', sent_via_session = ? 
        WHERE id = ? AND status = 'Pending'
      `, [sessionId, contact.id]);

      // If another parallel worker already claimed it, re-loop
      if (!claimRes || claimRes.changes === 0) {
        continue;
      }

      if (!this.keepRunning) {
        // Revert to pending if stopped abruptly
        await run("UPDATE contacts SET status = 'Pending', sent_via_session = NULL WHERE id = ?", [contact.id]);
        break;
      }

      const isWorkerBypassed = antiBanSettings.bypass_all_safety === 'true' || 
                               antiBanSettings.bypass_all_safety === true || 
                               antiBanSettings.turbo_blast_mode === 'true' || 
                               antiBanSettings.turbo_blast_mode === true;

      // --- Anti-Ban: Night Quiet Hours Check ---
      if (!isWorkerBypassed && isNightQuietHours(antiBanSettings)) {
        await this.log(campaignId, null, 'warning', `[${sessionId}] Night quiet hours active. Pausing campaign #${campaignId}.`, userId);
        await run("UPDATE campaigns SET status = 'Paused' WHERE id = ?", [campaignId]);
        this.status = 'Paused';
        this.keepRunning = false;
        await run("UPDATE contacts SET status = 'Pending', sent_via_session = NULL WHERE id = ?", [contact.id]);
        break;
      }

      // --- Anti-Ban: Daily Warmup Limit Check ---
      const warmup = await checkWarmupStatus(userId, antiBanSettings, sessionId);
      if (!isWorkerBypassed && warmup.isEnabled && warmup.isExceeded) {
        await this.log(campaignId, null, 'warning', `[${sessionId}] Daily warmup limit reached (${warmup.sentToday}/${warmup.dailyLimit}). Pausing for today.`, userId);
        await run("UPDATE campaigns SET status = 'Paused' WHERE id = ?", [campaignId]);
        this.status = 'Paused';
        this.keepRunning = false;
        await run("UPDATE contacts SET status = 'Pending', sent_via_session = NULL WHERE id = ?", [contact.id]);
        break;
      }

      // --- Anti-Ban System 2: Campaign Fragment Window Check ---
      const campaignRow = await get('SELECT auto_fragment, fragment_max_per_window FROM campaigns WHERE id = ?', [campaignId]);
      if (!isWorkerBypassed && campaignRow && campaignRow.auto_fragment === 'true') {
        const windowQuota = await checkWindowQuota(campaignId, campaignRow.fragment_max_per_window || 25);
        if (!windowQuota.canSend) {
          await this.log(campaignId, null, 'info', `[${sessionId}] ${windowQuota.reason}. Auto-pausing campaign.`, userId);
          await run("UPDATE campaigns SET status = 'Paused' WHERE id = ?", [campaignId]);
          this.status = 'Paused';
          this.keepRunning = false;
          await run("UPDATE contacts SET status = 'Pending', sent_via_session = NULL WHERE id = ?", [contact.id]);
          break;
        }
      }

      // --- Anti-Ban System 1: Engagement Circuit Breaker ---
      if (!isWorkerBypassed && antiBanSettings.enable_engagement_breaker !== 'false' && workerMsgCount > 0 && workerMsgCount % 5 === 0) {
        const engagement = await calculateEngagementScore(userId, campaignId, 60, antiBanSettings);
        if (engagement.shouldAutoPause) {
          await this.log(campaignId, null, 'warning', `[${sessionId}] ⚠️ ENGAGEMENT CIRCUIT BREAKER: ${engagement.outboundCount} messages sent with 0 replies. Auto-pausing to protect account.`, userId);
          await run("UPDATE campaigns SET status = 'Paused' WHERE id = ?", [campaignId]);
          this.status = 'Paused';
          this.keepRunning = false;
          await run("UPDATE contacts SET status = 'Pending', sent_via_session = NULL WHERE id = ?", [contact.id]);
          break;
        }
      }

      // Normalize phone number
      let cleanPhone = String(contact.phone || '').replace(/\D/g, '');
      if (cleanPhone.length === 10 && defaultCountryCode) {
        cleanPhone = defaultCountryCode + cleanPhone;
      }

      // --- Anti-Ban: Blacklist Check ---
      const blacklisted = await isNumberBlacklisted(userId, cleanPhone);
      if (blacklisted) {
        await run("UPDATE contacts SET status = 'Skipped', error_reason = 'Number is in opt-out blacklist', sent_via_session = ? WHERE id = ?", [sessionId, contact.id]);
        await this.log(campaignId, contact.id, 'warning', `[${sessionId}] Skipping ${contact.name} (+${cleanPhone}) - blacklisted opt-out number.`, userId);
        continue;
      }

      // --- Registration Check: Verify number exists on WhatsApp ---
      const isRegistered = await openwaService.isRegisteredUser(sessionId, cleanPhone);
      if (!isRegistered) {
        await run("UPDATE contacts SET status = 'Failed', error_reason = 'Number not registered on WhatsApp', sent_via_session = ? WHERE id = ?", [sessionId, contact.id]);
        await run("UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?", [campaignId]);
        await this.log(campaignId, contact.id, 'warning', `[${sessionId}] ✗ Skipping ${contact.name} (+${cleanPhone}) — number is not registered on WhatsApp.`, userId);
        continue;
      }

      // --- Anti-Ban System 4: Recipient Risk-Based Pre-Qualification ---
      let contactRiskLevel = 'low';
      if (!isWorkerBypassed && antiBanSettings.enable_risk_scoring !== 'false') {
        try {
          const riskInfo = await openwaService.getContactRiskLevel(sessionId, cleanPhone);
          contactRiskLevel = riskInfo.riskLevel;
        } catch (e) {}
      }

      // --- Anti-Ban: Spintax Message Variation ---
      let finalMessage = contact.message_template || '';
      finalMessage = parseSpintax(finalMessage);

      // --- Anti-Ban System 3: Deep Content Fingerprint Diversification ---
      if (antiBanSettings.enable_deep_diversification !== 'false') {
        finalMessage = deepDiversifyMessage(finalMessage, antiBanSettings);
      }

      let success = false;
      let lastError = null;
      workerMsgCount++;

      const sendOptions = {
        skipHumanSimulation: isWorkerBypassed || antiBanSettings.enable_human_simulation === 'false' || antiBanSettings.enable_human_simulation === false
      };

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (!this.keepRunning) break;
        if (attempt > 0) {
          await this.log(campaignId, contact.id, 'warning', `[${sessionId}] Retry attempt ${attempt}/${maxRetries} for ${contact.name}...`, userId);
          await new Promise(r => setTimeout(r, 2000));
        }

        try {
          await this.log(campaignId, contact.id, 'info', `[${sessionId}] Sending to ${contact.name} (+${cleanPhone})...`, userId);

          let res = { success: false };
          if (contact.attachment_path && String(contact.attachment_path).trim()) {
            const rawItems = String(contact.attachment_path)
              .split(',')
              .map(s => s.trim().replace(/^["']+|["']+$|^\s*["']|["']\s*$/g, ''))
              .filter(Boolean);

            const uniqueAttachments = Array.from(new Set(rawItems));

            if (uniqueAttachments.length > 0) {
              for (let i = 0; i < uniqueAttachments.length; i++) {
                const attachItem = uniqueAttachments[i];
                const captionText = (i === 0) ? finalMessage : '';
                const mediaSendOptions = {
                  ...sendOptions,
                  isFollowupMedia: i > 0
                };
                res = await openwaService.sendMediaMessage(sessionId, cleanPhone, attachItem, captionText, mediaSendOptions);
                if (!res.success) break;
              }
            } else {
              res = await openwaService.sendTextMessage(sessionId, cleanPhone, finalMessage, sendOptions);
            }
          } else {
            res = await openwaService.sendTextMessage(sessionId, cleanPhone, finalMessage, sendOptions);
          }

          if (res.success) {
            success = true;
            break;
          } else {
            throw new Error(res.error || 'WhatsApp message dispatch failed');
          }
        } catch (err) {
          lastError = err;
          if (/target closed|protocol error|session closed|browser has been closed|page crashed|connection closed/i.test(err.message || '')) {
            await this.log(campaignId, contact.id, 'warning', `[${sessionId}] Browser session disconnected. Attempting auto-reconnect...`, userId);
            try {
              await openwaService.initSession(userId, sessionId);
              await new Promise(r => setTimeout(r, 3000));
            } catch (recErr) {
              await this.log(campaignId, contact.id, 'error', `[${sessionId}] Auto-reconnect failed: ${recErr.message}`, userId);
            }
          }
        }
      }

      if (success) {
        const now = new Date().toISOString();
        await run(`UPDATE contacts SET status = 'Sent', sent_at = ?, sent_via_session = ? WHERE id = ?`, [now, sessionId, contact.id]);
        await run("UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ?", [campaignId]);
        await this.log(campaignId, contact.id, 'info', `[${sessionId}] ✓ Message sent to ${contact.name}.`, userId);
        await incrementDailySendCount(userId, sessionId);

        // Anti-Ban: Track outbound for engagement scoring
        await trackOutboundMessage(userId, campaignId, sessionId, cleanPhone);
        await incrementReputationSendCount(userId, sessionId);
        // Recover 1 trust point every 50 successful sends
        if (workerMsgCount % 50 === 0) {
          await recoverTrustScore(userId, sessionId, 1);
        }

        // Anti-Ban System 2: Track window quota
        await incrementWindowCount(campaignId);

        // Anti-Ban System 6: Periodic offline/online cycling
        if (!isWorkerBypassed && antiBanSettings.enable_human_simulation !== 'false' && workerMsgCount > 0 && workerMsgCount % (5 + Math.floor(Math.random() * 6)) === 0) {
          try {
            await openwaService.simulateIdleBehavior(sessionId);
            await this.log(campaignId, null, 'info', `[${sessionId}] 💤 Simulating idle behavior (System 6)`, userId);
          } catch (e) {}
        }

        if (googleSheetUrl && contact.row_index) {
          await updateGoogleSheetStatus(googleSheetUrl, contact.row_index, 'Sent');
        }
      } else if (!this.keepRunning) {
        // Interrupted by pause or stop: rollback contact to Pending status
        await run("UPDATE contacts SET status = 'Pending', sent_via_session = NULL WHERE id = ?", [contact.id]);
      } else {
        const errorMsg = lastError ? lastError.message : 'Failed after retries.';
        await run(`UPDATE contacts SET status = 'Failed', error_reason = ?, sent_via_session = ? WHERE id = ?`, [errorMsg, sessionId, contact.id]);
        await run("UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?", [campaignId]);
        await this.log(campaignId, contact.id, 'error', `[${sessionId}] ✗ Failed to send to ${contact.name}: ${errorMsg}`, userId);
        if (googleSheetUrl && contact.row_index) {
          await updateGoogleSheetStatus(googleSheetUrl, contact.row_index, 'Failed', errorMsg);
        }

        // Check if the failure was caused by session disconnection: halt worker loop to prevent burning through queue
        if (/not connected|disconnected|session closed|browser has been closed|scan qr/i.test(errorMsg)) {
          await this.log(campaignId, null, 'warning', `[${sessionId}] WhatsApp session disconnected. Halting worker to preserve queue.`, userId);
          break;
        }
      }

      // Anti-Ban Smart Delay with Engagement + Risk Multipliers
      if (this.keepRunning) {
        const delay = calculateSmartDelayMs(antiBanSettings, workerMsgCount);
        if (delay.isRestPause && !isWorkerBypassed) {
          await this.log(campaignId, null, 'info', `[${sessionId}] Micro-rest pause ${delay.pauseSeconds}s (burst interval reached).`, userId);
        }
        
        let effectiveDelay = delay.delayMs || delayMs;
        if (!isWorkerBypassed) {
          // Apply engagement-reactive multiplier
          try {
            const engagement = await calculateEngagementScore(userId, campaignId, 60, antiBanSettings);
            effectiveDelay = Math.round(effectiveDelay * engagement.throttleMultiplier);
            if (engagement.throttleMultiplier > 1.5) {
              await this.log(campaignId, null, 'info', `[${sessionId}] Engagement throttle active (${engagement.riskLevel}): delay ${Math.round(effectiveDelay/1000)}s`, userId);
            }
          } catch (e) {}
          
          // Apply contact risk multiplier
          const riskMultiplier = getContactDelayMultiplier(contactRiskLevel, antiBanSettings);
          effectiveDelay = Math.round(effectiveDelay * riskMultiplier);
          
          // Cap maximum delay at 5 minutes to prevent infinite waits
          effectiveDelay = Math.min(effectiveDelay, 300000);
        } else {
          // In turbo / bypass mode, respect direct delay_seconds without multipliers
          effectiveDelay = Math.max(0, (parseInt(antiBanSettings.delay_seconds) || 1) * 1000);
        }
        
        await new Promise(r => setTimeout(r, effectiveDelay));
      }
    }
  }
}

const runnerInstance = new AutomationRunner();

// Background Scheduler for Scheduled Campaigns
const schedulerTimer = setInterval(async () => {
  try {
    if (runnerInstance.status === 'Running' || runnerInstance.isStarting) {
      return; // Runner is busy, will check on next cycle
    }
    const dueCampaigns = await all(`
      SELECT id FROM campaigns 
      WHERE status = 'Scheduled' AND scheduled_at IS NOT NULL 
      AND datetime(scheduled_at) <= datetime('now')
    `);
    for (const c of (dueCampaigns || [])) {
      if (runnerInstance.status === 'Running' || runnerInstance.isStarting) break;
      console.log(`[Scheduler] Auto-launching scheduled campaign #${c.id}...`);
      try {
        await runnerInstance.startCampaign(c.id);
      } catch (e) {
        console.error(`Failed to launch scheduled campaign #${c.id}:`, e.message);
      }
    }
  } catch (e) {}
}, 20000);
if (schedulerTimer && typeof schedulerTimer.unref === 'function') {
  schedulerTimer.unref();
}

export {
  AutomationRunner
};

export default runnerInstance;

