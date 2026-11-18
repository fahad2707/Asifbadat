/**
 * Product tobacco compliance profile helpers (PA cigarette reporting prep).
 *
 * Classification is explicit — never inferred from category, name, SKU, or barcode.
 * packs_per_stock_unit is never defaulted to 1 when missing.
 * Stock quantities stay integers; conversion does not round fractional pack results.
 */

export const TOBACCO_CLASSES = ['unknown', 'cigarette', 'little_cigar', 'otp', 'non_tobacco'] as const;
export type TobaccoClass = (typeof TOBACCO_CLASSES)[number];

export const CIGARETTE_PACK_SIZES = [20, 25] as const;
export type CigarettePackSize = (typeof CIGARETTE_PACK_SIZES)[number];

export const STOCK_UNITS = ['pack', 'carton', 'case', 'other'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

export type TobaccoComplianceProfile = {
  tobacco_class: TobaccoClass;
  cigarette_pack_size?: CigarettePackSize | null;
  stock_unit?: StockUnit | null;
  packs_per_stock_unit?: number | null;
};

export type TobaccoComplianceIssue =
  | 'classification_unknown'
  | 'cigarette_pack_size_missing'
  | 'stock_unit_missing'
  | 'packs_per_stock_unit_missing'
  | 'packs_per_stock_unit_invalid_for_pack';

export type TobaccoComplianceStatus = {
  tobacco_class: TobaccoClass;
  cigarette_pack_size: CigarettePackSize | null;
  stock_unit: StockUnit | null;
  packs_per_stock_unit: number | null;
  /** Classification is set and cigarette pack fields are filled when applicable. Not legal/regulatory clearance. */
  tobacco_profile_complete: boolean;
  tobacco_profile_issues: TobaccoComplianceIssue[];
  /** True only when this product can be converted into reportable cigarette packs. */
  cigarette_reporting_ready: boolean;
  cigarette_reporting_applicable: boolean;
  cigarette_reporting_issues: TobaccoComplianceIssue[];
  /**
   * Alias of cigarette_reporting_ready. Kept so existing staff clients do not treat
   * little_cigar / OTP / non_tobacco as overall tobacco-regulation clearance.
   */
  tobacco_compliance_complete: boolean;
  tobacco_compliance_issues: TobaccoComplianceIssue[];
};

/**
 * Why a stock quantity could not be converted into reportable cigarette packs.
 *
 * not_applicable       — product is not classified as a cigarette.
 * incomplete           — stock_unit or packs_per_stock_unit has not been configured.
 * invalid_packaging    — a configured value is not usable (unrecognised stock_unit,
 *                        non-positive/fractional factor, or pack with a factor other than 1).
 * non_integer_quantity — the stock quantity is not a whole number.
 * non_integer_packs    — the multiplication did not produce a whole number.
 */
export type ReportablePackConversionFailure =
  | 'not_applicable'
  | 'incomplete'
  | 'invalid_packaging'
  | 'non_integer_quantity'
  | 'non_integer_packs';

export type ReportablePackConversion =
  | { ok: true; reportable_packs: number }
  | {
      ok: false;
      reason: ReportablePackConversionFailure;
      reportable_packs: null;
    };

const TOBACCO_CLASS_SET = new Set<string>(TOBACCO_CLASSES);
const PACK_SIZE_SET = new Set<number>(CIGARETTE_PACK_SIZES);
const STOCK_UNIT_SET = new Set<string>(STOCK_UNITS);

export function isTobaccoClass(value: unknown): value is TobaccoClass {
  return typeof value === 'string' && TOBACCO_CLASS_SET.has(value);
}

export function normalizeTobaccoClass(value: unknown): TobaccoClass {
  return isTobaccoClass(value) ? value : 'unknown';
}

export function parseOptionalCigarettePackSize(value: unknown): CigarettePackSize | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || !PACK_SIZE_SET.has(n)) {
    throw new Error('cigarette_pack_size must be 20 or 25');
  }
  return n as CigarettePackSize;
}

export function parseOptionalStockUnit(value: unknown): StockUnit | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !STOCK_UNIT_SET.has(value)) {
    throw new Error('stock_unit must be pack, carton, case, or other');
  }
  return value as StockUnit;
}

export function assertTobaccoPackagingInvariant(
  stock_unit: StockUnit | null | undefined,
  packs_per_stock_unit: number | null | undefined
): void {
  if (stock_unit == null) return;
  if (stock_unit === 'pack') {
    if (packs_per_stock_unit !== 1) {
      throw new Error('When stock_unit is pack, packs_per_stock_unit must be 1');
    }
    return;
  }
  if (packs_per_stock_unit == null || !Number.isInteger(packs_per_stock_unit) || packs_per_stock_unit < 1) {
    throw new Error(
      `When stock_unit is ${stock_unit}, packs_per_stock_unit must be an explicit positive integer`
    );
  }
}

export function parseOptionalPacksPerStockUnit(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('packs_per_stock_unit must be a positive integer');
  }
  return n;
}

export function parseTobaccoClass(value: unknown): TobaccoClass | undefined {
  if (value === undefined) return undefined;
  if (!isTobaccoClass(value)) {
    throw new Error(`tobacco_class must be one of: ${TOBACCO_CLASSES.join(', ')}`);
  }
  return value;
}

export type ParsedTobaccoComplianceBody = {
  tobacco_class?: TobaccoClass;
  cigarette_pack_size?: CigarettePackSize | null;
  stock_unit?: StockUnit | null;
  packs_per_stock_unit?: number | null;
};

export function parseTobaccoComplianceBody(body: Record<string, unknown>): ParsedTobaccoComplianceBody {
  const parsed: ParsedTobaccoComplianceBody = {};
  if ('tobacco_class' in body && body.tobacco_class !== undefined) {
    parsed.tobacco_class = parseTobaccoClass(body.tobacco_class);
  }
  if ('cigarette_pack_size' in body && body.cigarette_pack_size !== undefined) {
    parsed.cigarette_pack_size = parseOptionalCigarettePackSize(body.cigarette_pack_size);
  }
  if ('stock_unit' in body && body.stock_unit !== undefined) {
    parsed.stock_unit = parseOptionalStockUnit(body.stock_unit);
  }
  if ('packs_per_stock_unit' in body && body.packs_per_stock_unit !== undefined) {
    parsed.packs_per_stock_unit = parseOptionalPacksPerStockUnit(body.packs_per_stock_unit);
  }
  return parsed;
}

export function tobaccoComplianceCreateFields(parsed: ParsedTobaccoComplianceBody): {
  tobacco_class: TobaccoClass;
  cigarette_pack_size?: CigarettePackSize;
  stock_unit?: StockUnit;
  packs_per_stock_unit?: number;
} {
  const fields: {
    tobacco_class: TobaccoClass;
    cigarette_pack_size?: CigarettePackSize;
    stock_unit?: StockUnit;
    packs_per_stock_unit?: number;
  } = {
    tobacco_class: parsed.tobacco_class ?? 'unknown',
  };
  if (parsed.cigarette_pack_size != null) fields.cigarette_pack_size = parsed.cigarette_pack_size;
  if (parsed.stock_unit != null) fields.stock_unit = parsed.stock_unit;
  if (parsed.packs_per_stock_unit != null) fields.packs_per_stock_unit = parsed.packs_per_stock_unit;
  assertTobaccoPackagingInvariant(fields.stock_unit, fields.packs_per_stock_unit);
  return fields;
}

export function applyTobaccoComplianceToMongoUpdate(
  parsed: ParsedTobaccoComplianceBody,
  update: Record<string, unknown>,
  unset: Record<string, 1>,
  existing?: { stock_unit?: unknown; packs_per_stock_unit?: unknown }
): void {
  if (parsed.tobacco_class !== undefined) update.tobacco_class = parsed.tobacco_class;
  const applyOptional = (key: string, value: unknown) => {
    if (value === undefined) return;
    if (value === null) unset[key] = 1;
    else update[key] = value;
  };
  applyOptional('cigarette_pack_size', parsed.cigarette_pack_size);
  applyOptional('stock_unit', parsed.stock_unit);
  applyOptional('packs_per_stock_unit', parsed.packs_per_stock_unit);

  const mergedUnit =
    parsed.stock_unit !== undefined ? parsed.stock_unit : stockUnitFromDoc(existing?.stock_unit);
  const mergedPacks =
    parsed.packs_per_stock_unit !== undefined
      ? parsed.packs_per_stock_unit
      : packsPerStockUnitFromDoc(existing?.packs_per_stock_unit);
  assertTobaccoPackagingInvariant(mergedUnit, mergedPacks);
}

function packsPerStockUnitFromDoc(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function packSizeFromDoc(value: unknown): CigarettePackSize | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || !PACK_SIZE_SET.has(n)) return null;
  return n as CigarettePackSize;
}

function stockUnitFromDoc(value: unknown): StockUnit | null {
  return typeof value === 'string' && STOCK_UNIT_SET.has(value) ? (value as StockUnit) : null;
}

export function tobaccoComplianceStatus(doc: {
  tobacco_class?: unknown;
  cigarette_pack_size?: unknown;
  stock_unit?: unknown;
  packs_per_stock_unit?: unknown;
}): TobaccoComplianceStatus {
  const tobacco_class = normalizeTobaccoClass(doc.tobacco_class);
  const cigarette_pack_size = packSizeFromDoc(doc.cigarette_pack_size);
  const stock_unit = stockUnitFromDoc(doc.stock_unit);
  const packs_per_stock_unit = packsPerStockUnitFromDoc(doc.packs_per_stock_unit);

  const profileIssues: TobaccoComplianceIssue[] = [];
  const reportingIssues: TobaccoComplianceIssue[] = [];
  if (tobacco_class === 'unknown') {
    profileIssues.push('classification_unknown');
  }
  const cigaretteReportingApplicable = tobacco_class === 'cigarette';
  if (cigaretteReportingApplicable) {
    if (cigarette_pack_size == null) reportingIssues.push('cigarette_pack_size_missing');
    if (stock_unit == null) reportingIssues.push('stock_unit_missing');
    if (stock_unit === 'pack' && packs_per_stock_unit != null && packs_per_stock_unit !== 1) {
      reportingIssues.push('packs_per_stock_unit_invalid_for_pack');
    } else if (packs_per_stock_unit == null) {
      reportingIssues.push('packs_per_stock_unit_missing');
    }
    profileIssues.push(...reportingIssues);
  }

  const cigarette_reporting_ready = cigaretteReportingApplicable && reportingIssues.length === 0;
  const tobacco_profile_complete = profileIssues.length === 0;

  return {
    tobacco_class,
    cigarette_pack_size,
    stock_unit,
    packs_per_stock_unit,
    tobacco_profile_complete,
    tobacco_profile_issues: profileIssues,
    cigarette_reporting_ready,
    cigarette_reporting_applicable: cigaretteReportingApplicable,
    cigarette_reporting_issues: reportingIssues,
    tobacco_compliance_complete: cigarette_reporting_ready,
    tobacco_compliance_issues: reportingIssues,
  };
}

export function staffTobaccoComplianceFields(doc: {
  tobacco_class?: unknown;
  cigarette_pack_size?: unknown;
  stock_unit?: unknown;
  packs_per_stock_unit?: unknown;
}): TobaccoComplianceStatus {
  return tobaccoComplianceStatus(doc);
}

function isUnset(value: unknown): boolean {
  return value == null || value === '';
}

/**
 * Convert a stock quantity into reportable cigarette packs using the product's
 * explicit stock_unit and packs_per_stock_unit.
 *
 * Conversion is refused unless the product is a cigarette with a valid packaging
 * profile: a recognised stock_unit, a positive integer factor, and factor 1 when
 * the unit is pack. A missing unit or factor is never assumed, and quantities are
 * never rounded.
 */
export function convertStockQtyToReportablePacks(
  doc: {
    tobacco_class?: unknown;
    stock_unit?: unknown;
    packs_per_stock_unit?: unknown;
  },
  stockQty: number
): ReportablePackConversion {
  const fail = (reason: ReportablePackConversionFailure): ReportablePackConversion => ({
    ok: false,
    reason,
    reportable_packs: null,
  });

  if (normalizeTobaccoClass(doc.tobacco_class) !== 'cigarette') return fail('not_applicable');

  if (isUnset(doc.stock_unit) || isUnset(doc.packs_per_stock_unit)) return fail('incomplete');

  const stockUnit = stockUnitFromDoc(doc.stock_unit);
  const packsPer = packsPerStockUnitFromDoc(doc.packs_per_stock_unit);
  if (stockUnit == null || packsPer == null) return fail('invalid_packaging');
  try {
    assertTobaccoPackagingInvariant(stockUnit, packsPer);
  } catch {
    return fail('invalid_packaging');
  }

  if (!Number.isInteger(stockQty)) return fail('non_integer_quantity');

  const raw = stockQty * packsPer;
  if (!Number.isInteger(raw)) return fail('non_integer_packs');
  return { ok: true, reportable_packs: raw };
}
