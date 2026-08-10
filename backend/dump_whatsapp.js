import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function dump() {
  console.log('Launching browser persistent context...');
  const userDir = path.resolve('c:/Users/ayush/OneDrive/Desktop/whatsapp-automation/config/browser-data');
  const context = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await context.newPage();
  console.log('Navigating to WhatsApp Web...');
  await page.goto('https://web.whatsapp.com');

  console.log('Waiting for login...');
  let loggedIn = false;
  for (let i = 0; i < 30; i++) {
    const visible = await page.isVisible('[data-testid="chat-list"], div[role="grid"]').catch(() => false);
    if (visible) {
      loggedIn = true;
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!loggedIn) {
    console.error('Not logged in!');
    await context.close();
    return;
  }

  console.log('Logged in. Navigating to contact...');
  const sendUrl = 'https://web.whatsapp.com/send?phone=918605851775';
  await page.goto(sendUrl);

  console.log('Waiting for chat window...');
  let chatLoaded = false;
  for (let i = 0; i < 30; i++) {
    const inputLoaded = await page.isVisible('#main footer div[role="textbox"][contenteditable="true"]').catch(() => false);
    if (inputLoaded) {
      chatLoaded = true;
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!chatLoaded) {
    console.error('Chat window failed to load.');
    await context.close();
    return;
  }

  console.log('Chat loaded. Scoping attach button to footer...');
  const plusBtnSelector = 'footer button[aria-label="Attach"], footer [data-testid="plus-rounded"], footer [data-testid="clip"], footer [data-testid="attach-menu-plus"]';
  
  // Let's print how many matches we find in the DOM for this selector
  const matches = await page.$$(plusBtnSelector);
  console.log(`Found ${matches.length} attach buttons matching selector in footer.`);
  
  if (matches.length > 0) {
    console.log('Clicking the first match...');
    await matches[0].click({ force: true });
  } else {
    console.log('No footer attach buttons found. Clicking fallback plusBtnSelector...');
    const fallback = 'button[aria-label="Attach"], [data-testid="clip"], [data-testid="attach-menu-plus"]';
    await page.click(fallback, { force: true });
  }

  console.log('Waiting 3 seconds for menu options to render...');
  await page.waitForTimeout(3000);

  // Find all elements containing "document" or "attach-"
  const elements = await page.$$eval('button, div[role="button"], span[data-icon], li', (els) => {
    return els.map(el => {
      return {
        tagName: el.tagName,
        text: el.innerText ? el.innerText.trim() : '',
        testid: el.getAttribute('data-testid') || '',
        icon: el.getAttribute('data-icon') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        role: el.getAttribute('role') || ''
      };
    });
  });

  const filtered = elements.filter(e => 
    e.testid.includes('attach') || 
    e.icon.includes('attach') || 
    e.ariaLabel.includes('Attach') || 
    e.text.toLowerCase().includes('document')
  );

  console.log('Attach options found after click:', JSON.stringify(filtered, null, 2));

  await context.close();
  console.log('Closed.');
}

dump().catch(console.error);
