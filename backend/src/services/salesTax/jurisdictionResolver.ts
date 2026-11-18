/**
 * Sales-tax jurisdiction resolver.
 *
 * This function does not calculate a rate, read Product or StoreSettings, or
 * post a transaction. It does not treat the Plymouth Meeting string in
 * invoices.ts as the origin of any sale.
 *
 * Address fields that actually exist:
 * - Invoice: free-text customer_address and location_of_sale. No county, city, or ZIP columns.
 * - POSSale: customer name, phone, and email. No address.
 * - OnlineOrder: address_line1, address_line2, city, state, zip, country. No county.
 * - Customer: city, state, zip, plus free-text address, billing_address, and shipping_address. No county.
 * - StoreSettings: address, city, state, zip. No county.
 *
 * Published Pennsylvania local sales-tax jurisdictions are Allegheny County and
 * Philadelphia. REV-717 ties required local collection to where the sale
 * originates, and it allows a vendor outside those places to collect voluntarily.
 * Out-of-state delivery is outside the local tax. Those facts are not enough to
 * choose place-of-sale versus ship-to for Express, so the caller must pass a
 * configured sourcing rule. A missing rule stays unresolved.
 *
 * Sources:
 * - https://www.pa.gov/agencies/revenue/resources/tax-rates
 * - REV-717, Retailer's Information
 */

import { US_STATES } from '../../utils/regions';
import { isIsoDate } from './salesTaxService';

export const LOCALITY_CATALOG_REFERENCE = 'pa-dor-tax-rates-allegheny-and-philadelphia-only';

export const CONFIGURED_SOURCING_RULES = [
  'configured_business_location',
  'configured_place_of_sale',
  'configured_ship_to',
] as const;

export type ConfiguredSourcingRule = (typeof CONFIGURED_SOURCING_RULES)[number];

export type SalesTaxTransactionType = 'wholesale_invoice' | 'pos_sale' | 'online_order';

export type DeliveryMethod = 'counter' | 'pickup' | 'delivery';

export type LocalCode = 'none' | 'philadelphia' | 'allegheny';

export type StructuredAddress = {
  country?: string | null;
  state?: string | null;
  city?: string | null;
  county?: string | null;
  postalCode?: string | null;
  line1?: string | null;
};

export type JurisdictionConfiguration = {
  id: string;
  stateCode: string;
  localCode: LocalCode;
  effectiveFrom: string;
  effectiveTo?: string | null;
};

export type JurisdictionIssue = {
  code: string;
  detail?: string;
};

export type ResolveJurisdictionInput = {
  transactionType?: SalesTaxTransactionType | null;
  transactionDate?: string | null;
  sourcingRule?: string | null;
  deliveryMethod?: DeliveryMethod | null;
  counterSale?: boolean | null;
  businessLocation?: StructuredAddress | null;
  placeOfSale?: StructuredAddress | null;
  shipTo?: StructuredAddress | null;
  configurations?: JurisdictionConfiguration[] | null;
};

export type ResolvedJurisdiction = {
  status: 'resolved';
  jurisdictionId: string;
  stateCode: 'PA';
  localCode: LocalCode;
  localJurisdictionId: string | null;
  county: string | null;
  resolutionMethod: ConfiguredSourcingRule;
  source: 'business_location' | 'place_of_sale' | 'ship_to';
  transactionDate: string;
  configurationId: string;
  localityCatalogReference: typeof LOCALITY_CATALOG_REFERENCE;
  warnings: JurisdictionIssue[];
};

export type UnresolvedJurisdiction = {
  status: 'incomplete' | 'unsupported' | 'invalid';
  issues: JurisdictionIssue[];
};

export type JurisdictionResolution = ResolvedJurisdiction | UnresolvedJurisdiction;

const STATE_CODES: Readonly<Record<string, string>> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
};

const CODE_SET = new Set(Object.values(STATE_CODES));

type Problem = JurisdictionIssue & { severity: 'invalid' | 'unsupported' | 'incomplete' };

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function token(value: string | null | undefined): string {
  return text(value).toLowerCase().replace(/\./g, '');
}

function placeToken(value: string | null | undefined): string {
  return token(value).replace(/\s+county$/, '');
}

export function stateNamesMissingFromCatalog(names: readonly string[] = US_STATES): string[] {
  return names.filter((name) => !STATE_CODES[name.toLowerCase()]);
}

function normalizeCountry(value: string | null | undefined): 'US' | 'other' | 'missing' {
  const raw = token(value);
  if (!raw) return 'missing';
  if (raw === 'us' || raw === 'usa' || raw === 'united states') return 'US';
  return 'other';
}

function normalizeState(value: string | null | undefined): { kind: 'missing' | 'invalid' | 'code'; code?: string } {
  const raw = token(value);
  if (!raw) return { kind: 'missing' };
  if (/^[a-z]{2}$/.test(raw)) {
    const code = raw.toUpperCase();
    return CODE_SET.has(code) ? { kind: 'code', code } : { kind: 'invalid' };
  }
  const code = STATE_CODES[raw];
  return code ? { kind: 'code', code } : { kind: 'invalid' };
}

function normalizePostal(value: string | null | undefined): 'missing' | 'invalid' | 'valid' {
  const raw = text(value);
  if (!raw) return 'missing';
  return /^\d{5}(?:-\d{4})?$/.test(raw) ? 'valid' : 'invalid';
}

function isConfiguredRule(value: string | null | undefined): value is ConfiguredSourcingRule {
  return (CONFIGURED_SOURCING_RULES as readonly string[]).includes(text(value));
}

function sourceFor(rule: ConfiguredSourcingRule): ResolvedJurisdiction['source'] {
  if (rule === 'configured_business_location') return 'business_location';
  if (rule === 'configured_place_of_sale') return 'place_of_sale';
  return 'ship_to';
}

function addressFor(input: ResolveJurisdictionInput, rule: ConfiguredSourcingRule): StructuredAddress | null | undefined {
  if (rule === 'configured_business_location') return input.businessLocation;
  if (rule === 'configured_place_of_sale') return input.placeOfSale;
  return input.shipTo;
}

function jurisdictionIdFor(localCode: LocalCode): { jurisdictionId: string; localJurisdictionId: string | null } {
  if (localCode === 'philadelphia') {
    return { jurisdictionId: 'US-PA-PHILADELPHIA', localJurisdictionId: 'US-PA-PHILADELPHIA' };
  }
  if (localCode === 'allegheny') {
    return { jurisdictionId: 'US-PA-ALLEGHENY', localJurisdictionId: 'US-PA-ALLEGHENY' };
  }
  return { jurisdictionId: 'US-PA', localJurisdictionId: null };
}

function dateCovers(config: JurisdictionConfiguration, transactionDate: string): boolean {
  if (transactionDate < config.effectiveFrom) return false;
  if (config.effectiveTo != null && config.effectiveTo !== '' && transactionDate > config.effectiveTo) return false;
  return true;
}

function rangesOverlap(left: JurisdictionConfiguration, right: JurisdictionConfiguration): boolean {
  const leftEnd = left.effectiveTo || '9999-12-31';
  const rightEnd = right.effectiveTo || '9999-12-31';
  return left.effectiveFrom <= rightEnd && right.effectiveFrom <= leftEnd;
}

function configurationProblems(configurations: JurisdictionConfiguration[] | null | undefined): Problem[] {
  if (configurations == null || configurations.length === 0) {
    return [{ severity: 'incomplete', code: 'jurisdiction_configuration_missing' }];
  }
  const problems: Problem[] = [];
  for (const config of configurations) {
    const id = text(config.id);
    if (!id) problems.push({ severity: 'invalid', code: 'jurisdiction_configuration_invalid', detail: 'id' });
    if (text(config.stateCode).toUpperCase() !== 'PA') {
      problems.push({ severity: 'invalid', code: 'jurisdiction_configuration_invalid', detail: 'stateCode' });
    }
    if (config.localCode !== 'none' && config.localCode !== 'philadelphia' && config.localCode !== 'allegheny') {
      problems.push({ severity: 'invalid', code: 'jurisdiction_configuration_invalid', detail: 'localCode' });
    }
    if (!isIsoDate(config.effectiveFrom)) {
      problems.push({ severity: 'invalid', code: 'jurisdiction_configuration_invalid', detail: 'effectiveFrom' });
    }
    if (config.effectiveTo != null && config.effectiveTo !== '' && !isIsoDate(config.effectiveTo)) {
      problems.push({ severity: 'invalid', code: 'jurisdiction_configuration_invalid', detail: 'effectiveTo' });
    }
    if (
      isIsoDate(config.effectiveFrom) &&
      config.effectiveTo != null &&
      config.effectiveTo !== '' &&
      isIsoDate(config.effectiveTo) &&
      config.effectiveTo < config.effectiveFrom
    ) {
      problems.push({ severity: 'invalid', code: 'jurisdiction_configuration_invalid', detail: 'effective range' });
    }
  }
  for (let i = 0; i < configurations.length; i += 1) {
    for (let j = i + 1; j < configurations.length; j += 1) {
      const left = configurations[i];
      const right = configurations[j];
      if (
        text(left.stateCode).toUpperCase() === text(right.stateCode).toUpperCase() &&
        left.localCode === right.localCode &&
        isIsoDate(left.effectiveFrom) &&
        isIsoDate(right.effectiveFrom) &&
        rangesOverlap(left, right)
      ) {
        problems.push({ severity: 'invalid', code: 'jurisdiction_configuration_overlap' });
      }
    }
  }
  return problems;
}

function addressesDisagree(left: StructuredAddress, right: StructuredAddress): boolean {
  const stateA = normalizeState(left.state);
  const stateB = normalizeState(right.state);
  if (stateA.kind === 'code' && stateB.kind === 'code' && stateA.code !== stateB.code) return true;
  const cityA = token(left.city);
  const cityB = token(right.city);
  if (cityA && cityB && cityA !== cityB) return true;
  const postalA = text(left.postalCode);
  const postalB = text(right.postalCode);
  return Boolean(postalA && postalB && postalA !== postalB);
}

function presentAddresses(input: ResolveJurisdictionInput): StructuredAddress[] {
  return [input.businessLocation, input.placeOfSale, input.shipTo].filter(
    (address): address is StructuredAddress => address != null
  );
}

export function resolveSalesTaxJurisdiction(input: ResolveJurisdictionInput): JurisdictionResolution {
  const problems: Problem[] = [];
  const transactionDate = text(input.transactionDate);
  if (!transactionDate) problems.push({ severity: 'incomplete', code: 'transaction_date_missing' });
  else if (!isIsoDate(transactionDate)) problems.push({ severity: 'invalid', code: 'transaction_date_invalid' });

  if (!text(input.transactionType)) problems.push({ severity: 'incomplete', code: 'transaction_type_missing' });

  const ruleText = text(input.sourcingRule);
  let rule: ConfiguredSourcingRule | null = null;
  if (!ruleText) problems.push({ severity: 'incomplete', code: 'sourcing_rule_missing' });
  else if (!isConfiguredRule(ruleText)) problems.push({ severity: 'unsupported', code: 'sourcing_rule_unknown', detail: ruleText });
  else rule = ruleText;

  const counter = input.counterSale === true || input.deliveryMethod === 'counter' || input.deliveryMethod === 'pickup';
  const delivering = input.deliveryMethod === 'delivery';
  if (input.counterSale === true && input.deliveryMethod === 'delivery') {
    problems.push({ severity: 'invalid', code: 'delivery_method_conflict' });
  }
  if (input.deliveryMethod == null && input.counterSale !== true) {
    problems.push({ severity: 'incomplete', code: 'delivery_method_missing' });
  }
  if (counter && rule === 'configured_ship_to') {
    problems.push({ severity: 'unsupported', code: 'counter_or_pickup_ship_to_unsupported' });
  }

  problems.push(...configurationProblems(input.configurations));

  const provided = presentAddresses(input);
  if (!rule && provided.length >= 2 && addressesDisagree(provided[0], provided[1])) {
    problems.push({ severity: 'invalid', code: 'conflicting_location_inputs' });
  } else if (!rule && provided.length >= 2) {
    for (let i = 1; i < provided.length; i += 1) {
      if (addressesDisagree(provided[0], provided[i])) {
        problems.push({ severity: 'invalid', code: 'conflicting_location_inputs' });
        break;
      }
    }
  }

  if (rule === 'configured_ship_to' && delivering && (input.shipTo == null)) {
    problems.push({ severity: 'incomplete', code: 'ship_to_missing' });
  }
  if (rule === 'configured_business_location' && input.businessLocation == null) {
    problems.push({ severity: 'incomplete', code: 'business_location_missing' });
  }
  if (rule === 'configured_place_of_sale' && input.placeOfSale == null) {
    problems.push({ severity: 'incomplete', code: 'place_of_sale_missing' });
  }

  const selected = rule ? addressFor(input, rule) : null;
  let localCode: LocalCode | null = null;
  let county: string | null = null;
  let stateCode: string | null = null;

  if (rule && selected == null) {
    // Missing-source codes were recorded above.
  } else if (rule && selected != null) {
    const country = normalizeCountry(selected.country);
    if (country === 'missing') problems.push({ severity: 'incomplete', code: 'country_missing' });
    else if (country === 'other') problems.push({ severity: 'unsupported', code: 'country_unsupported' });

    const state = normalizeState(selected.state);
    if (state.kind === 'missing') problems.push({ severity: 'incomplete', code: 'state_missing' });
    else if (state.kind === 'invalid') problems.push({ severity: 'invalid', code: 'state_invalid' });
    else if (state.code !== 'PA') problems.push({ severity: 'unsupported', code: 'state_not_covered', detail: state.code });
    else stateCode = 'PA';

    const city = text(selected.city);
    if (!city) problems.push({ severity: 'incomplete', code: 'city_missing' });
    else if (city.includes(',') || city.length > 80) problems.push({ severity: 'invalid', code: 'city_unparsed' });

    const postal = normalizePostal(selected.postalCode);
    if (postal === 'missing') problems.push({ severity: 'incomplete', code: 'postal_code_missing' });
    else if (postal === 'invalid') problems.push({ severity: 'invalid', code: 'postal_code_invalid' });

    const cityToken = token(selected.city);
    const countyToken = placeToken(selected.county);
    county = text(selected.county) || null;
    if (state.kind === 'code' && state.code === 'PA' && city && postal === 'valid' && country === 'US') {
      if (cityToken === 'philadelphia' && countyToken && countyToken !== 'philadelphia') {
        problems.push({ severity: 'invalid', code: 'location_contradiction' });
      } else if (countyToken === 'allegheny' && cityToken === 'philadelphia') {
        problems.push({ severity: 'invalid', code: 'location_contradiction' });
      } else if (cityToken === 'philadelphia') {
        localCode = 'philadelphia';
      } else if (!countyToken) {
        problems.push({ severity: 'incomplete', code: 'county_missing' });
      } else if (countyToken === 'allegheny') {
        localCode = 'allegheny';
      } else {
        localCode = 'none';
      }
    }
  }

  const severe = problems.some((problem) => problem.severity === 'invalid')
    ? 'invalid'
    : problems.some((problem) => problem.severity === 'unsupported')
      ? 'unsupported'
      : problems.length > 0
        ? 'incomplete'
        : null;

  if (severe || !rule || !transactionDate || stateCode !== 'PA' || localCode == null) {
    const status = severe ?? 'incomplete';
    const visible =
      status === 'incomplete' ? problems : problems.filter((problem) => problem.severity === status);
    return {
      status,
      issues: visible.map(({ code, detail }) => ({ code, ...(detail ? { detail } : {}) })),
    };
  }

  const matches = (input.configurations ?? []).filter(
    (config) =>
      text(config.stateCode).toUpperCase() === 'PA' &&
      config.localCode === localCode &&
      isIsoDate(config.effectiveFrom) &&
      dateCovers(config, transactionDate)
  );
  if (matches.length === 0) {
    return { status: 'incomplete', issues: [{ code: 'no_effective_jurisdiction_configuration' }] };
  }
  if (matches.length > 1) {
    return { status: 'invalid', issues: [{ code: 'jurisdiction_configuration_overlap' }] };
  }

  const ids = jurisdictionIdFor(localCode);
  const warnings: JurisdictionIssue[] = [
    { code: 'configured_sourcing_rule_not_a_department_determination' },
  ];
  if (localCode === 'philadelphia' || localCode === 'allegheny') {
    warnings.push({ code: 'local_collection_duty_unconfirmed' });
  }
  if (rule && selectedDiffersFromOthers(input, rule)) {
    warnings.push({ code: 'unselected_address_differs' });
  }

  return {
    status: 'resolved',
    jurisdictionId: ids.jurisdictionId,
    stateCode: 'PA',
    localCode,
    localJurisdictionId: ids.localJurisdictionId,
    county,
    resolutionMethod: rule,
    source: sourceFor(rule),
    transactionDate,
    configurationId: matches[0].id,
    localityCatalogReference: LOCALITY_CATALOG_REFERENCE,
    warnings,
  };
}

function selectedDiffersFromOthers(input: ResolveJurisdictionInput, rule: ConfiguredSourcingRule): boolean {
  const selected = addressFor(input, rule);
  if (!selected) return false;
  return presentAddresses(input).some((address) => address !== selected && addressesDisagree(selected, address));
}
