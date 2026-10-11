/**
 * Phase B3 — product label PDF / Code 128 helpers.
 * Uses real bwip-js encoding (not mocked) for barcode payload checks.
 *
 * Run: npx tsx --test src/utils/productLabelPdf.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LABEL_HEIGHT_PT,
  LABEL_WIDTH_PT,
  LabelPdfError,
  MAX_QTY_PER_PRODUCT,
  MAX_TOTAL_LABELS,
  buildProductLabelsPdf,
  normalizeLabelQuantity,
  renderCode128Png,
  resolvePrintableSku,
  validateLabelRequestItems,
} from './productLabelPdf';

function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function isPdf(buf: Buffer): boolean {
  return buf.length > 4 && buf.subarray(0, 4).toString('utf8') === '%PDF';
}

function countPdfPages(buf: Buffer): number {
  const text = buf.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

test('B3: Code128 payload for internal SKU EDI-48217 is exact', async () => {
  const { png, payload } = await renderCode128Png('EDI-48217');
  assert.equal(payload, 'EDI-48217');
  assert.equal(isPng(png), true);
  // Same text → same encoder options → deterministic PNG from bwip-js
  const again = await renderCode128Png('EDI-48217');
  assert.equal(again.payload, 'EDI-48217');
  assert.deepEqual(png, again.png);
});

test('B3: manufacturer SKU is encoded exactly (preserved, not replaced)', async () => {
  const vendor = '012345678905';
  const { png, payload } = await renderCode128Png(vendor);
  assert.equal(payload, vendor);
  assert.equal(isPng(png), true);
  assert.notEqual(payload.startsWith('EDI-'), true);
});

test('B3: empty barcode payload is rejected', async () => {
  await assert.rejects(() => renderCode128Png(''), (e: unknown) => e instanceof LabelPdfError);
  await assert.rejects(() => renderCode128Png('   '), (e: unknown) => e instanceof LabelPdfError);
});

test('B3: resolvePrintableSku uses stored sku only', () => {
  assert.equal(resolvePrintableSku({ id: '1', sku: 'EDI-48217', product_id: '48217' }), 'EDI-48217');
  assert.equal(resolvePrintableSku({ id: '1', sku: ' 012345678905 ', product_id: '48217' }), '012345678905');
  assert.throws(
    () => resolvePrintableSku({ id: 'abc', sku: '', product_id: '48217' }),
    (e: unknown) => e instanceof LabelPdfError && /no SKU/i.test((e as Error).message)
  );
});

test('B3: quantity validation rejects zero, negative, non-integer, excessive', () => {
  assert.throws(() => normalizeLabelQuantity(0), LabelPdfError);
  assert.throws(() => normalizeLabelQuantity(-1), LabelPdfError);
  assert.throws(() => normalizeLabelQuantity(1.5), LabelPdfError);
  assert.throws(() => normalizeLabelQuantity('x'), LabelPdfError);
  assert.equal(normalizeLabelQuantity(3), 3);

  assert.throws(() => validateLabelRequestItems([]), LabelPdfError);
  assert.throws(
    () => validateLabelRequestItems([{ product_id: 'a', quantity: MAX_QTY_PER_PRODUCT + 1 }]),
    LabelPdfError
  );
  assert.throws(
    () =>
      validateLabelRequestItems(
        Array.from({ length: 5 }, (_, i) => ({
          product_id: `64c1c2d3e4f5a6b7c8d9e0b${i}`,
          quantity: Math.ceil(MAX_TOTAL_LABELS / 4),
        }))
      ),
    (e: unknown) => e instanceof LabelPdfError && /Total labels/i.test((e as Error).message)
  );
});

test('B3: multi-product quantities produce expected label count; missing name safe', async () => {
  const { buffer, labelCount, encodedPayloads } = await buildProductLabelsPdf([
    { id: '1', name: '', sku: 'EDI-48217', product_id: '48217', quantity: 2 },
    {
      id: '2',
      name: 'A very long product name that should truncate safely on a tiny warehouse label without crashing',
      sku: 'VENDOR-SKU-99',
      product_id: '99001',
      quantity: 3,
    },
  ]);
  assert.equal(labelCount, 5);
  assert.equal(encodedPayloads.length, 5);
  assert.deepEqual(encodedPayloads, [
    'EDI-48217',
    'EDI-48217',
    'VENDOR-SKU-99',
    'VENDOR-SKU-99',
    'VENDOR-SKU-99',
  ]);
  assert.equal(isPdf(buffer), true);
  assert.equal(countPdfPages(buffer), 5);
  assert.equal(LABEL_WIDTH_PT, 144);
  assert.equal(LABEL_HEIGHT_PT, 72);
});
