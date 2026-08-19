import xlsx from 'xlsx';

/**
 * Converts any Excel cell value to a clean, full-precision string.
 *
 * Problem: Excel stores phone numbers like 919371234567 as numeric cells.
 * The xlsx library returns them as JS numbers, which can appear as:
 *   - Scientific notation strings: "9.19E+11"  (when raw:false / display format)
 *   - JS number: 919371234567  (when raw:true)
 *
 * Solution: Read raw numeric values (full precision), then convert to string
 * using BigInt for integers, avoiding floating-point rounding or display truncation.
 *
 * @param {*} val - Raw cell value from xlsx
 * @returns {string} Clean string representation
 */
function safeStringify(val) {
  if (val === null || val === undefined) return '';

  // If xlsx returned a raw JS number (raw: true mode)
  if (typeof val === 'number') {
    // Integer within safe range → direct conversion, no precision loss
    if (Number.isFinite(val) && Number.isInteger(val) && Math.abs(val) <= Number.MAX_SAFE_INTEGER) {
      return val.toString();
    }
    // Non-integer (e.g. floating point noise from large number): round to nearest integer
    if (Number.isFinite(val)) {
      return BigInt(Math.round(val)).toString();
    }
    return String(val);
  }

  const str = String(val).trim();

  // Handle scientific notation strings like "9.19E+11" or "9.18e+11"
  // These appear when xlsx returns the Excel display-formatted value
  if (/^-?\d+(\.\d+)?[eE][+\-]?\d+$/.test(str)) {
    try {
      const n = Number(str);
      if (Number.isFinite(n)) {
        return BigInt(Math.round(n)).toString();
      }
    } catch {
      // Fall through to return original string
    }
  }

  return str;
}

/**
 * Parses an Excel or CSV file into a list of contact objects.
 * Supports .xlsx, .xls, and .csv files.
 * Reads raw numeric values (NOT display-formatted text) to preserve full precision
 * for large numbers like phone numbers that Excel shows in scientific notation.
 *
 * @param {string} filePath - Absolute path to the spreadsheet file
 * @returns {Array<Object>} List of parsed contact objects
 */
export function parseSpreadsheet(filePath) {
  try {
    // cellText/cellNF are kept for metadata but we use raw:true to get numeric values at full precision
    const workbook = xlsx.readFile(filePath, { cellText: true, cellNF: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // raw: true → returns actual numeric values (not display strings like "9.19E+11")
    const jsonData = xlsx.utils.sheet_to_json(worksheet, { raw: true, defval: '' });

    return parseJsonData(jsonData);
  } catch (error) {
    console.error('Error parsing spreadsheet file:', error);
    throw new Error('Failed to parse spreadsheet: ' + error.message);
  }
}

/**
 * Parses a buffer of Excel or CSV file.
 * @param {Buffer} buffer - File buffer
 * @returns {Array<Object>} List of parsed contact objects
 */
export function parseSpreadsheetBuffer(buffer) {
  try {
    const workbook = xlsx.read(buffer, { type: 'buffer', cellText: true, cellNF: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // raw: true → returns actual numeric values (not display strings like "9.19E+11")
    const jsonData = xlsx.utils.sheet_to_json(worksheet, { raw: true, defval: '' });

    return parseJsonData(jsonData);
  } catch (error) {
    console.error('Error parsing spreadsheet buffer:', error);
    throw new Error('Failed to parse spreadsheet: ' + error.message);
  }
}

/**
 * Helper to process JSON rows from xlsx to structured contact objects.
 * Uses safeStringify() on every cell value to handle:
 *   - Numbers stored as JS number  → "919371234567"
 *   - Numbers in scientific notation string "9.19E+11" → "919000000000"
 *   - Regular text cells           → unchanged
 */
function parseJsonData(rows) {
  return rows.map((row, idx) => {
    // Normalize keys to lowercase for flexible column naming, but also preserve case for placeholder replacement
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

    // Safety net: if scientific notation somehow still slips through after safeStringify
    // (e.g. edge case with very unusual cell types), catch and convert here too
    if (/[eE][+\-]?\d+/.test(phone)) {
      try {
        phone = BigInt(Math.round(Number(phone))).toString();
      } catch {
        const num = Number(phone);
        if (!isNaN(num)) phone = Math.round(num).toString();
      }
    }

    // Clean phone number (keep only digits and leading +)
    const hasPlus = phone.startsWith('+');
    phone = phone.replace(/\D/g, '');
    if (hasPlus) phone = '+' + phone;

    return {
      name,
      phone,
      company,
      message,
      attachment,
      placeholderData, // Store all columns for customizable placeholders
      rowIndex: idx + 2 // 1-indexed, +1 for header row = index of data row in spreadsheet
    };
  });
}

/**
 * Parses raw text input (e.g. line-separated phone numbers or CSV text blocks)
 * into a list of structured contact objects.
 * @param {string} text 
 * @returns {Array<Object>}
 */
export function parseRawTextContacts(text) {
  if (!text || !text.trim()) return [];

  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (rawLines.length === 0) return [];

  const firstLine = rawLines[0];
  const isDelimiterCSV = firstLine.includes(',') || firstLine.includes('\t') || firstLine.includes(';');
  const delimiter = firstLine.includes(',') ? ',' : firstLine.includes('\t') ? '\t' : ';';

  const lowerFirst = firstLine.toLowerCase();
  const hasHeader = isDelimiterCSV && (lowerFirst.includes('phone') || lowerFirst.includes('mobile') || lowerFirst.includes('name'));

  let headers = [];
  let dataLines = rawLines;

  if (hasHeader) {
    headers = firstLine.split(delimiter).map(h => h.trim());
    dataLines = rawLines.slice(1);
  }

  const contacts = [];

  dataLines.forEach((line, idx) => {
    if (isDelimiterCSV) {
      const parts = line.split(delimiter).map(p => p.trim());
      if (hasHeader) {
        const rowObj = {};
        headers.forEach((h, i) => {
          rowObj[h] = parts[i] || '';
        });
        const parsedList = parseJsonData([rowObj]);
        if (parsedList.length > 0 && parsedList[0].phone) {
          contacts.push({ ...parsedList[0], rowIndex: idx + 1 });
        }
      } else {
        let name = '';
        let phone = '';
        let company = '';

        if (parts.length >= 2) {
          if (/^\+?\d{7,15}$/.test(parts[0].replace(/\s/g, ''))) {
            phone = parts[0];
            name = parts[1];
            company = parts[2] || '';
          } else {
            name = parts[0];
            phone = parts[1];
            company = parts[2] || '';
          }
        } else if (parts.length === 1) {
          phone = parts[0];
          name = `Contact ${idx + 1}`;
        }

        const hasPlus = phone.startsWith('+');
        const cleanPhone = phone.replace(/\D/g, '');
        const finalPhone = hasPlus ? '+' + cleanPhone : cleanPhone;

        if (finalPhone) {
          contacts.push({
            name: name || `Contact ${idx + 1}`,
            phone: finalPhone,
            company,
            message: '',
            attachment: '',
            placeholderData: { name: name || `Contact ${idx + 1}`, phone: finalPhone, company },
            rowIndex: idx + 1
          });
        }
      }
    } else {
      const hasPlus = line.startsWith('+');
      const cleanPhone = line.replace(/\D/g, '');
      const finalPhone = hasPlus ? '+' + cleanPhone : cleanPhone;

      if (finalPhone.length >= 5) {
        contacts.push({
          name: `Contact ${idx + 1}`,
          phone: finalPhone,
          company: '',
          message: '',
          attachment: '',
          placeholderData: { name: `Contact ${idx + 1}`, phone: finalPhone },
          rowIndex: idx + 1
        });
      }
    }
  });

  return contacts;
}

/**
 * Sanitizes and deduplicates a list of contacts.
 * Cleans phone numbers, applies default country code if 10 digits, and removes duplicate numbers.
 * @param {Array<Object>} contacts 
 * @param {string} defaultCountryCode 
 * @returns {Array<Object>}
 */
export function sanitizeContactsList(contacts = [], defaultCountryCode = '91') {
  if (!Array.isArray(contacts)) return [];
  const cleanCc = String(defaultCountryCode || '91').replace(/\D/g, '');

  const seenPhones = new Set();
  const sanitized = [];

  for (const c of contacts) {
    if (!c || !c.phone) continue;

    let phone = String(c.phone).trim();
    const hasPlus = phone.startsWith('+');
    let cleanDigits = phone.replace(/\D/g, '');

    // Strip international 00 prefix (e.g. 0091 -> 91)
    if (cleanDigits.startsWith('00')) {
      cleanDigits = cleanDigits.slice(2);
    }
    // Strip leading trunk zero (e.g. 09876543210 -> 9876543210)
    if (cleanDigits.length === 11 && cleanDigits.startsWith('0')) {
      cleanDigits = cleanDigits.slice(1);
    }

    if (!cleanDigits || cleanDigits.length < 5) continue;

    // Apply default country code if 10 digits long and no country code was included
    if (cleanDigits.length === 10 && cleanCc) {
      cleanDigits = cleanCc + cleanDigits;
    }

    const finalPhone = hasPlus ? '+' + cleanDigits : cleanDigits;

    if (seenPhones.has(cleanDigits)) continue;
    seenPhones.add(cleanDigits);

    const name = (c.name && String(c.name).trim()) || 'Recipient';
    const company = (c.company && String(c.company).trim()) || '';
    const placeholderData = c.placeholderData && typeof c.placeholderData === 'object' 
      ? { name, phone: finalPhone, company, ...c.placeholderData }
      : { name, phone: finalPhone, company };

    sanitized.push({
      ...c,
      name,
      phone: finalPhone,
      company,
      placeholderData
    });
  }

  return sanitized;
}


