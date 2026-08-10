import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get path to service account credentials from env or default config folder
const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS 
  ? path.resolve(__dirname, process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : path.resolve(__dirname, '../config/service-account.json');

/**
 * Extracts Spreadsheet ID and Grid ID (gid) from a standard or published Google Sheets URL.
 */
export function parseSheetUrl(url) {
  if (!url || typeof url !== 'string') return { spreadsheetId: null, gid: '0' };
  
  const cleanUrl = url.trim();

  // Published CSV or HTML links (e.g. /d/e/2PACX-.../pub)
  if (cleanUrl.includes('/pub') || cleanUrl.includes('/pubhtml')) {
    const pubIdMatch = cleanUrl.match(/\/d\/e\/([a-zA-Z0-9-_]+)/);
    if (pubIdMatch) {
      return {
        spreadsheetId: `e/${pubIdMatch[1]}`,
        isPublished: true,
        gid: '0'
      };
    }
  }

  const idRegex = /\/d\/([a-zA-Z0-9-_]+)/;
  const gidRegex = /gid=([0-9]+)/;
  
  const idMatch = cleanUrl.match(idRegex);
  const gidMatch = cleanUrl.match(gidRegex);
  
  return {
    spreadsheetId: idMatch ? idMatch[1] : null,
    gid: gidMatch ? gidMatch[1] : '0'
  };
}

/**
 * Fetches sheet data. Uses local service account credentials if available,
 * otherwise falls back to fetching the sheet as a public CSV export.
 */
export async function fetchGoogleSheet(url) {
  const { spreadsheetId, gid } = parseSheetUrl(url);
  if (!spreadsheetId) {
    throw new Error('Invalid Google Sheets URL. Please check the URL format.');
  }

  // Attempt to use Service Account credentials if they exist
  if (fs.existsSync(credsPath)) {
    try {
      console.log('Credentials file found. Authenticating via Google API...');
      const auth = new google.auth.GoogleAuth({
        keyFile: credsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });
      
      // Get the sheet metadata to find the sheet name
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const targetSheet = meta.data.sheets.find(s => String(s.properties.sheetId) === String(gid)) || meta.data.sheets[0];
      const sheetName = targetSheet.properties.title;

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:Z`,
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        throw new Error('No data found in the spreadsheet.');
      }

      // Convert arrays of rows into objects
      const headers = rows[0].map(h => (h !== undefined && h !== null ? String(h).trim() : ''));
      const jsonData = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          if (header) {
            obj[header] = row[index] !== undefined ? row[index] : '';
          }
        });
        return obj;
      });

      return parseJsonData(jsonData);
    } catch (apiError) {
      console.warn('Service Account API fetch failed, falling back to public export:', apiError.message);
    }
  }

  // Public CSV export fallback
  try {
    console.log('Fetching sheet as public CSV export...');
    let exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    if (spreadsheetId.startsWith('e/')) {
      exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/pub?output=csv`;
    }

    const res = await fetch(exportUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/csv,text/plain,*/*'
      },
      redirect: 'follow'
    });

    if (!res.ok) {
      throw new Error(`Google returned HTTP status ${res.status} (${res.statusText})`);
    }

    const csvText = await res.text();

    // Detect HTML login/permission page response
    const cleanCsvText = csvText.trim().toLowerCase();
    if (
      cleanCsvText.startsWith('<!doctype html') ||
      cleanCsvText.startsWith('<html') ||
      cleanCsvText.includes('google-signin') ||
      cleanCsvText.includes('servicelogin') ||
      cleanCsvText.includes('accounts.google.com')
    ) {
      throw new Error(
        'Google Sheet access denied. Please open your Google Sheet -> Click "Share" (top right) -> Change access to "Anyone with the link can view".'
      );
    }

    // Parse CSV via xlsx — raw:true to preserve full numeric precision
    const workbook = xlsx.read(csvText, { type: 'string', cellText: true, cellNF: true });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Could not parse Google Sheet content.');
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet, { raw: true, defval: '' });

    if (!jsonData || jsonData.length === 0) {
      throw new Error('No contact data found in the spreadsheet.');
    }

    return parseJsonData(jsonData);
  } catch (error) {
    console.error('Error fetching public Google Sheet:', error);
    throw new Error(
      error.message.includes('Anyone with the link can view') 
        ? error.message 
        : `Failed to import Google Sheet: ${error.message}`
    );
  }
}

/**
 * Updates status of a contact in the Google Sheet.
 * Requires Google Service Account Credentials with Editor access to the spreadsheet.
 */
export async function updateGoogleSheetStatus(url, rowIndex, status, errorReason = '') {
  if (!fs.existsSync(credsPath)) {
    console.warn('Cannot write back status to Google Sheets: credentials file not found.');
    return false;
  }

  const { spreadsheetId, gid } = parseSheetUrl(url);
  if (!spreadsheetId) return false;

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: credsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Get sheets metadata to map gid to title
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const targetSheet = meta.data.sheets.find(s => String(s.properties.sheetId) === String(gid)) || meta.data.sheets[0];
    const sheetName = targetSheet.properties.title;

    // Get header row to locate the "Status" column
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:ZZ1`,
    });

    const headers = headerResponse.data.values ? headerResponse.data.values[0] : [];
    let statusColIdx = headers.findIndex(h => String(h).trim().toLowerCase() === 'status');
    let errorColIdx = headers.findIndex(h => String(h).trim().toLowerCase() === 'error reason' || String(h).trim().toLowerCase() === 'error_reason');

    if (statusColIdx === -1) {
      statusColIdx = headers.length;
      const colLetter = getColumnLetter(statusColIdx);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!${colLetter}1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Status']] }
      });
    }

    const statusColLetter = getColumnLetter(statusColIdx);
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${statusColLetter}${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status]] }
    });

    if (status === 'Failed' && errorReason) {
      if (errorColIdx === -1) {
        errorColIdx = headers.length + (statusColIdx === headers.length ? 1 : 0);
        const colLetter = getColumnLetter(errorColIdx);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!${colLetter}1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [['Error Reason']] }
        });
      }
      const errorColLetter = getColumnLetter(errorColIdx);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!${errorColLetter}${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[errorReason]] }
      });
    }

    console.log(`Successfully updated row ${rowIndex} status to "${status}" on Google Sheet.`);
    return true;
  } catch (error) {
    console.error('Error updating Google Sheet status:', error);
    return false;
  }
}

/**
 * Converts any cell value to a clean, full-precision string.
 */
function safeStringify(val) {
  if (val === null || val === undefined) return '';

  if (typeof val === 'number') {
    if (Number.isFinite(val) && Number.isInteger(val) && Math.abs(val) <= Number.MAX_SAFE_INTEGER) {
      return val.toString();
    }
    if (Number.isFinite(val)) {
      return BigInt(Math.round(val)).toString();
    }
    return String(val);
  }

  const str = String(val).trim();
  if (/^-?\d+(\.\d+)?[eE][+\-]?\d+$/.test(str)) {
    try {
      const n = Number(str);
      if (Number.isFinite(n)) {
        return BigInt(Math.round(n)).toString();
      }
    } catch {
      // Fall through
    }
  }

  return str;
}

/**
 * Normalizes rows into schema-aligned contact objects.
 */
function parseJsonData(rows) {
  if (!Array.isArray(rows)) return [];

  return rows
    .filter(row => row && typeof row === 'object')
    .map((row, idx) => {
      const normalizedRow = {};
      const placeholderData = {};

      Object.entries(row).forEach(([key, val]) => {
        const trimmedKey = key !== undefined && key !== null ? String(key).trim() : '';
        if (!trimmedKey) return;
        const safeVal = safeStringify(val);
        normalizedRow[trimmedKey.toLowerCase().replace(/[\s_-]+/g, '')] = safeVal;
        placeholderData[trimmedKey] = safeVal;
      });

      const findVal = (keys) => {
        for (const k of keys) {
          const normK = k.replace(/[\s_-]+/g, '');
          if (normalizedRow[normK] !== undefined && normalizedRow[normK] !== '') {
            return normalizedRow[normK];
          }
        }
        return '';
      };

      const name = findVal(['name', 'contact name', 'recipient', 'recipient name', 'full name', 'customer', 'person', 'client']) || `Contact ${idx + 1}`;
      let phone = findVal(['phone', 'phone number', 'phone no', 'phonenumber', 'mobile', 'mobile number', 'mobile no', 'contact', 'contact number', 'whatsapp', 'tel', 'telephone']);
      const company = findVal(['company', 'organization', 'org', 'business']);
      const message = findVal(['message', 'text', 'content', 'body']);
      const attachment = findVal(['attachment', 'file', 'media', 'document']);

      if (/[eE][+\-]?\d+/.test(phone)) {
        try {
          phone = BigInt(Math.round(Number(phone))).toString();
        } catch {
          const num = Number(phone);
          if (!isNaN(num)) phone = Math.round(num).toString();
        }
      }

      const hasPlus = phone.startsWith('+');
      phone = phone.replace(/\D/g, '');
      if (hasPlus) phone = '+' + phone;

      return {
        name,
        phone,
        company,
        message,
        attachment,
        placeholderData,
        rowIndex: idx + 2
      };
    });
}

/**
 * Converts zero-based column index to letter (0 -> A, 25 -> Z, 26 -> AA, etc.)
 */
function getColumnLetter(idx) {
  let temp = idx;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}
