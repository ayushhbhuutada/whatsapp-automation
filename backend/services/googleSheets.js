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
 * Extracts Spreadsheet ID and Grid ID (gid) from a standard Google Sheets URL.
 */
export function parseSheetUrl(url) {
  const idRegex = /\/d\/([a-zA-Z0-9-_]+)/;
  const gidRegex = /gid=([0-9]+)/;
  
  const idMatch = url.match(idRegex);
  const gidMatch = url.match(gidRegex);
  
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
    throw new Error('Invalid Google Sheets URL.');
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
      // Find sheet with matching gid or default to first sheet
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
      const headers = rows[0].map(h => h.trim());
      const jsonData = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index] !== undefined ? row[index] : '';
        });
        return obj;
      });

      return parseJsonData(jsonData);
    } catch (apiError) {
      console.warn('API fetch failed, falling back to public export:', apiError.message);
    }
  }

  // Public CSV export fallback
  try {
    console.log('Fetching sheet as public CSV export...');
    const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    const res = await fetch(exportUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch CSV: ${res.statusText}`);
    }
    const csvText = await res.text();
    
    // Parse CSV via xlsx — raw:true to preserve full numeric precision
    const workbook = xlsx.read(csvText, { type: 'string', cellText: true, cellNF: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet, { raw: true, defval: '' });

    return parseJsonData(jsonData);
  } catch (error) {
    console.error('Error fetching public Google Sheet:', error);
    throw new Error('Failed to read Google Sheet. Make sure the sheet is shared as "Anyone with the link can view". Error: ' + error.message);
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
    let statusColIdx = headers.findIndex(h => h.trim().toLowerCase() === 'status');
    let errorColIdx = headers.findIndex(h => h.trim().toLowerCase() === 'error reason' || h.trim().toLowerCase() === 'error_reason');

    if (statusColIdx === -1) {
      // If Status column doesn't exist, we append it at the next available column
      statusColIdx = headers.length;
      const colLetter = getColumnLetter(statusColIdx);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!${colLetter}1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Status']] }
      });
    }

    // Convert 0-indexed column integer to spreadsheet column letters
    const statusColLetter = getColumnLetter(statusColIdx);
    
    // Update the cell
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${statusColLetter}${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status]] }
    });

    // If failed, write the error reason
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
 * Handles JS numbers, scientific notation strings like "9.19E+11",
 * and plain text — ensuring phone numbers are never truncated.
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
  // Handle scientific notation strings like "9.19E+11" or "9.18e+11"
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
 * Uses safeStringify() on every value to handle scientific notation
 * and large numbers (e.g. phone numbers) without precision loss.
 */
function parseJsonData(rows) {
  return rows.map((row, idx) => {
    const normalizedRow = {};
    const placeholderData = {};

    Object.entries(row).forEach(([key, val]) => {
      const trimmedKey = key.trim();
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

    // Safety net: catch any scientific notation that slipped through safeStringify
    if (/[eE][+\-]?\d+/.test(phone)) {
      try {
        phone = BigInt(Math.round(Number(phone))).toString();
      } catch {
        const num = Number(phone);
        if (!isNaN(num)) phone = Math.round(num).toString();
      }
    }

    // Clean phone number — preserve leading + if present
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
      rowIndex: idx + 2 // 1-indexed, +1 for headers
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
