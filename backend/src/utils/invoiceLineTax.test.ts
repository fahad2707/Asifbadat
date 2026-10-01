/**
 * TAX-02 — invoice line tax inheritance and snapshot math.
 *
 * Run with:
 *     npx tsx --test src/utils/invoiceLineTax.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InvoiceLineTaxError,
  applyLineTaxSnapshot,
  buildInvoiceLines,
  computePercentLineTax,
  copyInvoiceLineSnapshots,
  inheritLineTaxFromProduct,
  invoiceTaxTotals,
  noTaxLineSnapshot,
} from './invoiceLineTax';

const GST_ID = '64b1c2d3e4f5a6b7c8d9e0f1';
const VAT_ID = '64b1c2d3e4f5a6b7c8d9e0f2';
const CAST_ID = '64b1c2d3e4f5a6b7c8d9e0f3';
const PRODUCT_A = '64c1c2d3e4f5a6b7c8d9e0a1';

test('percent tax uses repository rounding: $4.99 × 18% = $0.90', () => {
  assert.equal(computePercentLineTax(4.99, 18), 0.9);
  assert.equal(computePercentLineTax(10, 12), 1.2);
});

test('GST product inherits a taxable percent snapshot without changing price', () => {
  const product = {
    name: 'ABC',
    tax_type_id: { _id: GST_ID, name: 'GST', rate: 18, rate_type: 'percent' },
  };
  const snap = inheritLineTaxFromProduct(product, 4.99);
  assert.equal(snap.taxable, true);
  assert.equal(String(snap.tax_type_id), GST_ID);
  assert.equal(snap.tax_type_name, 'GST');
  assert.equal(snap.tax_rate_type, 'percent');
  assert.equal(snap.tax_rate, 18);
  assert.equal(snap.tax_amount, 0.9);
  assert.equal(snap.tax_type_label, 'GST — 18%');
  assert.equal(snap.total, 5.89);
});

test('explicit No Tax product is non-taxable', () => {
  const product = { name: 'XYZ', tax_type_id: null };
  const snap = inheritLineTaxFromProduct(product, 7.5);
  assert.deepEqual(snap, { ...noTaxLineSnapshot(7.5) });
  assert.equal(snap.taxable, false);
  assert.equal(snap.tax_amount, 0);
  assert.equal(snap.total, 7.5);
});

test('Not configured product is rejected, not treated as No Tax', () => {
  assert.throws(
    () => inheritLineTaxFromProduct({ name: 'Bare' }, 4.99),
    (err: unknown) => {
      assert.ok(err instanceof InvoiceLineTaxError);
      assert.match(err.message, /no configured tax type/i);
      return true;
    }
  );
});

test('invalid / missing populated TaxType is rejected', () => {
  assert.throws(
    () => inheritLineTaxFromProduct({ name: 'ABC', tax_type_id: '64b1c2d3e4f5a6b7c8d9e0aa' }, 4.99),
    (err: unknown) => {
      assert.ok(err instanceof InvoiceLineTaxError);
      assert.match(err.message, /invalid or missing TaxType/i);
      return true;
    }
  );
});

test('fixed-amount TaxType is not calculated', () => {
  assert.throws(
    () =>
      inheritLineTaxFromProduct(
        { name: 'CAST item', tax_type_id: { _id: CAST_ID, name: 'CAST', rate: 2, rate_type: 'amount' } },
        10
      ),
    (err: unknown) => {
      assert.ok(err instanceof InvoiceLineTaxError);
      assert.match(err.message, /Fixed-amount/i);
      return true;
    }
  );
});

test('mixed GST / VAT / No Tax lines sum independently', () => {
  const productsById = new Map([
    [
      PRODUCT_A,
      { name: 'ABC', tax_type_id: { _id: GST_ID, name: 'GST', rate: 18, rate_type: 'percent' } },
    ],
    [
      '64c1c2d3e4f5a6b7c8d9e0a2',
      { name: 'DEF', tax_type_id: { _id: VAT_ID, name: 'VAT', rate: 12, rate_type: 'percent' } },
    ],
    ['64c1c2d3e4f5a6b7c8d9e0a3', { name: 'XYZ', tax_type_id: null }],
  ]);
  const { items, usedLineTax } = buildInvoiceLines({
    items: [
      { product_id: PRODUCT_A, product_name: 'ABC', quantity: 1, price: 4.99, subtotal: 4.99 },
      { product_id: '64c1c2d3e4f5a6b7c8d9e0a2', product_name: 'DEF', quantity: 1, price: 10, subtotal: 10 },
      { product_id: '64c1c2d3e4f5a6b7c8d9e0a3', product_name: 'XYZ', quantity: 1, price: 7.5, subtotal: 7.5 },
    ],
    productsById,
    inheritFromProduct: true,
  });
  assert.equal(usedLineTax, true);
  assert.equal(items[0].tax_amount, 0.9);
  assert.equal(items[0].tax_type_label, 'GST — 18%');
  assert.equal(items[1].tax_amount, 1.2);
  assert.equal(items[1].tax_type_label, 'VAT — 12%');
  assert.equal(items[2].tax_amount, 0);
  assert.equal(items[2].tax_type_label, 'No Tax');
  const totals = invoiceTaxTotals(items, { usedLineTax: true });
  assert.equal(totals.subtotal_amount, 22.49);
  assert.equal(totals.tax_amount, 2.1);
  assert.equal(totals.total_amount, 24.59);
});

test('edit recomputes tax from stored snapshot, not a new Product TaxType', () => {
  const existing = [
    {
      product_id: PRODUCT_A,
      taxable: true,
      tax_type_id: GST_ID,
      tax_type_name: 'GST',
      tax_rate_type: 'percent',
      tax_rate: 18,
      tax_type_label: 'GST — 18%',
    },
  ];
  const productsById = new Map([
    [
      PRODUCT_A,
      { name: 'ABC', tax_type_id: { _id: VAT_ID, name: 'VAT', rate: 12, rate_type: 'percent' } },
    ],
  ]);
  const { items } = buildInvoiceLines({
    items: [{ product_id: PRODUCT_A, product_name: 'ABC', quantity: 1, price: 4.99, subtotal: 4.99 }],
    productsById,
    existingItems: existing,
    inheritFromProduct: false,
  });
  assert.equal(items[0].tax_type_name, 'GST');
  assert.equal(items[0].tax_rate, 18);
  assert.equal(items[0].tax_amount, 0.9);
});

test('applyLineTaxSnapshot recalculates percent tax from qty/price changes', () => {
  const snap = applyLineTaxSnapshot(9.98, {
    taxable: true,
    tax_type_id: GST_ID,
    tax_type_name: 'GST',
    tax_rate_type: 'percent',
    tax_rate: 18,
    tax_type_label: 'GST — 18%',
  });
  assert.equal(snap.tax_amount, 1.8);
  assert.equal(snap.total, 11.78);
});

test('quotation conversion copies snapshots without inheriting current product tax', () => {
  const copied = copyInvoiceLineSnapshots([
    {
      product_id: PRODUCT_A,
      product_name: 'ABC',
      quantity: 1,
      price: 4.99,
      subtotal: 4.99,
      taxable: true,
      tax_type_id: GST_ID,
      tax_type_name: 'GST',
      tax_rate_type: 'percent',
      tax_rate: 18,
      tax_amount: 0.9,
      tax_type_label: 'GST — 18%',
      total: 5.89,
    },
  ]);
  assert.equal(copied[0].tax_type_name, 'GST');
  assert.equal(copied[0].tax_rate, 18);
  assert.equal(copied[0].tax_amount, 0.9);
});

test('legacy lines without taxable keep fallback document tax', () => {
  const { items, usedLineTax } = buildInvoiceLines({
    items: [{ product_name: 'Line', quantity: 1, price: 100, subtotal: 100 }],
    productsById: new Map(),
    inheritFromProduct: false,
  });
  assert.equal(usedLineTax, false);
  const totals = invoiceTaxTotals(items, { usedLineTax: false, fallbackTaxAmount: 8.5 });
  assert.equal(totals.subtotal_amount, 100);
  assert.equal(totals.tax_amount, 8.5);
  assert.equal(totals.total_amount, 108.5);
});
