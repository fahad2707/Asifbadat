import crypto from 'crypto';

/**
 * Package/carton identifier prefix — distinct from product SKUs (EDI-…),
 * shipment numbers (SH-/RG-…), and numeric manufacturer UPCs.
 */
export const PACKAGE_CODE_PREFIX = 'PKG-';

/**
 * Max length of a normalized package_code (prefix + body).
 * Fits warehouse Code 128 labels (product labels allow ≤64).
 */
export const PACKAGE_CODE_MAX_LENGTH = 32;

/** Random body length in hex chars (16 hex = 8 bytes). */
const PACKAGE_CODE_BODY_HEX_LEN = 16;

const PACKAGE_CODE_PATTERN = /^PKG-[0-9A-F]{16}$/;

/**
 * Normalize a package code for storage and lookup:
 * trim, uppercase, collapse internal whitespace (none expected after generate).
 */
export function normalizePackageCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** True when value matches the canonical PKG- + 16 hex form. */
export function isPackageCodeFormat(code: string): boolean {
  const n = normalizePackageCode(code);
  return n.length <= PACKAGE_CODE_MAX_LENGTH && PACKAGE_CODE_PATTERN.test(n);
}

/**
 * Generate a new package code: PKG- + 16 uppercase hex from crypto.randomBytes.
 * Uniqueness is enforced by the MongoDB unique index on package_code at insert time;
 * future create-service layers should retry on duplicate-key 11000 with a bounded loop.
 * Never writes to Product.sku.
 */
export function generatePackageCode(): string {
  const body = crypto.randomBytes(PACKAGE_CODE_BODY_HEX_LEN / 2).toString('hex').toUpperCase();
  const code = `${PACKAGE_CODE_PREFIX}${body}`;
  if (code.length > PACKAGE_CODE_MAX_LENGTH) {
    throw new Error('Generated package_code exceeds maximum length');
  }
  return code;
}

type MongoDuplicateError = {
  code?: number;
  keyPattern?: Record<string, unknown>;
  message?: string;
};

/**
 * True only for unique-index collisions on package_code (not other 11000s).
 * Used by create-service bounded retry; unrelated duplicate keys must not be retried.
 */
export function isPackageCodeDuplicateKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as MongoDuplicateError;
  if (e.code !== 11000) return false;
  if (e.keyPattern && Object.prototype.hasOwnProperty.call(e.keyPattern, 'package_code')) {
    return true;
  }
  return typeof e.message === 'string' && e.message.includes('package_code');
}
