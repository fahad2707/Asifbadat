/**
 * Jurisdiction resolution only. No tax rate and no database.
 *
 * Run with:
 *     npx tsx --test src/services/salesTax/jurisdictionResolver.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { US_STATES } from '../../utils/regions';
import {
  resolveSalesTaxJurisdiction,
  stateNamesMissingFromCatalog,
  type JurisdictionConfiguration,
  type LocalCode,
  type ResolveJurisdictionInput,
  type StructuredAddress,
} from './jurisdictionResolver';

function config(localCode: LocalCode, overrides: Partial<JurisdictionConfiguration> = {}): JurisdictionConfiguration {
  return {
    id: `cfg-${localCode}`,
    stateCode: 'PA',
    localCode,
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

function address(overrides: Partial<StructuredAddress> = {}): StructuredAddress {
  return {
    country: 'US',
    state: 'PA',
    city: 'Harrisburg',
    county: 'Dauphin',
    postalCode: '17101',
    line1: '1 Market Street',
    ...overrides,
  };
}

function request(overrides: Partial<ResolveJurisdictionInput> = {}): ResolveJurisdictionInput {
  return {
    transactionType: 'wholesale_invoice',
    transactionDate: '2026-03-15',
    sourcingRule: 'configured_place_of_sale',
    deliveryMethod: 'counter',
    placeOfSale: address(),
    configurations: [config('none')],
    ...overrides,
  };
}

function codes(result: ReturnType<typeof resolveSalesTaxJurisdiction>): string[] {
  return result.status === 'resolved' ? [] : result.issues.map((issue) => issue.code);
}

test('the state catalog covers every name offered by the address forms', () => {
  assert.deepEqual(stateNamesMissingFromCatalog(US_STATES), []);
});

test('a complete Pennsylvania address resolves only under the supplied rule and configuration', () => {
  const result = resolveSalesTaxJurisdiction(request());
  assert.equal(result.status, 'resolved');
  if (result.status !== 'resolved') return;
  assert.equal(result.jurisdictionId, 'US-PA');
  assert.equal(result.stateCode, 'PA');
  assert.equal(result.localCode, 'none');
  assert.equal(result.localJurisdictionId, null);
  assert.equal(result.resolutionMethod, 'configured_place_of_sale');
  assert.equal(result.source, 'place_of_sale');
  assert.equal(result.transactionDate, '2026-03-15');
  assert.equal(result.configurationId, 'cfg-none');
  assert.equal(
    result.warnings.some((warning) => warning.code === 'configured_sourcing_rule_not_a_department_determination'),
    true
  );
  assert.equal('rateBasisPoints' in result, false);
  assert.equal('taxRate' in result, false);
});

test('missing state, city, or postal code stays incomplete', () => {
  const missingState = resolveSalesTaxJurisdiction(request({ placeOfSale: address({ state: '' }) }));
  const missingCity = resolveSalesTaxJurisdiction(request({ placeOfSale: address({ city: '' }) }));
  const missingPostal = resolveSalesTaxJurisdiction(request({ placeOfSale: address({ postalCode: '' }) }));
  assert.equal(missingState.status, 'incomplete');
  assert.equal(missingCity.status, 'incomplete');
  assert.equal(missingPostal.status, 'incomplete');
  assert.equal(codes(missingState).includes('state_missing'), true);
  assert.equal(codes(missingCity).includes('city_missing'), true);
  assert.equal(codes(missingPostal).includes('postal_code_missing'), true);
});

test('a missing transaction date is not replaced with today', () => {
  const result = resolveSalesTaxJurisdiction(request({ transactionDate: null }));
  assert.equal(result.status, 'incomplete');
  assert.equal(codes(result).includes('transaction_date_missing'), true);
  assert.equal('jurisdictionId' in result, false);
});

test('a missing business location is not filled from a store address', () => {
  const result = resolveSalesTaxJurisdiction(
    request({
      sourcingRule: 'configured_business_location',
      businessLocation: null,
      placeOfSale: null,
    })
  );
  assert.equal(result.status, 'incomplete');
  assert.equal(codes(result).includes('business_location_missing'), true);
  assert.equal(JSON.stringify(result).includes('19462'), false);
  assert.equal(JSON.stringify(result).includes('Germantown'), false);
});

test('a delivery without a ship-to address is incomplete', () => {
  const result = resolveSalesTaxJurisdiction(
    request({
      sourcingRule: 'configured_ship_to',
      deliveryMethod: 'delivery',
      placeOfSale: null,
      shipTo: null,
    })
  );
  assert.equal(result.status, 'incomplete');
  assert.equal(codes(result).includes('ship_to_missing'), true);
});

test('a counter sale without a place of sale is incomplete', () => {
  const result = resolveSalesTaxJurisdiction(
    request({
      counterSale: true,
      deliveryMethod: 'counter',
      placeOfSale: null,
    })
  );
  assert.equal(result.status, 'incomplete');
  assert.equal(codes(result).includes('place_of_sale_missing'), true);
});

test('a delivery with a complete destination uses the ship-to when that rule is configured', () => {
  const destination = address({ city: 'Lancaster', county: 'Lancaster', postalCode: '17601' });
  const result = resolveSalesTaxJurisdiction(
    request({
      transactionType: 'online_order',
      sourcingRule: 'configured_ship_to',
      deliveryMethod: 'delivery',
      placeOfSale: null,
      shipTo: destination,
    })
  );
  assert.equal(result.status, 'resolved');
  if (result.status !== 'resolved') return;
  assert.equal(result.source, 'ship_to');
  assert.equal(result.jurisdictionId, 'US-PA');
  assert.equal(result.county, 'Lancaster');
});

test('a delivery with an incomplete destination does not borrow another address', () => {
  const result = resolveSalesTaxJurisdiction(
    request({
      sourcingRule: 'configured_ship_to',
      deliveryMethod: 'delivery',
      placeOfSale: address(),
      shipTo: address({ city: '' }),
    })
  );
  assert.equal(result.status, 'incomplete');
  assert.equal(codes(result).includes('city_missing'), true);
  assert.equal('jurisdictionId' in result, false);
});

test('conflicting addresses are invalid when no sourcing rule selects one', () => {
  const result = resolveSalesTaxJurisdiction(
    request({
      sourcingRule: null,
      deliveryMethod: 'delivery',
      placeOfSale: address(),
      shipTo: address({ state: 'NY', city: 'Buffalo', county: 'Erie', postalCode: '14201' }),
    })
  );
  assert.equal(result.status, 'invalid');
  assert.equal(codes(result).includes('conflicting_location_inputs'), true);
  assert.equal('jurisdictionId' in result, false);
});

test('a state outside the verified Pennsylvania rules is unsupported', () => {
  const result = resolveSalesTaxJurisdiction(
    request({
      placeOfSale: address({ state: 'New York', city: 'Buffalo', county: 'Erie', postalCode: '14201' }),
    })
  );
  assert.equal(result.status, 'unsupported');
  assert.equal(codes(result).includes('state_not_covered'), true);
  assert.equal('jurisdictionId' in result, false);
});

test('an exact Philadelphia address identifies that locality and does not supply a rate', () => {
  const result = resolveSalesTaxJurisdiction(
    request({
      placeOfSale: address({ city: 'Philadelphia', county: 'Philadelphia', postalCode: '19103' }),
      configurations: [config('philadelphia')],
    })
  );
  assert.equal(result.status, 'resolved');
  if (result.status !== 'resolved') return;
  assert.equal(result.jurisdictionId, 'US-PA-PHILADELPHIA');
  assert.equal(result.localCode, 'philadelphia');
  assert.equal(result.warnings.some((warning) => warning.code === 'local_collection_duty_unconfirmed'), true);
  assert.equal('rateBasisPoints' in result, false);
  assert.equal(JSON.stringify(result).includes('0.02'), false);
});

test('Philadelphia is not inferred from an abbreviated or incomplete city', () => {
  const abbreviated = resolveSalesTaxJurisdiction(
    request({
      placeOfSale: address({ city: 'Phila', county: 'Montgomery', postalCode: '19462' }),
    })
  );
  const incomplete = resolveSalesTaxJurisdiction(
    request({
      placeOfSale: address({ city: 'Philadelphia', county: '', postalCode: '' }),
      configurations: [config('philadelphia')],
    })
  );
  assert.equal(abbreviated.status, 'resolved');
  if (abbreviated.status === 'resolved') assert.equal(abbreviated.localCode, 'none');
  assert.equal(incomplete.status, 'incomplete');
  assert.equal(codes(incomplete).includes('postal_code_missing'), true);
  assert.equal(JSON.stringify(incomplete).includes('US-PA-PHILADELPHIA'), false);
});

test('an explicit Allegheny County address identifies that locality', () => {
  const result = resolveSalesTaxJurisdiction(
    request({
      placeOfSale: address({ city: 'Pittsburgh', county: 'Allegheny County', postalCode: '15222' }),
      configurations: [config('allegheny')],
    })
  );
  assert.equal(result.status, 'resolved');
  if (result.status !== 'resolved') return;
  assert.equal(result.jurisdictionId, 'US-PA-ALLEGHENY');
  assert.equal(result.localCode, 'allegheny');
  assert.equal('rateBasisPoints' in result, false);
});

test('Pittsburgh without a county does not become Allegheny', () => {
  const result = resolveSalesTaxJurisdiction(
    request({
      placeOfSale: address({ city: 'Pittsburgh', county: '', postalCode: '15222' }),
      configurations: [config('allegheny')],
    })
  );
  assert.equal(result.status, 'incomplete');
  assert.equal(codes(result).includes('county_missing'), true);
  assert.equal(JSON.stringify(result).includes('US-PA-ALLEGHENY'), false);
});

test('a structured Plymouth Meeting address is not a default origin', () => {
  const identified = resolveSalesTaxJurisdiction(
    request({
      sourcingRule: 'configured_business_location',
      businessLocation: address({
        city: 'Plymouth Meeting',
        county: 'Montgomery',
        postalCode: '19462',
        line1: '511 W Germantown Pike',
      }),
      placeOfSale: null,
    })
  );
  const omitted = resolveSalesTaxJurisdiction(
    request({
      sourcingRule: 'configured_business_location',
      businessLocation: null,
      placeOfSale: null,
    })
  );
  assert.equal(identified.status, 'resolved');
  if (identified.status === 'resolved') {
    assert.equal(identified.jurisdictionId, 'US-PA');
    assert.equal(identified.localCode, 'none');
    assert.equal(identified.source, 'business_location');
  }
  assert.equal(omitted.status, 'incomplete');
  assert.equal('jurisdictionId' in omitted, false);
});

test('a historical date uses the configuration effective on that date', () => {
  const historical = config('none', {
    id: 'cfg-2024',
    effectiveFrom: '2024-01-01',
    effectiveTo: '2024-12-31',
  });
  const inside = resolveSalesTaxJurisdiction(
    request({ transactionDate: '2024-06-01', configurations: [historical] })
  );
  const outside = resolveSalesTaxJurisdiction(
    request({ transactionDate: '2026-03-15', configurations: [historical] })
  );
  assert.equal(inside.status, 'resolved');
  if (inside.status === 'resolved') {
    assert.equal(inside.transactionDate, '2024-06-01');
    assert.equal(inside.configurationId, 'cfg-2024');
  }
  assert.equal(outside.status, 'incomplete');
  assert.equal(codes(outside).includes('no_effective_jurisdiction_configuration'), true);
});

test('an unknown sourcing rule is unsupported', () => {
  const result = resolveSalesTaxJurisdiction(request({ sourcingRule: 'origin_based_pa' }));
  assert.equal(result.status, 'unsupported');
  assert.equal(codes(result).includes('sourcing_rule_unknown'), true);
  assert.equal('jurisdictionId' in result, false);
});

test('an invalid jurisdiction configuration is rejected', () => {
  const result = resolveSalesTaxJurisdiction(
    request({
      configurations: [config('none', { effectiveFrom: '2026-12-31', effectiveTo: '2026-01-01' })],
    })
  );
  assert.equal(result.status, 'invalid');
  assert.equal(codes(result).includes('jurisdiction_configuration_invalid'), true);
});

test('empty input does not default to Pennsylvania or to 6 percent', () => {
  const result = resolveSalesTaxJurisdiction({});
  assert.equal(result.status, 'incomplete');
  assert.equal('jurisdictionId' in result, false);
  assert.equal('rateBasisPoints' in result, false);
  assert.equal('taxRate' in result, false);
  assert.equal(JSON.stringify(result).includes('US-PA'), false);
  assert.equal(JSON.stringify(result).includes('6%'), false);
});
