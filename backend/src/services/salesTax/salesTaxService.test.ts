/**
 * Sales-tax preview. Does not connect to MongoDB.
 *
 * Run with:
 *     npx tsx --test src/services/salesTax/salesTaxService.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { salesTaxSetupStatus, TOBACCO_REPORT_GATES } from './decisions';
import { allocateIntegerCents, rateTaxHalfAwayFromZero } from './money';
import { calculateSalesTaxPreview, type SalesTaxLineInput, type SalesTaxPreviewInput } from './salesTaxService';

function line(overrides: Partial<SalesTaxLineInput> = {}): SalesTaxLineInput {
  return {
    lineId: 'line-1',
    merchandiseCents: 1000,
    taxability: 'taxable',
    ...overrides,
  };
}

function input(overrides: Partial<SalesTaxPreviewInput> = {}): SalesTaxPreviewInput {
  return {
    transactionDate: '2026-03-15',
    jurisdictionCode: 'PA',
    rateBasisPoints: 600,
    roundingPolicy: 'half_away_from_zero_cents',
    lines: [line()],
    ...overrides,
  };
}

test('half-away-from-zero matches the existing positive invoice example of $4.99 at 18%', () => {
  assert.equal(rateTaxHalfAwayFromZero(499, 1800), 90);
});

test('a supplied 6% rate previews tax and still refuses posting and filing', () => {
  const result = calculateSalesTaxPreview(input({ lines: [line({ merchandiseCents: 10000 })] }));
  assert.equal(result.status, 'preview');
  if (result.status !== 'preview') return;
  assert.equal(result.totals.taxCents, 600);
  assert.equal(result.totals.taxableBaseCents, 10000);
  assert.equal(result.postingAllowed, false);
  assert.equal(result.filingReady, false);
  assert.ok(result.postingBlockers.includes('rounding_method'));
  assert.ok(result.postingBlockers.includes('places_of_business'));
  assert.ok(result.postingBlockers.includes('jurisdiction_sourcing'));
});

test('omitted rate, jurisdiction, and rounding stay incomplete and do not become zero tax', () => {
  const result = calculateSalesTaxPreview(
    input({
      jurisdictionCode: null,
      rateBasisPoints: null,
      roundingPolicy: null,
    })
  );
  assert.equal(result.status, 'incomplete');
  if (result.status !== 'incomplete') return;
  assert.deepEqual(
    result.issues.map((issue) => issue.code).sort(),
    ['jurisdiction_missing', 'rate_missing', 'rounding_policy_missing'].sort()
  );
  assert.equal('totals' in result, false);
});

test('REV-717 bracket rounding is not invented', () => {
  const result = calculateSalesTaxPreview(input({ roundingPolicy: 'pa_rev717_bracket' }));
  assert.equal(result.status, 'incomplete');
  if (result.status !== 'incomplete') return;
  assert.equal(result.issues[0]?.code, 'rounding_policy_pa_bracket_not_encoded');
});

test('an unconfigured product is not treated as No Tax or as a default rate', () => {
  const result = calculateSalesTaxPreview(input({ lines: [line({ taxability: 'unconfigured' })] }));
  assert.equal(result.status, 'incomplete');
  if (result.status !== 'incomplete') return;
  assert.equal(result.issues.some((issue) => issue.code === 'taxability_unconfigured'), true);
});

test('purchase-price discount reduces the base and prompt-payment discount does not', () => {
  const result = calculateSalesTaxPreview(
    input({
      lines: [
        line({
          merchandiseCents: 10000,
          purchasePriceDiscountCents: 1000,
          promptPaymentDiscountCents: 500,
        }),
      ],
    })
  );
  assert.equal(result.status, 'preview');
  if (result.status !== 'preview') return;
  assert.equal(result.lines[0]?.taxableBaseCents, 9000);
  assert.equal(result.lines[0]?.promptPaymentDiscountCents, 500);
  assert.equal(result.totals.taxCents, 540);
});

test('seller-billed shipping is taxed on a taxable line and excluded on an exempt line', () => {
  const taxable = calculateSalesTaxPreview(
    input({ lines: [line({ merchandiseCents: 10000, sellerBilledShippingCents: 500 })] })
  );
  const exempt = calculateSalesTaxPreview(
    input({
      lines: [line({ merchandiseCents: 10000, sellerBilledShippingCents: 500, taxability: 'exempt' })],
    })
  );
  assert.equal(taxable.status, 'preview');
  assert.equal(exempt.status, 'preview');
  if (taxable.status !== 'preview' || exempt.status !== 'preview') return;
  assert.equal(taxable.totals.taxableBaseCents, 10500);
  assert.equal(taxable.totals.taxCents, 630);
  assert.equal(exempt.totals.taxCents, 0);
  assert.equal(exempt.totals.exemptBaseCents, 10500);
});

test('third-party freight is outside the seller tax base', () => {
  const result = calculateSalesTaxPreview(
    input({ lines: [line({ merchandiseCents: 10000, thirdPartyFreightCents: 800 })] })
  );
  assert.equal(result.status, 'preview');
  if (result.status !== 'preview') return;
  assert.equal(result.totals.taxableBaseCents, 10000);
  assert.equal(result.totals.thirdPartyFreightCents, 800);
  assert.equal(result.totals.taxCents, 600);
});

test('mixed seller shipping is allocated by net merchandise and taxed only on the taxable share', () => {
  const result = calculateSalesTaxPreview(
    input({
      headerSellerShippingCents: 100,
      lines: [
        line({ lineId: 'taxable', merchandiseCents: 7500 }),
        line({ lineId: 'exempt', merchandiseCents: 2500, taxability: 'exempt' }),
      ],
    })
  );
  assert.equal(result.status, 'preview');
  if (result.status !== 'preview') return;
  const taxable = result.lines.find((row) => row.lineId === 'taxable');
  const exempt = result.lines.find((row) => row.lineId === 'exempt');
  assert.equal(taxable?.sellerBilledShippingCents, 75);
  assert.equal(exempt?.sellerBilledShippingCents, 25);
  assert.equal(taxable?.taxableBaseCents, 7575);
  assert.equal(exempt?.taxCents, 0);
  assert.equal(result.totals.sellerBilledShippingCents, 100);
});

test('one leftover shipping cent is assigned stably', () => {
  const allocated = allocateIntegerCents(1, [
    { id: 'b', weightCents: 100 },
    { id: 'a', weightCents: 100 },
  ]);
  assert.equal(allocated.ok, true);
  if (!allocated.ok) return;
  assert.deepEqual(allocated.shares, [
    { id: 'b', cents: 0 },
    { id: 'a', cents: 1 },
  ]);
});

test('unclassified discount or shipping blocks the preview', () => {
  const discount = calculateSalesTaxPreview(input({ lines: [line({ unclassifiedDiscountCents: 100 })] }));
  const shipping = calculateSalesTaxPreview(input({ lines: [line({ unclassifiedShippingCents: 100 })] }));
  assert.equal(discount.status, 'incomplete');
  assert.equal(shipping.status, 'incomplete');
  if (discount.status !== 'incomplete' || shipping.status !== 'incomplete') return;
  assert.equal(discount.issues.some((issue) => issue.code === 'discount_unclassified'), true);
  assert.equal(shipping.issues.some((issue) => issue.code === 'shipping_unclassified'), true);
});

test('pending, revoked, expired, and dateless exemptions do not silently zero tax', () => {
  const pending = calculateSalesTaxPreview(
    input({ lines: [line({ exemption: { approval: 'pending' } })] })
  );
  const revoked = calculateSalesTaxPreview(
    input({ lines: [line({ exemption: { approval: 'revoked' } })] })
  );
  const expired = calculateSalesTaxPreview(
    input({
      lines: [
        line({
          exemption: { approval: 'approved', effectiveOn: '2020-01-01', expiresOn: '2020-12-31' },
        }),
      ],
    })
  );
  const missingDates = calculateSalesTaxPreview(
    input({ lines: [line({ exemption: { approval: 'approved' } })] })
  );
  assert.equal(pending.status, 'preview');
  assert.equal(revoked.status, 'preview');
  assert.equal(expired.status, 'preview');
  assert.equal(missingDates.status, 'incomplete');
  if (pending.status !== 'preview' || revoked.status !== 'preview' || expired.status !== 'preview') return;
  if (missingDates.status !== 'incomplete') return;
  assert.equal(pending.totals.taxCents, 60);
  assert.equal(pending.warnings[0]?.code, 'exemption_not_approved');
  assert.equal(revoked.totals.taxCents, 60);
  assert.equal(expired.totals.taxCents, 60);
  assert.equal(expired.warnings[0]?.code, 'exemption_outside_effective_dates');
  assert.equal(missingDates.issues[0]?.code, 'exemption_dates_missing');
});

test('an approved in-range exemption zeroes tax without changing posting permission', () => {
  const result = calculateSalesTaxPreview(
    input({
      lines: [
        line({
          merchandiseCents: 10000,
          sellerBilledShippingCents: 500,
          exemption: { approval: 'approved', effectiveOn: '2026-01-01', expiresOn: '2026-12-31' },
        }),
      ],
    })
  );
  assert.equal(result.status, 'preview');
  if (result.status !== 'preview') return;
  assert.equal(result.lines[0]?.treatment, 'customer_exempt');
  assert.equal(result.totals.taxCents, 0);
  assert.equal(result.totals.exemptBaseCents, 10500);
  assert.equal(result.postingAllowed, false);
});

test('a non-taxable product is reported separately from an exemption', () => {
  const result = calculateSalesTaxPreview(input({ lines: [line({ taxability: 'non_taxable' })] }));
  assert.equal(result.status, 'preview');
  if (result.status !== 'preview') return;
  assert.equal(result.lines[0]?.treatment, 'non_taxable');
  assert.equal(result.totals.nonTaxableBaseCents, 1000);
  assert.equal(result.totals.taxCents, 0);
});

test('header shipping cannot be added on top of line shipping', () => {
  const result = calculateSalesTaxPreview(
    input({
      headerSellerShippingCents: 100,
      lines: [line({ sellerBilledShippingCents: 100 })],
    })
  );
  assert.equal(result.status, 'incomplete');
  if (result.status !== 'incomplete') return;
  assert.equal(result.issues.some((issue) => issue.code === 'shipping_double_counted'), true);
});

test('setup status keeps sales-tax posting off and tobacco reports disabled', () => {
  const status = salesTaxSetupStatus();
  assert.equal(status.postingAllowed, false);
  assert.equal(status.filingReady, false);
  assert.equal(status.postingBlockers.includes('freight_billing'), true);
  assert.equal(TOBACCO_REPORT_GATES.every((gate) => gate.enabled === false && gate.filingReady === false), true);
});
