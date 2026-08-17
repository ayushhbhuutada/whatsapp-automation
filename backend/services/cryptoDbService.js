import crypto from 'node:crypto';
import { getMachineId } from './hardwareIdService.js';

/**
 * Encrypts a plaintext string using AES-256-GCM keyed to hardware machineId
 * Output format: enc:v1:<salt_hex>:<iv_hex>:<tag_hex>:<ciphertext_hex>
 * 
 * @param {string} text Plaintext to encrypt
 * @param {string} [machineId] Optional Machine ID (defaults to current hardware ID)
 * @returns {string} Encrypted format string
 */
export function encryptField(text, machineId = getMachineId()) {
  if (text === null || text === undefined) {
    return text;
  }
  const strText = String(text);
  if (strText.length === 0) {
    return '';
  }

  if (!machineId) {
    throw new Error('Machine ID is required for hardware-bound field encryption.');
  }

  // 16-byte random salt for scrypt key derivation
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(machineId, salt, 32);

  // 12-byte standard IV for AES-GCM
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encryptedBuffer = Buffer.concat([
    cipher.update(strText, 'utf8'),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return `enc:v1:${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encryptedBuffer.toString('hex')}`;
}

/**
 * Decrypts an AES-256-GCM encrypted field using hardware machineId
 * 
 * @param {string} encryptedStr Encrypted format string (enc:v1:salt:iv:tag:ciphertext)
 * @param {string} [machineId] Optional Machine ID (defaults to current hardware ID)
 * @returns {string} Decrypted plaintext string
 */
export function decryptField(encryptedStr, machineId = getMachineId()) {
  if (encryptedStr === null || encryptedStr === undefined) {
    return encryptedStr;
  }
  if (typeof encryptedStr !== 'string') {
    return encryptedStr;
  }

  // Non-encrypted or legacy plaintext fallback
  if (!encryptedStr.startsWith('enc:')) {
    return encryptedStr;
  }

  const parts = encryptedStr.split(':');
  if (parts.length !== 6) {
    throw new Error('Invalid encrypted field format. Expected 6 colon-separated parts.');
  }

  const [, version, saltHex, ivHex, tagHex, ciphertextHex] = parts;
  if (version !== 'v1') {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  if (!machineId) {
    throw new Error('Machine ID is required for hardware-bound field decryption.');
  }

  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  // Explicit byte length validations to prevent tag truncation and DEP0182 warnings
  if (salt.length !== 16) {
    throw new Error('Decryption failed: Invalid salt length. Expected 16 bytes.');
  }
  if (iv.length !== 12) {
    throw new Error('Decryption failed: Invalid IV length. Expected 12 bytes.');
  }
  if (tag.length !== 16) {
    throw new Error('Decryption failed: Invalid authentication tag length. Expected 16 bytes.');
  }

  const key = crypto.scryptSync(machineId, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  try {
    const decryptedBuffer = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    return decryptedBuffer.toString('utf8');
  } catch (err) {
    throw new Error(`Decryption failed (hardware node-lock mismatch or corrupted ciphertext): ${err.message}`);
  }
}

/**
 * Aliases for compatibility
 */
export const encryptData = (data, machineId) => encryptField(data, machineId);
export const decryptData = (data, machineId) => decryptField(data, machineId);

export default {
  encryptField,
  decryptField,
  encryptData,
  decryptData
};
