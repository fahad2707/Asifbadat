/**
 * Phase B4.1 — package code generator (no Mongo).
 *
 * Run: npx tsx --test src/modules/shipping/utils/packageCodes.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PACKAGE_CODE_MAX_LENGTH,
  PACKAGE_CODE_PREFIX,
  generatePackageCode,
  isPackageCodeDuplicateKey,
  isPackageCodeFormat,
  normalizePackageCode,
} from './packageCodes';

test('generatePackageCode uses PKG- prefix and 16 hex body', () => {
  const code = generatePackageCode();
  assert.ok(code.startsWith(PACKAGE_CODE_PREFIX));
  assert.equal(PACKAGE_CODE_PREFIX, 'PKG-');
  assert.match(code, /^PKG-[0-9A-F]{16}$/);
});

test('generatePackageCode produces normalized codes within max length', () => {
  const code = generatePackageCode();
  assert.equal(normalizePackageCode(code), code);
  assert.ok(code.length <= PACKAGE_CODE_MAX_LENGTH);
  assert.equal(PACKAGE_CODE_MAX_LENGTH, 32);
  assert.ok(isPackageCodeFormat(code));
});

test('normalizePackageCode trims, uppercases, and strips whitespace', () => {
  assert.equal(normalizePackageCode('  pkg-abcd1234ef567890  '), 'PKG-ABCD1234EF567890');
  assert.equal(normalizePackageCode('PKG-ABCD 1234 EF56 7890'), 'PKG-ABCD1234EF567890');
});

test('isPackageCodeFormat rejects wrong prefix, length, and non-hex', () => {
  assert.equal(isPackageCodeFormat('EDI-48217'), false);
  assert.equal(isPackageCodeFormat('PKG-SHORT'), false);
  assert.equal(isPackageCodeFormat('PKG-ABCD1234EF56789G'), false);
  assert.equal(isPackageCodeFormat('PKG-ABCD1234EF567890'), true);
});

test('generatePackageCode yields independent values across calls', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const code = generatePackageCode();
    assert.equal(seen.has(code), false, `unexpected repeat at iteration ${i}`);
    seen.add(code);
  }
  assert.equal(seen.size, 20);
});

test('isPackageCodeDuplicateKey matches only package_code 11000', () => {
  assert.equal(
    isPackageCodeDuplicateKey({ code: 11000, keyPattern: { package_code: 1 } }),
    true
  );
  assert.equal(
    isPackageCodeDuplicateKey({
      code: 11000,
      message: 'E11000 duplicate key error index: package_code_1',
    }),
    true
  );
  assert.equal(
    isPackageCodeDuplicateKey({ code: 11000, keyPattern: { shipment_number: 1 } }),
    false
  );
  assert.equal(isPackageCodeDuplicateKey({ code: 11000, message: 'E11000 sku_1' }), false);
  assert.equal(isPackageCodeDuplicateKey({ code: 50 }), false);
});
