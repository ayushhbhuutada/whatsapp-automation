import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { run, get, all } from '../database.js';
import { updateGoogleSheetStatus } from './googleSheets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AutomationRunner {
  constructor() {
    this.browserContext = null;
    this.page = null;
    this.currentCampaignId = null;
    this.status = 'Idle'; // Idle, Running, Paused, Stopped
    this.keepRunning = false;
  }

  log = async (campaignId, contactId, level, message) => {
    console.log(`[${level}] Campaign ${campaignId}: ${message}`);
    await run(`
      INSERT INTO logs (campaign_id, contact_id, level, message)
      VALUES (?, ?, ?, ?)
    `, [campaignId, contactId, level, message]);
  };

  getStatus() {
    const qrPath = path.resolve(__dirname, '../../uploads/qr.png');
    const hasQr = fs.existsSync(qrPath);
    return {
      status: this.status,
      currentCampaignId: this.currentCampaignId,
      qrImageUrl: hasQr ? `/uploads/qr.png?t=${Date.now()}` : null
    };
  }

  async checkSession() {
    const qrPath = path.resolve(__dirname, '../../uploads/qr.png');
    let qrUrl = fs.existsSync(qrPath) ? `/uploads/qr.png?t=${Date.now()}` : null;

    if (!this.browserContext || !this.page || this.page.isClosed()) {
      const userDirSetting = await get('SELECT value FROM settings WHERE key = ?', ['browser_data_dir']);
      const defaultUserDir = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'WhatsAppAutomation', 'browser-data')
        : path.resolve(__dirname, '../../config/browser-data');
      const userDir = userDirSetting ? userDirSetting.value : defaultUserDir;

      const hasSavedSession = fs.existsSync(userDir) && fs.readdirSync(userDir).length > 0;
      return {
        connected: false,
        status: hasSavedSession ? 'Saved Session Available' : 'Not Connected',
        hasSavedSession,
        qrImageUrl: qrUrl,
        browserOpen: false
      };
    }

    try {
      const chatListVisible = await this.page.isVisible('[data-testid="chat-list"], div[role="grid"], #pane-side, header [data-icon="chat"]').catch(() => false);
      if (chatListVisible) {
        if (fs.existsSync(qrPath)) {
          try { fs.unlinkSync(qrPath); } catch (e) {}
        }
        return {
          connected: true,
          status: 'Connected',
          hasSavedSession: true,
          qrImageUrl: null,
          browserOpen: true
        };
      }

      const qrElement = await this.page.$('canvas, [data-ref] canvas, [data-testid="qrcode"]').catch(() => null);
      if (qrElement) {
        const uploadsDir = path.resolve(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        await qrElement.screenshot({ path: qrPath }).catch(() => {});
        qrUrl = `/uploads/qr.png?t=${Date.now()}`;
        return {
          connected: false,
          status: 'Scan QR Code Required',
          hasSavedSession: false,
          qrImageUrl: qrUrl,
          browserOpen: true
        };
      }

      return {
        connected: false,
        status: 'Loading WhatsApp Web...',
        hasSavedSession: false,
        qrImageUrl: qrUrl,
        browserOpen: true
      };
    } catch (e) {
      return {
        connected: false,
        status: 'Not Connected',
        hasSavedSession: false,
        qrImageUrl: null,
        browserOpen: false
      };
    }
  }

  async connectSession() {
    if (!this.browserContext || !this.page || this.page.isClosed()) {
      const userDirSetting = await get('SELECT value FROM settings WHERE key = ?', ['browser_data_dir']);
      const defaultUserDir = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'WhatsAppAutomation', 'browser-data')
        : path.resolve(__dirname, '../../config/browser-data');
      const userDir = userDirSetting ? userDirSetting.value : defaultUserDir;

      const headlessSetting = await get('SELECT value FROM settings WHERE key = ?', ['headless']);
      const isHeadless = headlessSetting ? headlessSetting.value === 'true' : false;

      try {
        this.browserContext = await chromium.launchPersistentContext(userDir, {
          headless: isHeadless,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--window-size=1280,720'
          ]
        });

        const pages = this.browserContext.pages();
        this.page = pages.length > 0 ? pages[0] : await this.browserContext.newPage();
        
        // Asynchronously navigate to WhatsApp Web
        this.page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(err => {
          console.error('WhatsApp Web navigation notice:', err.message);
        });
      } catch (err) {
        console.error('Error launching Chromium context:', err);
        throw new Error(`Failed to launch browser context: ${err.message}`);
      }
    }

    // Quick wait for 1.5s then return current session state immediately
    await new Promise(r => setTimeout(r, 1500));
    return await this.checkSession();
  }

  async startCampaign(campaignId) {
    if (this.status === 'Running') {
      throw new Error('Automation is already running.');
    }

    this.currentCampaignId = campaignId;
    this.status = 'Running';
    this.keepRunning = true;

    // Update campaign status in database
    await run("UPDATE campaigns SET status = 'Sending' WHERE id = ?", [campaignId]);
    await this.log(campaignId, null, 'info', 'Starting campaign automation loop.');

    // Run async loop
    this.runLoop(campaignId).catch(async (error) => {
      console.error('Error in automation loop:', error);
      this.status = 'Failed';
      await run("UPDATE campaigns SET status = 'Stopped' WHERE id = ?", [campaignId]);
      await this.log(campaignId, null, 'error', `Automation loop crashed: ${error.message}`);
      await this.cleanup();
    });
  }

  async pauseCampaign(campaignId) {
    if (this.currentCampaignId !== campaignId || this.status !== 'Running') {
      return;
    }
    this.status = 'Paused';
    this.keepRunning = false;
    await run("UPDATE campaigns SET status = 'Paused' WHERE id = ?", [campaignId]);
    await this.log(campaignId, null, 'info', 'Campaign execution paused by user.');
  }

  async resumeCampaign(campaignId) {
    if (this.currentCampaignId !== campaignId || this.status !== 'Paused') {
      return;
    }
    this.status = 'Running';
    this.keepRunning = true;
    await run("UPDATE campaigns SET status = 'Sending' WHERE id = ?", [campaignId]);
    await this.log(campaignId, null, 'info', 'Campaign execution resumed.');
    
    // Restart loop
    this.runLoop(campaignId).catch(async (error) => {
      console.error('Error in automation loop:', error);
      this.status = 'Failed';
      await run("UPDATE campaigns SET status = 'Stopped' WHERE id = ?", [campaignId]);
      await this.log(campaignId, null, 'error', `Automation loop crashed: ${error.message}`);
      await this.cleanup();
    });
  }

  async stopCampaign(campaignId) {
    if (this.currentCampaignId !== campaignId) {
      return;
    }
    this.status = 'Stopped';
    this.keepRunning = false;
    await run("UPDATE campaigns SET status = 'Stopped' WHERE id = ?", [campaignId]);
    await this.log(campaignId, null, 'info', 'Campaign execution stopped by user.');
    await this.cleanup();
  }

  async cleanup(options = {}) {
    const closeBrowser = typeof options === 'boolean' ? options : (options.closeBrowser !== undefined ? options.closeBrowser : true);
    try {
      if (closeBrowser && this.browserContext) {
        await this.browserContext.close();
        this.browserContext = null;
        this.page = null;
      }
      // Delete QR code file if it exists to clean up
      const qrPath = path.resolve(__dirname, '../../uploads/qr.png');
      if (fs.existsSync(qrPath)) {
        fs.unlinkSync(qrPath);
      }
    } catch (e) {
      console.error('Error closing browser or deleting QR code:', e);
      if (closeBrowser) {
        this.browserContext = null;
        this.page = null;
      }
    } finally {
      this.status = 'Idle';
      this.currentCampaignId = null;
      this.keepRunning = false;
    }
  }

  async logoutSession() {
    await this.cleanup({ closeBrowser: true });

    const userDirSetting = await get('SELECT value FROM settings WHERE key = ?', ['browser_data_dir']);
    const defaultUserDir = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'WhatsAppAutomation', 'browser-data')
      : path.resolve(__dirname, '../../config/browser-data');
    const userDir = userDirSetting ? userDirSetting.value : defaultUserDir;

    if (fs.existsSync(userDir)) {
      try {
        fs.rmSync(userDir, { recursive: true, force: true });
      } catch (e) {
        console.error('Error removing session directory:', e);
      }
    }

    const legacyDir = path.resolve(__dirname, '../../config/browser-data');
    if (fs.existsSync(legacyDir)) {
      try {
        fs.rmSync(legacyDir, { recursive: true, force: true });
      } catch (e) {
        console.error('Error removing legacy browser data dir:', e);
      }
    }
  }

  async initBrowser(campaignId) {
    if (this.browserContext) {
      try {
        if (this.page && !this.page.isClosed() && this.browserContext.isConnected()) {
          await this.log(campaignId, null, 'info', 'Reusing active WhatsApp Web session...');
          return true;
        }
      } catch (e) {
        this.browserContext = null;
        this.page = null;
      }
    }

    // Load directories and headless setting from settings or environment
    const userDirSetting = await get('SELECT value FROM settings WHERE key = ?', ['browser_data_dir']);
    const defaultUserDir = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'WhatsAppAutomation', 'browser-data')
      : path.resolve(__dirname, '../../config/browser-data');
    const userDir = userDirSetting ? userDirSetting.value : defaultUserDir;

    const headlessSetting = await get('SELECT value FROM settings WHERE key = ?', ['headless']);
    const isHeadless = headlessSetting ? headlessSetting.value === 'true' : false;

    await this.log(campaignId, null, 'info', `Launching browser session (Headless: ${isHeadless})...`);

    this.browserContext = await chromium.launchPersistentContext(userDir, {
      headless: isHeadless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1280,720'
      ]
    });

    this.page = await this.browserContext.newPage();
    await this.page.goto('https://web.whatsapp.com');

    await this.log(campaignId, null, 'info', 'Navigated to WhatsApp Web. Checking login status...');

    // Wait for WhatsApp Web loading screen to finish or scan QR
    let isLoggedIn = false;
    const maxAttempts = 180; // 3 minutes total wait time
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      if (!this.keepRunning) return false;

      // Check if logged in (presence of side panel/chat list)
      const chatListVisible = await this.page.isVisible('[data-testid="chat-list"], div[role="grid"], #pane-side').catch(() => false);
      if (chatListVisible) {
        isLoggedIn = true;
        break;
      }

      // Check if QR code is visible to alert user and take screenshot
      const qrVisible = await this.page.isVisible('canvas, [data-testid="qrcode"]').catch(() => false);
      if (qrVisible) {
        // Screenshot QR code for the frontend
        const qrElement = await this.page.$('canvas, [data-testid="qrcode"]');
        if (qrElement) {
          const uploadsDir = path.resolve(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          await qrElement.screenshot({ path: path.join(uploadsDir, 'qr.png') }).catch(() => {});
        }

        if (attempts % 10 === 0) {
          await this.log(campaignId, null, 'warning', 'WhatsApp Web authentication required. Please scan the QR code in the browser window.');
        }
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    if (!isLoggedIn) {
      await this.log(campaignId, null, 'error', 'WhatsApp login timeout. Session expired or QR code not scanned.');
      this.status = 'Paused';
      await run("UPDATE campaigns SET status = 'Paused' WHERE id = ?", [campaignId]);
      await this.cleanup();
      return false;
    }

    // Delete QR code file on successful authentication
    const qrPath = path.resolve(__dirname, '../../uploads/qr.png');
    if (fs.existsSync(qrPath)) {
      try {
        fs.unlinkSync(qrPath);
      } catch (err) {}
    }

    await this.log(campaignId, null, 'info', 'WhatsApp Web authenticated successfully.');
    return true;
  }

  async runLoop(campaignId) {
    // 1. Initialize browser
    const initialized = await this.initBrowser(campaignId);
    if (!initialized) return;

    // 2. Fetch campaign configuration
    const delaySetting = await get('SELECT value FROM settings WHERE key = ?', ['delay_seconds']);
    const delayMs = (delaySetting ? parseInt(delaySetting.value) || 5 : 5) * 1000;

    const attachmentFolderSetting = await get('SELECT value FROM settings WHERE key = ?', ['default_attachments_dir']);
    const defaultAttachmentDir = attachmentFolderSetting ? attachmentFolderSetting.value : path.resolve(__dirname, '../../attachments');

    const sheetUrlSetting = await get('SELECT value FROM settings WHERE key = ?', ['google_sheet_url']);
    const googleSheetUrl = sheetUrlSetting ? sheetUrlSetting.value : '';

    const countryCodeSetting = await get('SELECT value FROM settings WHERE key = ?', ['default_country_code']);
    const defaultCountryCode = countryCodeSetting ? countryCodeSetting.value.replace(/\D/g, '') : '91';

    const maxRetriesSetting = await get('SELECT value FROM settings WHERE key = ?', ['max_retries']);
    const maxRetries = maxRetriesSetting ? Math.max(0, parseInt(maxRetriesSetting.value) || 0) : 2;

    const startTime = Date.now();

    while (this.keepRunning) {
      // Fetch next pending contact for this campaign
      const contact = await get(`
        SELECT * FROM contacts 
        WHERE campaign_id = ? AND status = "Pending" 
        ORDER BY id ASC LIMIT 1
      `, [campaignId]);

      if (!contact) {
        // No more pending contacts, complete campaign
        await this.log(campaignId, null, 'info', 'All messages processed. Waiting for network sync...');
        await new Promise(r => setTimeout(r, 4000));

        await run("UPDATE campaigns SET status = 'Completed' WHERE id = ?", [campaignId]);
        
        // Calculate duration and updates
        const durationSeconds = Math.round((Date.now() - startTime) / 1000);
        await run(`
          UPDATE campaigns 
          SET duration = duration + ?
          WHERE id = ?
        `, [durationSeconds, campaignId]);
        
        await this.log(campaignId, null, 'info', 'Campaign completed successfully. Keeping WhatsApp Web window open for slow network delivery. Please close it manually when finished.');
        await this.cleanup({ closeBrowser: false });
        break;
      }

      // Check pause / stop before starting contact
      if (!this.keepRunning) break;

      await run("UPDATE contacts SET status = 'Sending' WHERE id = ?", [contact.id]);
      await run("UPDATE campaigns SET sent_count = (SELECT COUNT(*) FROM contacts WHERE campaign_id = ? AND status = 'Sent'), failed_count = (SELECT COUNT(*) FROM contacts WHERE campaign_id = ? AND status = 'Failed') WHERE id = ?", [campaignId, campaignId, campaignId]);

      // Normalize phone number (apply default country code if 10-digit number)
      let cleanPhone = contact.phone.replace(/\D/g, '');
      if (cleanPhone.length === 10 && defaultCountryCode) {
        cleanPhone = defaultCountryCode + cleanPhone;
      }

      let success = false;
      let lastError = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (!this.keepRunning) break;

        if (attempt > 0) {
          await this.log(campaignId, contact.id, 'warning', `Retry attempt ${attempt}/${maxRetries} for ${contact.name}...`);
          await new Promise(r => setTimeout(r, 2000));
        }

        try {
          await this.log(campaignId, contact.id, 'info', `Sending message to ${contact.name} (+${cleanPhone})...`);

          // Navigate directly to send message API url (omit text if sending attachment to type in caption box)
          let sendUrl;
          if (contact.attachment_path) {
            sendUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
          } else {
            const encodedText = encodeURIComponent(contact.message_template);
            sendUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`;
          }
          await this.page.goto(sendUrl, { waitUntil: 'domcontentloaded' });

          // Wait for chat to open or invalid number prompt
          let chatLoaded = false;
          let isInvalid = false;

          for (let t = 0; t < 25; t++) {
            if (!this.keepRunning) break;

            // Check if input area loaded (conversation text box, not the left search pane)
            const inputSelector = '#main footer div[role="textbox"][contenteditable="true"], div[data-testid="conversation-footer"] div[role="textbox"][contenteditable="true"], footer div[role="textbox"][contenteditable="true"]';
            const inputLoaded = await this.page.isVisible(inputSelector).catch(() => false);
            if (inputLoaded) {
              chatLoaded = true;
              break;
            }

            // Check if invalid phone number dialog appeared
            const popupText = await this.page.innerText('body').catch(() => '');
            if (
              popupText.toLowerCase().includes('invalid') || 
              popupText.toLowerCase().includes('phone number shared via url') ||
              popupText.toLowerCase().includes('phone number is not on whatsapp') ||
              popupText.toLowerCase().includes('starting chat') === false && popupText.toLowerCase().includes('not on whatsapp')
            ) {
              isInvalid = true;
              break;
            }

            await new Promise(r => setTimeout(r, 1000));
          }

          if (!this.keepRunning) break;

          if (isInvalid) {
            // Dismiss popup dialog if button is present
            const okBtn = await this.page.$('div[role="button"]:has-text("OK"), button:has-text("OK"), button:has-text("Ok")').catch(() => null);
            if (okBtn) {
              await okBtn.click().catch(() => {});
            }
            throw new Error('Phone number is invalid or not registered on WhatsApp.');
          }

          if (!chatLoaded) {
            throw new Error('Chat window loading timed out.');
          }

          // Handle attachment if defined
          if (contact.attachment_path && String(contact.attachment_path).trim()) {
            let rawPath = String(contact.attachment_path).trim().replace(/^["']+|["']+$|^\s*["']|["']\s*$/g, '').trim();
            const fullPath = path.isAbsolute(rawPath) 
              ? rawPath 
              : path.resolve(defaultAttachmentDir, rawPath);

            if (!fs.existsSync(fullPath)) {
              throw new Error(`Attachment file not found at: ${fullPath}`);
            }

            await this.log(campaignId, contact.id, 'info', `Attaching file: ${path.basename(fullPath)}...`);

            const ext = path.extname(fullPath).toLowerCase();
            const isMedia = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov', '.avi', '.3gp', '.mkv', '.m4v'].includes(ext);
            const isPdf = ext === '.pdf';

            // Open attach menu first to ensure hidden file inputs are generated by React in DOM
            const plusBtnSelector = [
              '#main footer button[aria-label="Attach"]',
              '#main footer button[aria-label="attach"]',
              'footer span[data-icon="plus"]',
              'footer span[data-icon="clip"]',
              'footer span[data-icon="attach-menu-plus"]',
              'footer [data-testid="clip"]',
              'footer [data-testid="attach-menu-plus"]',
              'span[data-icon="plus"]',
              'span[data-icon="clip"]',
              'button[aria-label="Attach"]'
            ].join(', ');

            // Target Photos & Videos for media files, Document for PDFs / docs
            const optionSelector = isMedia
              ? '[data-testid="attach-image"], span[data-icon="attach-image"], button[aria-label="Photos & Videos"], button[aria-label="Photos & videos"], span[data-icon="image"]'
              : '[data-testid="attach-document"], span[data-icon="attach-document"], button[aria-label="Document"], span[data-icon="document"]';

            let fileUploaded = false;

            for (let menuAttempt = 0; menuAttempt < 3; menuAttempt++) {
              try {
                const plusBtn = this.page.locator(plusBtnSelector).first();
                if (await plusBtn.isVisible().catch(() => false)) {
                  await plusBtn.click({ force: true });
                  await this.page.waitForTimeout(1000);
                }

                if (await this.page.isVisible(optionSelector).catch(() => false)) {
                  const [fileChooser] = await Promise.all([
                    this.page.waitForEvent('filechooser', { timeout: 10000 }),
                    this.page.click(optionSelector, { force: true })
                  ]);
                  await fileChooser.setFiles(fullPath);
                  fileUploaded = true;
                  break;
                }
              } catch (e) {
                await this.page.keyboard.press('Escape').catch(() => {});
                await this.page.waitForTimeout(500);
              }
            }

            // Direct input fallback if attach menu failed
            if (!fileUploaded) {
              const fileInput = await this.page.$('input[type="file"]');
              if (fileInput) {
                await fileInput.setInputFiles(fullPath);
                fileUploaded = true;
              }
            }

            if (!fileUploaded) {
              throw new Error('Failed to open attach menu or upload file.');
            }

            // Define selectors specifically for the media preview send button across all WhatsApp Web versions
            const previewSendSelector = 'div[role="button"] [data-testid="wds-ic-send-filled"], div[role="button"] span[data-icon="wds-ic-send-filled"], div[role="button"][aria-label*="Send"], [data-testid="send"], span[data-icon="send"], div[role="button"]:has(span[data-icon="send"])';
            const previewSendButton = this.page.locator(previewSendSelector).first();
            await previewSendButton.waitFor({ state: 'visible', timeout: 20000 });

            // Ensure media is NOT sent in HD format (force Standard quality)
            if (isMedia) {
              try {
                const hdButtonSelector = [
                  'button[aria-label*="HD"]',
                  'div[role="button"][aria-label*="HD"]',
                  'span[data-icon="hd"]',
                  'span[data-icon="hd-on"]',
                  'span[data-icon="hd-off"]',
                  'span[data-icon="hd-filled"]',
                  '[data-testid="media-editor-hd-button"]',
                  '[data-testid="hd-button"]'
                ].join(', ');

                const hdButton = this.page.locator(hdButtonSelector).first();
                if (await hdButton.isVisible({ timeout: 1500 }).catch(() => false)) {
                  const isHdActive = await this.page.evaluate(() => {
                    const hdEl = document.querySelector('button[aria-label*="HD"], div[role="button"][aria-label*="HD"], [data-testid="media-editor-hd-button"], [data-testid="hd-button"], span[data-icon="hd-on"], span[data-icon="hd-filled"]');
                    if (!hdEl) return false;
                    const ariaPressed = hdEl.getAttribute('aria-pressed');
                    const ariaChecked = hdEl.getAttribute('aria-checked');
                    const ariaSelected = hdEl.getAttribute('aria-selected');
                    const hasHdActiveIcon = !!document.querySelector('span[data-icon="hd-on"], span[data-icon="hd-filled"], [data-icon="hd-active"]');
                    return ariaPressed === 'true' || ariaChecked === 'true' || ariaSelected === 'true' || hasHdActiveIcon;
                  }).catch(() => false);

                  if (isHdActive) {
                    await this.log(campaignId, contact.id, 'info', 'HD format detected. Deselecting HD quality to send in Standard format...');
                    await hdButton.click({ force: true }).catch(() => {});
                    await this.page.waitForTimeout(500);

                    const standardOptionSelector = [
                      'div[role="button"]:has-text("Standard quality")',
                      'div[role="button"]:has-text("Standard")',
                      'span:has-text("Standard quality")',
                      '[data-testid="hd-option-standard"]',
                      'button:has-text("Standard quality")'
                    ].join(', ');

                    const standardOption = this.page.locator(standardOptionSelector).first();
                    if (await standardOption.isVisible({ timeout: 1000 }).catch(() => false)) {
                      await standardOption.click({ force: true }).catch(() => {});
                      await this.page.waitForTimeout(300);
                    }
                  }
                }
              } catch (hdErr) {
                console.log('HD check warning:', hdErr.message);
              }
            }

            let captionSent = false;
            if (contact.message_template && contact.message_template.trim() && contact.message_template.length <= 1024) {
              const captionSelector = '[data-testid="media-caption-input-container"], div[contenteditable="true"][data-tab="10"]';
              const captionInput = this.page.locator(captionSelector).first();
              if (await captionInput.isVisible().catch(() => false)) {
                await captionInput.click();
                await this.page.waitForTimeout(200);

                await this.page.keyboard.down('Control');
                await this.page.keyboard.press('A');
                await this.page.keyboard.up('Control');
                await this.page.keyboard.press('Backspace');
                await this.page.waitForTimeout(100);

                const lines = contact.message_template.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                  await this.page.keyboard.type(lines[i]);
                  if (i < lines.length - 1) {
                    await this.page.keyboard.press('Shift+Enter');
                  }
                }
                await this.page.waitForTimeout(300);
                captionSent = true;
              }
            }

            // Wait for video/file processing to complete before clicking send
            for (let i = 0; i < 60; i++) {
              const isDisabled = await previewSendButton.getAttribute('aria-disabled').catch(() => 'false') === 'true';
              if (!isDisabled) break;
              await this.page.waitForTimeout(500);
            }

            // Trigger send via click AND Enter key press for 100% reliability
            await previewSendButton.click({ force: true }).catch(() => {});
            await this.page.keyboard.press('Enter').catch(() => {});
            await previewSendButton.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

            // CRITICAL: Wait until WhatsApp Web finishes uploading & sending the media file over the network
            await this.log(campaignId, contact.id, 'info', 'Media dispatched. Waiting for upload completion...');
            for (let waitCount = 0; waitCount < 120; waitCount++) { // Wait up to 60 seconds for large files
              const isUploading = await this.page.evaluate(() => {
                const mainPane = document.querySelector('#main');
                if (!mainPane) return false;
                // Check if clock/pending icon or upload progress spinner is present on the last message
                const clockIcon = mainPane.querySelector('[data-icon="msg-time"], [data-icon="status-time"], [data-testid="msg-time"], span[data-icon="clock"]');
                return !!clockIcon;
              }).catch(() => false);

              if (!isUploading) {
                break;
              }
              await this.page.waitForTimeout(500);
            }

            await this.page.waitForTimeout(2000); // Safety buffer to ensure socket sync
            await this.log(campaignId, contact.id, 'info', 'Attachment sent and fully uploaded.');

            if (!captionSent && contact.message_template && contact.message_template.trim()) {
              await this.log(campaignId, contact.id, 'info', 'Sending message template as a separate message...');
              
              const mainInputSelector = '#main footer div[role="textbox"][contenteditable="true"], div[data-testid="conversation-footer"] div[role="textbox"][contenteditable="true"], footer div[role="textbox"][contenteditable="true"]';
              await this.page.waitForSelector(mainInputSelector, { state: 'visible', timeout: 10000 });
              await this.page.click(mainInputSelector);
              await this.page.waitForTimeout(300);

              const lines = contact.message_template.split(/\r?\n/);
              for (let i = 0; i < lines.length; i++) {
                await this.page.keyboard.type(lines[i]);
                if (i < lines.length - 1) {
                  await this.page.keyboard.press('Shift+Enter');
                }
              }
              await this.page.waitForTimeout(300);

              const sendBtnSelector = '#main [data-testid="conversation-panel-send"], #main [data-testid="send"], #main button:has(span[data-icon="send"]), #main button[aria-label="Send"], span[data-icon="send"], span[data-icon="wds-ic-send-filled"]';
              const sendButton = this.page.locator(sendBtnSelector).first();
              if (await sendButton.isVisible().catch(() => false)) {
                await sendButton.click({ force: true }).catch(() => {});
              }
              await this.page.keyboard.press('Enter');
              await this.page.waitForTimeout(2000);
            }
          } else {
            // Standard send (text prefilled via URL)
            const mainInputSelector = '#main footer div[role="textbox"][contenteditable="true"], div[data-testid="conversation-footer"] div[role="textbox"][contenteditable="true"], footer div[role="textbox"][contenteditable="true"]';
            const mainInput = this.page.locator(mainInputSelector).first();
            if (await mainInput.isVisible().catch(() => false)) {
              await mainInput.click({ force: true }).catch(() => {});
              await this.page.waitForTimeout(300);
            }

            const sendBtnSelector = '#main [data-testid="conversation-panel-send"], #main [data-testid="send"], #main button:has(span[data-icon="send"]), #main button[aria-label="Send"], span[data-icon="send"], span[data-icon="wds-ic-send-filled"], [data-testid="send"]';
            const sendButton = this.page.locator(sendBtnSelector).first();

            // Click send button AND press Enter key to guarantee message dispatch
            if (await sendButton.isVisible().catch(() => false)) {
              await sendButton.click({ force: true }).catch(() => {});
            }
            await this.page.keyboard.press('Enter');
            await this.page.waitForTimeout(1500);

            await this.log(campaignId, contact.id, 'info', 'Message text sent.');
          }

          success = true;
          break; // Break retry loop on success

        } catch (err) {
          lastError = err;
          if (err.message.includes('invalid or not registered')) {
            break; // Do not retry invalid numbers
          }
        }
      }

      if (success) {
        const now = new Date().toISOString();
        await run(`
          UPDATE contacts 
          SET status = 'Sent', sent_at = ? 
          WHERE id = ?
        `, [now, contact.id]);

        await this.log(campaignId, contact.id, 'info', `Message successfully sent to ${contact.name}.`);

        if (googleSheetUrl && contact.row_index) {
          await updateGoogleSheetStatus(googleSheetUrl, contact.row_index, 'Sent');
        }
      } else {
        const errorMsg = lastError ? lastError.message : 'Failed after retries.';
        console.error(`Error sending message to ${contact.name}:`, errorMsg);
        await run(`
          UPDATE contacts 
          SET status = 'Failed', error_reason = ? 
          WHERE id = ?
        `, [errorMsg, contact.id]);

        await this.log(campaignId, contact.id, 'error', `Failed to send to ${contact.name}: ${errorMsg}`);

        if (googleSheetUrl && contact.row_index) {
          await updateGoogleSheetStatus(googleSheetUrl, contact.row_index, 'Failed', errorMsg);
        }

        // Close any residual error popups on WhatsApp page
        const okButton = await this.page.$('div[role="button"]:has-text("OK"), button:has-text("OK"), button:has-text("Ok")').catch(() => null);
        if (okButton) {
          await okButton.click().catch(() => {});
        }
      }

      // Update campaign stats
      await run("UPDATE campaigns SET sent_count = (SELECT COUNT(*) FROM contacts WHERE campaign_id = ? AND status = 'Sent'), failed_count = (SELECT COUNT(*) FROM contacts WHERE campaign_id = ? AND status = 'Failed') WHERE id = ?", [campaignId, campaignId, campaignId]);

      // Delay between messages
      if (this.keepRunning) {
        await this.log(campaignId, null, 'info', `Waiting ${delayMs / 1000} seconds before next contact...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
}

const runnerInstance = new AutomationRunner();
export default runnerInstance;
