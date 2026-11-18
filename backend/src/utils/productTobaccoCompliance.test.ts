import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTobaccoPackagingInvariant,
  convertStockQtyToReportablePacks,
  parseOptionalCigarettePackSize,
  parseOptionalPacksPerStockUnit,
  parseTobaccoClass,
  parseTobaccoComplianceBody,
  tobaccoComplianceCreateFields,
  tobaccoComplianceStatus,
} from './productTobaccoCompliance';
import { toPublicProduct, toStaffProduct, type RawProductDoc } from './productProjection';

const legacyProduct: RawProductDoc = {
  _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  name: 'Legacy Item',
  slug: 'legacy-item',
  price: 10,
  stock_quantity: 12,
  committed_quantity: 0,
};

test('legacy products without compliance fields load as unknown and incomplete', () => {
  const staff = toStaffProduct(legacyProduct);
  assert.equal(staff.tobacco_class, 'unknown');
  assert.equal(staff.cigarette_pack_size, null);
  assert.equal(staff.stock_unit, null);
  assert.equal(staff.packs_per_stock_unit, null);
  assert.equal(staff.tobacco_profile_complete, false);
  assert.equal(staff.cigarette_reporting_ready, false);
  assert.equal(staff.cigarette_reporting_applicable, false);
  assert.equal(staff.tobacco_compliance_complete, false);
  assert.ok(staff.tobacco_profile_issues.includes('classification_unknown'));
});

test('public product responses omit tobacco compliance fields', () => {
  const pub = toPublicProduct({
    ...legacyProduct,
    tobacco_class: 'cigarette',
    cigarette_pack_size: 20,
    stock_unit: 'pack',
    packs_per_stock_unit: 1,
  }) as Record<string, unknown>;
  assert.equal('tobacco_class' in pub, false);
  assert.equal('packs_per_stock_unit' in pub, false);
  assert.equal('tobacco_compliance_complete' in pub, false);
});

test('invalid classification values are rejected', () => {
  assert.throws(() => parseTobaccoClass('cigar'), /tobacco_class must be one of/);
  assert.throws(() => parseTobaccoComplianceBody({ tobacco_class: 'cigarette_carton' }), /tobacco_class/);
});

test('cigarette pack size accepts 20 or 25 and rejects invalid values', () => {
  assert.equal(parseOptionalCigarettePackSize(20), 20);
  assert.equal(parseOptionalCigarettePackSize('25'), 25);
  assert.equal(parseOptionalCigarettePackSize(null), null);
  assert.throws(() => parseOptionalCigarettePackSize(10), /20 or 25/);
  assert.throws(() => parseOptionalCigarettePackSize(20.5), /20 or 25/);
});

test('missing packs_per_stock_unit stays incomplete and is not defaulted to 1', () => {
  const status = tobaccoComplianceStatus({
    tobacco_class: 'cigarette',
    cigarette_pack_size: 20,
    stock_unit: 'carton',
  });
  assert.equal(status.packs_per_stock_unit, null);
  assert.equal(status.cigarette_reporting_ready, false);
  assert.equal(status.tobacco_profile_complete, false);
  assert.equal(status.tobacco_compliance_complete, false);
  assert.ok(status.cigarette_reporting_issues.includes('packs_per_stock_unit_missing'));

  const created = tobaccoComplianceCreateFields(parseTobaccoComplianceBody({ tobacco_class: 'cigarette' }));
  assert.equal(created.tobacco_class, 'cigarette');
  assert.equal('packs_per_stock_unit' in created, false);

  const conversion = convertStockQtyToReportablePacks({ tobacco_class: 'cigarette' }, 4);
  assert.equal(conversion.ok, false);
  if (!conversion.ok) {
    assert.equal(conversion.reason, 'incomplete');
    assert.equal(conversion.reportable_packs, null);
  }
});

test('configured pack product converts stock quantity using packs_per_stock_unit = 1', () => {
  const conversion = convertStockQtyToReportablePacks(
    { tobacco_class: 'cigarette', stock_unit: 'pack', packs_per_stock_unit: 1 },
    7
  );
  assert.equal(conversion.ok, true);
  if (conversion.ok) assert.equal(conversion.reportable_packs, 7);
});

test('configured carton/case product converts using explicit packs_per_stock_unit', () => {
  const carton = convertStockQtyToReportablePacks(
    { tobacco_class: 'cigarette', stock_unit: 'carton', packs_per_stock_unit: 10 },
    3
  );
  assert.equal(carton.ok, true);
  if (carton.ok) assert.equal(carton.reportable_packs, 30);

  const cases = convertStockQtyToReportablePacks(
    { tobacco_class: 'cigarette', stock_unit: 'case', packs_per_stock_unit: 60 },
    2
  );
  assert.equal(cases.ok, true);
  if (cases.ok) assert.equal(cases.reportable_packs, 120);
});

test('fractional stock quantities are not silently rounded into reportable packs', () => {
  const conversion = convertStockQtyToReportablePacks(
    { tobacco_class: 'cigarette', stock_unit: 'carton', packs_per_stock_unit: 10 },
    1.5
  );
  assert.equal(conversion.ok, false);
  if (!conversion.ok) {
    assert.equal(conversion.reason, 'non_integer_quantity');
    assert.equal(conversion.reportable_packs, null);
  }
});

test('fractional packs_per_stock_unit is rejected and not rounded', () => {
  assert.throws(() => parseOptionalPacksPerStockUnit(1.5), /positive integer/);
  assert.throws(() => parseOptionalPacksPerStockUnit(0), /positive integer/);
  assert.throws(() => parseOptionalPacksPerStockUnit(-2), /positive integer/);
});

test('create without tobacco fields stays unknown', () => {
  const fields = tobaccoComplianceCreateFields(parseTobaccoComplianceBody({ name: 'Widget' }));
  assert.equal(fields.tobacco_class, 'unknown');
  assert.equal('packs_per_stock_unit' in fields, false);
});

test('pack stock unit accepts packs_per_stock_unit = 1', () => {
  assert.doesNotThrow(() => assertTobaccoPackagingInvariant('pack', 1));
  const fields = tobaccoComplianceCreateFields(
    parseTobaccoComplianceBody({
      tobacco_class: 'cigarette',
      stock_unit: 'pack',
      packs_per_stock_unit: 1,
    })
  );
  assert.equal(fields.stock_unit, 'pack');
  assert.equal(fields.packs_per_stock_unit, 1);
});

test('pack stock unit rejects packs_per_stock_unit = 10', () => {
  assert.throws(() => assertTobaccoPackagingInvariant('pack', 10), /must be 1/);
  assert.throws(
    () =>
      tobaccoComplianceCreateFields(
        parseTobaccoComplianceBody({
          tobacco_class: 'cigarette',
          stock_unit: 'pack',
          packs_per_stock_unit: 10,
        })
      ),
    /must be 1/
  );
});

test('carton, case, and other require an explicit positive integer conversion', () => {
  assert.throws(() => assertTobaccoPackagingInvariant('carton', null), /explicit positive integer/);
  assert.throws(() => assertTobaccoPackagingInvariant('case', undefined), /explicit positive integer/);
  assert.throws(() => assertTobaccoPackagingInvariant('other', null), /explicit positive integer/);
  assert.doesNotThrow(() => assertTobaccoPackagingInvariant('carton', 10));
  assert.doesNotThrow(() => assertTobaccoPackagingInvariant('case', 60));
  assert.doesNotThrow(() => assertTobaccoPackagingInvariant('other', 2));
});

test('unknown classification is an incomplete profile and not cigarette-reporting-ready', () => {
  const status = tobaccoComplianceStatus({ tobacco_class: 'unknown' });
  assert.equal(status.tobacco_profile_complete, false);
  assert.equal(status.cigarette_reporting_applicable, false);
  assert.equal(status.cigarette_reporting_ready, false);
  assert.equal(status.tobacco_compliance_complete, false);
  assert.deepEqual(status.tobacco_profile_issues, ['classification_unknown']);
});

test('cigarette classification is reporting-ready only with pack size, unit, and conversion', () => {
  const incomplete = tobaccoComplianceStatus({ tobacco_class: 'cigarette' });
  assert.equal(incomplete.tobacco_profile_complete, false);
  assert.equal(incomplete.cigarette_reporting_applicable, true);
  assert.equal(incomplete.cigarette_reporting_ready, false);
  assert.equal(incomplete.tobacco_compliance_complete, false);

  const ready = tobaccoComplianceStatus({
    tobacco_class: 'cigarette',
    cigarette_pack_size: 20,
    stock_unit: 'pack',
    packs_per_stock_unit: 1,
  });
  assert.equal(ready.tobacco_profile_complete, true);
  assert.equal(ready.cigarette_reporting_ready, true);
  assert.equal(ready.tobacco_compliance_complete, true);
});

test('little_cigar classification completes the profile without implying cigarette reporting or full regulatory clearance', () => {
  const status = tobaccoComplianceStatus({ tobacco_class: 'little_cigar' });
  assert.equal(status.tobacco_profile_complete, true);
  assert.equal(status.cigarette_reporting_applicable, false);
  assert.equal(status.cigarette_reporting_ready, false);
  assert.equal(status.tobacco_compliance_complete, false);
  assert.deepEqual(status.tobacco_profile_issues, []);
});

test('otp classification completes the profile without implying cigarette reporting or full regulatory clearance', () => {
  const status = tobaccoComplianceStatus({ tobacco_class: 'otp' });
  assert.equal(status.tobacco_profile_complete, true);
  assert.equal(status.cigarette_reporting_applicable, false);
  assert.equal(status.cigarette_reporting_ready, false);
  assert.equal(status.tobacco_compliance_complete, false);
});

test('non_tobacco classification completes the profile without implying cigarette reporting or full regulatory clearance', () => {
  const status = tobaccoComplianceStatus({ tobacco_class: 'non_tobacco' });
  assert.equal(status.tobacco_profile_complete, true);
  assert.equal(status.cigarette_reporting_applicable, false);
  assert.equal(status.cigarette_reporting_ready, false);
  assert.equal(status.tobacco_compliance_complete, false);
  assert.deepEqual(status.cigarette_reporting_issues, []);
});

// --- Conversion must refuse invalid packaging profiles -----------------------

function assertConversionRefused(
  doc: Parameters<typeof convertStockQtyToReportablePacks>[0],
  stockQty: number,
  reason: string
) {
  const conversion = convertStockQtyToReportablePacks(doc, stockQty);
  assert.equal(conversion.ok, false);
  assert.equal(conversion.reportable_packs, null);
  if (!conversion.ok) assert.equal(conversion.reason, reason);
}

test('conversion: valid cigarette carton profile converts using its configured factor', () => {
  const conversion = convertStockQtyToReportablePacks(
    { tobacco_class: 'cigarette', stock_unit: 'carton', packs_per_stock_unit: 10 },
    4
  );
  assert.deepEqual(conversion, { ok: true, reportable_packs: 40 });
});

test('conversion: cigarette pack with factor 10 is rejected as invalid packaging', () => {
  assertConversionRefused(
    { tobacco_class: 'cigarette', stock_unit: 'pack', packs_per_stock_unit: 10 },
    4,
    'invalid_packaging'
  );
});

test('conversion: cigarette with a missing stock unit is rejected even when a factor exists', () => {
  assertConversionRefused({ tobacco_class: 'cigarette', packs_per_stock_unit: 10 }, 4, 'incomplete');
  assertConversionRefused(
    { tobacco_class: 'cigarette', stock_unit: null, packs_per_stock_unit: 1 },
    4,
    'incomplete'
  );
});

test('conversion: cigarette with a missing factor is rejected and the factor is not assumed', () => {
  assertConversionRefused({ tobacco_class: 'cigarette', stock_unit: 'carton' }, 4, 'incomplete');
  // A pack unit does not imply a factor of 1 when none is stored.
  assertConversionRefused({ tobacco_class: 'cigarette', stock_unit: 'pack' }, 4, 'incomplete');
  assertConversionRefused(
    { tobacco_class: 'cigarette', stock_unit: 'case', packs_per_stock_unit: null },
    4,
    'incomplete'
  );
});

test('conversion: unrecognised stock unit or unusable factor is rejected as invalid packaging', () => {
  assertConversionRefused(
    { tobacco_class: 'cigarette', stock_unit: 'box', packs_per_stock_unit: 10 },
    4,
    'invalid_packaging'
  );
  for (const badFactor of [0, -10, 1.5, 'ten']) {
    assertConversionRefused(
      { tobacco_class: 'cigarette', stock_unit: 'carton', packs_per_stock_unit: badFactor },
      4,
      'invalid_packaging'
    );
  }
});

test('conversion: non-integer quantity is rejected for an otherwise valid profile, not rounded', () => {
  assertConversionRefused(
    { tobacco_class: 'cigarette', stock_unit: 'pack', packs_per_stock_unit: 1 },
    2.5,
    'non_integer_quantity'
  );
});

test('conversion: non-cigarette products remain not applicable regardless of packaging fields', () => {
  for (const tobacco_class of ['unknown', 'little_cigar', 'otp', 'non_tobacco']) {
    assertConversionRefused({ tobacco_class }, 4, 'not_applicable');
    assertConversionRefused(
      { tobacco_class, stock_unit: 'carton', packs_per_stock_unit: 10 },
      4,
      'not_applicable'
    );
  }
  // Legacy product with no compliance fields at all.
  assertConversionRefused({}, 4, 'not_applicable');
});
