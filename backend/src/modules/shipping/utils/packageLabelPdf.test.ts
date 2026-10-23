/**
 * Phase B4.3 — package label PDF helpers.
 * Uses real bwip-js via shared renderCode128Png (not a live Mongo concurrency proof).
 *
 * Run: npx tsx --test src/modules/shipping/utils/packageLabelPdf.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LABEL_PACKAGES,
  MAX_QTY_PER_PACKAGE,
  MAX_TOTAL_PACKAGE_LABELS,
  LabelPdfError,
  buildPackageLabelsPdf,
  resolveLabelsFromPackages,
  validatePackageLabelRequestItems,
} from './packageLabelPdf';

const PKG_A = '64b0000000000000000f0001';
const PKG_B = '64b0000000000000000f0002';
const CODE_A = 'PKG-ABCD1234EF567890';
const CODE_B = 'PKG-BBBBBBBBBBBBBBBB';

function isPdf(buf: Buffer): boolean {
  return buf.length > 4 && buf.subarray(0, 4).toString('utf8') === '%PDF';
}

function countPdfPages(buf: Buffer): number {
  return (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
}

test('B4.3: validatePackageLabelRequestItems enforces shape, duplicates, and limits', () => {
  assert.deepEqual(validatePackageLabelRequestItems([{ package_id: PKG_A, quantity: 2 }]), [
    { package_id: PKG_A, quantity: 2 },
  ]);

  assert.throws(() => validatePackageLabelRequestItems([]), LabelPdfError);
  assert.throws(
    () =>
      validatePackageLabelRequestItems([
        { package_id: PKG_A, quantity: 1 },
        { package_id: PKG_A, quantity: 1 },
      ]),
    (e: unknown) => e instanceof LabelPdfError && /Duplicate package_id/i.test((e as Error).message)
  );
  assert.throws(() => validatePackageLabelRequestItems([{ package_id: PKG_A, quantity: 0 }]), LabelPdfError);
  assert.throws(() => validatePackageLabelRequestItems([{ package_id: PKG_A, quantity: -1 }]), LabelPdfError);
  assert.throws(() => validatePackageLabelRequestItems([{ package_id: PKG_A, quantity: 1.5 }]), LabelPdfError);
  assert.throws(
    () => validatePackageLabelRequestItems([{ package_id: PKG_A, quantity: MAX_QTY_PER_PACKAGE + 1 }]),
    LabelPdfError
  );

  const tooManyEntries = Array.from({ length: MAX_LABEL_PACKAGES + 1 }, (_, i) => ({
    package_id: `64b0000000000000000f${String(i).padStart(4, '0')}`,
    quantity: 1,
  }));
  assert.throws(() => validatePackageLabelRequestItems(tooManyEntries), LabelPdfError);

  assert.throws(
    () =>
      validatePackageLabelRequestItems([
        { package_id: PKG_A, quantity: 50 },
        { package_id: PKG_B, quantity: 50 },
        { package_id: '64b0000000000000000f0003', quantity: 50 },
        { package_id: '64b0000000000000000f0004', quantity: 50 },
        { package_id: '64b0000000000000000f0005', quantity: 1 },
      ]),
    (e: unknown) => e instanceof LabelPdfError && /Total labels cannot exceed/i.test((e as Error).message)
  );
  assert.equal(MAX_TOTAL_PACKAGE_LABELS, 200);
});

test('B4.3: resolveLabelsFromPackages uses stored package_code only', () => {
  const map = new Map([
    [PKG_A, { id: PKG_A, package_code: CODE_A, shipment_number: 'SH-1' }],
  ]);
  const resolved = resolveLabelsFromPackages([{ package_id: PKG_A, quantity: 1 }], map);
  assert.equal(resolved[0].package_code, CODE_A);

  assert.throws(
    () => resolveLabelsFromPackages([{ package_id: PKG_B, quantity: 1 }], map),
    (e: unknown) => e instanceof LabelPdfError && (e as LabelPdfError).status === 404
  );
});

test('B4.3: buildPackageLabelsPdf encodes exact stored package_code', async () => {
  const { buffer, labelCount, encodedPayloads } = await buildPackageLabelsPdf([
    { id: PKG_A, package_code: CODE_A, shipment_number: 'SH-1', quantity: 2 },
    { id: PKG_B, package_code: CODE_B, shipment_number: 'SH-1', quantity: 1 },
  ]);
  assert.equal(isPdf(buffer), true);
  assert.equal(labelCount, 3);
  assert.equal(countPdfPages(buffer), 3);
  assert.deepEqual(encodedPayloads, [CODE_A, CODE_A, CODE_B]);
});

test('B4.3: invalid requests fail in validatePackageLabelRequestItems (no PDF build)', () => {
  // validate* is synchronous and does not call renderCode128Png / PDFKit.
  assert.throws(
    () => validatePackageLabelRequestItems([{ package_id: PKG_A, quantity: 0 }]),
    LabelPdfError
  );
  assert.throws(() => validatePackageLabelRequestItems([]), LabelPdfError);
});
