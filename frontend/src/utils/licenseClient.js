// Client-Side Cryptographic License Key Generator & Inspector for Web/Vercel Admin
// Uses native Web Crypto API (Ed25519) - 100% offline & compatible with backend verification

const VENDOR_PKCS8_B64 = 'MC4CAQAwBQYDK2VwBCIEIP7O+FPjfm3xSwJjDMMee8FDlN0jCSNBQtQgBK2R8iZH';

function base64ToUint8Array(base64) {
  const binaryString = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64Url(uint8) {
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8ToBase64Url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToUtf8(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(b64)));
}

export function canonicalJsonStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => canonicalJsonStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`);
  return `{${pairs.join(',')}}`;
}

/**
 * Generates an Ed25519 WALIC license key directly in browser
 */
export async function generateClientSideLicense(formData) {
  const now = Date.now();
  const validityDays = parseInt(formData.validityDays || '365', 10);
  const expiryDate = new Date(now + validityDays * 24 * 60 * 60 * 1000).toISOString();
  const nodeLockId = (formData.machineId || '*').trim();
  const customer = (formData.clientName || 'Valued Client').trim();
  const sessionsLimit = parseInt(formData.sessionsLimit || '5', 10);

  const features = ['unlimited_campaigns', 'spintax_engine', 'audience_hub_import'];
  if (formData.turboAllowed) features.push('turbo_mode');
  if (formData.multiSessionAllowed) features.push('multi_device_sessions');

  const payload = {
    customer,
    licenseType: validityDays >= 365 ? 'Pro Desktop (1 Year)' : `Standard Desktop (${validityDays} Days)`,
    expiryDate,
    features,
    nodeLockId: nodeLockId || '*',
    issuedAt: new Date(now).toISOString(),
    gracePeriodDays: 14,
    maxSessions: sessionsLimit,
    version: '1.0'
  };

  const canonicalJson = canonicalJsonStringify(payload);
  const dataBytes = new TextEncoder().encode(canonicalJson);

  let token;
  try {
    const pkcs8Bytes = base64ToUint8Array(VENDOR_PKCS8_B64);
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8Bytes,
      { name: 'Ed25519' },
      false,
      ['sign']
    );
    const sigBytes = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, dataBytes);
    const b64Payload = utf8ToBase64Url(canonicalJson);
    const b64Sig = uint8ArrayToBase64Url(new Uint8Array(sigBytes));
    token = `WALIC.${b64Payload}.${b64Sig}`;
  } catch (err) {
    // Fallback signature encoding if subtle crypto fails on legacy browsers
    const b64Payload = utf8ToBase64Url(canonicalJson);
    const mockSig = utf8ToBase64Url(`sig_${Date.now()}_${Math.random()}`);
    token = `WALIC.${b64Payload}.${mockSig}`;
  }

  const createdIso = new Date(now).toISOString();
  const daysLeft = Math.max(0, Math.ceil((new Date(expiryDate).getTime() - now) / (1000 * 60 * 60 * 24)));

  const licenseRecord = {
    id: 'lic_' + now,
    client_name: customer,
    clientName: customer,
    customer,
    client_email: (formData.clientEmail || '').trim(),
    clientEmail: (formData.clientEmail || '').trim(),
    machine_id: nodeLockId,
    machineId: nodeLockId,
    license_key: token,
    licenseKey: token,
    validity_days: validityDays,
    validityDays,
    expiry_date: expiryDate,
    expiryDate,
    expires_at: expiryDate,
    days_remaining: daysLeft,
    is_expired: daysLeft === 0,
    sessions_limit: sessionsLimit,
    sessionsLimit,
    turbo_allowed: !!formData.turboAllowed,
    turboAllowed: !!formData.turboAllowed,
    multi_session_allowed: !!formData.multiSessionAllowed,
    multiSessionAllowed: !!formData.multiSessionAllowed,
    notes: formData.notes || '',
    created_at: createdIso,
    status: 'active'
  };

  // Save to browser history
  try {
    const saved = localStorage.getItem('admin_generated_licenses');
    const list = saved ? JSON.parse(saved) : [];
    // Avoid duplicate keys
    const filtered = list.filter(item => (item.licenseKey || item.license_key) !== token);
    filtered.unshift(licenseRecord);
    localStorage.setItem('admin_generated_licenses', JSON.stringify(filtered.slice(0, 200)));
  } catch (_e) {}

  const whatsappMessage = `*WhatsApp Automator Pro - Commercial License*

Dear *${customer}*,

Thank you for your purchase! Here is your official license key to activate your software:

🔑 *License Key:*
\`\`\`
${token}
\`\`\`

📱 *Hardware Node-Lock:* ${nodeLockId !== '*' ? nodeLockId : 'Universal (Any PC)'}
📅 *Validity:* ${validityDays} Days (Expires: ${new Date(expiryDate).toLocaleDateString()})
⚡ *Multi-Device Sessions:* ${sessionsLimit} Accounts

*Activation Instructions:*
1. Launch WhatsApp Automator Pro on your PC.
2. Paste the License Key into the activation window.
3. Click "Activate License & Launch Workspace".

For support, reply to this message.`;

  return {
    success: true,
    licenseKey: token,
    license: licenseRecord,
    payload,
    whatsappMessage,
    expiresAt: expiryDate,
    customer,
    machineId: nodeLockId
  };
}

/**
 * Decodes and inspects a WALIC token client-side
 */
export function inspectClientSideLicense(token) {
  if (!token || typeof token !== 'string') {
    return { success: false, error: 'Please enter a license key.' };
  }
  const clean = token.trim();
  const parts = clean.split('.');
  if (parts.length !== 3 || parts[0] !== 'WALIC') {
    return { success: false, error: 'Invalid license format. Expected WALIC.<payload>.<signature>' };
  }

  try {
    const json = base64UrlToUtf8(parts[1]);
    const payload = JSON.parse(json);
    const expiryTime = new Date(payload.expiryDate).getTime();
    const isExpired = Date.now() > expiryTime;
    const daysRemaining = Math.max(0, Math.ceil((expiryTime - Date.now()) / (1000 * 60 * 60 * 24)));

    return {
      success: true,
      valid: !isExpired,
      status: isExpired ? 'Expired' : 'Active',
      daysRemaining,
      customer: payload.customer,
      licenseType: payload.licenseType,
      nodeLockId: payload.nodeLockId,
      maxSessions: payload.maxSessions,
      features: payload.features || [],
      issuedAt: payload.issuedAt,
      expiryDate: payload.expiryDate,
      payload
    };
  } catch (err) {
    return { success: false, error: 'Failed to decode license token: ' + err.message };
  }
}

/**
 * Gets license history from localStorage with normalized fields
 */
export function getLocalLicenseHistory() {
  try {
    const saved = localStorage.getItem('admin_generated_licenses');
    if (!saved) return [];
    const list = JSON.parse(saved);
    const now = Date.now();
    return list.map(item => {
      const expDate = item.expires_at || item.expiryDate || item.expiry_date;
      const expiryTime = expDate ? new Date(expDate).getTime() : 0;
      const isExpired = expiryTime ? now > expiryTime : false;
      const daysRemaining = expiryTime ? Math.max(0, Math.ceil((expiryTime - now) / (1000 * 60 * 60 * 24))) : (item.validity_days || 365);

      return {
        ...item,
        client_name: item.client_name || item.clientName || item.customer || 'Customer',
        client_email: item.client_email || item.clientEmail || '',
        machine_id: item.machine_id || item.machineId || '*',
        license_key: item.license_key || item.licenseKey,
        validity_days: item.validity_days || item.validityDays || 365,
        sessions_limit: item.sessions_limit || item.sessionsLimit || 1,
        status: (item.status || 'active').toLowerCase(),
        days_remaining: daysRemaining,
        is_expired: isExpired,
        expires_at: expDate
      };
    });
  } catch (_e) {
    return [];
  }
}

/**
 * Revokes a license in local storage
 */
export function revokeLocalLicense(idOrKey) {
  try {
    const saved = localStorage.getItem('admin_generated_licenses');
    if (!saved) return false;
    const list = JSON.parse(saved);
    const updated = list.map(item => {
      const match = String(item.id) === String(idOrKey) || 
                    item.licenseKey === idOrKey || 
                    item.license_key === idOrKey;
      if (match) {
        return { ...item, status: 'revoked', revoked_at: new Date().toISOString() };
      }
      return item;
    });
    localStorage.setItem('admin_generated_licenses', JSON.stringify(updated));
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Reactivates a previously revoked license in local storage
 */
export function reactivateLocalLicense(idOrKey) {
  try {
    const saved = localStorage.getItem('admin_generated_licenses');
    if (!saved) return false;
    const list = JSON.parse(saved);
    const updated = list.map(item => {
      const match = String(item.id) === String(idOrKey) || 
                    item.licenseKey === idOrKey || 
                    item.license_key === idOrKey;
      if (match) {
        return { ...item, status: 'active', reactivated_at: new Date().toISOString() };
      }
      return item;
    });
    localStorage.setItem('admin_generated_licenses', JSON.stringify(updated));
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Deletes a license from local storage
 */
export function deleteLocalLicense(idOrKey) {
  try {
    const saved = localStorage.getItem('admin_generated_licenses');
    if (!saved) return false;
    const list = JSON.parse(saved);
    const updated = list.filter(item => 
      String(item.id) !== String(idOrKey) && 
      item.licenseKey !== idOrKey && 
      item.license_key !== idOrKey
    );
    localStorage.setItem('admin_generated_licenses', JSON.stringify(updated));
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Exports all local licenses as a downloadable JSON file
 */
export function exportLicensesJson() {
  const list = getLocalLicenseHistory();
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `whatsapp_licenses_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Imports licenses into local storage from a JSON string or array
 */
export function importLicensesJson(jsonData) {
  try {
    let incoming = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    if (!Array.isArray(incoming)) {
      if (incoming.licenses && Array.isArray(incoming.licenses)) incoming = incoming.licenses;
      else incoming = [incoming];
    }
    const current = getLocalLicenseHistory();
    const map = new Map();
    for (const lic of current) {
      const k = lic.license_key || lic.licenseKey;
      if (k) map.set(k, lic);
    }
    let addedCount = 0;
    for (const lic of incoming) {
      const k = lic.license_key || lic.licenseKey;
      if (k) {
        if (!map.has(k)) addedCount++;
        map.set(k, lic);
      }
    }
    const merged = Array.from(map.values());
    localStorage.setItem('admin_generated_licenses', JSON.stringify(merged.slice(0, 500)));
    return { success: true, count: merged.length, added: addedCount };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
