export const TOBACCO_CLASSES = ['unknown', 'cigarette', 'little_cigar', 'otp', 'non_tobacco'] as const;
export type TobaccoClass = (typeof TOBACCO_CLASSES)[number];

export const CIGARETTE_PACK_SIZES = [20, 25] as const;
export type CigarettePackSize = (typeof CIGARETTE_PACK_SIZES)[number];

export const STOCK_UNITS = ['pack', 'carton', 'case', 'other'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

export type TobaccoComplianceFormValue = {
  tobacco_class: TobaccoClass;
  cigarette_pack_size: CigarettePackSize | '';
  stock_unit: StockUnit | '';
  packs_per_stock_unit: number | '';
};

export const TOBACCO_CLASS_LABELS: Record<TobaccoClass, string> = {
  unknown: 'Unknown (not verified)',
  cigarette: 'Cigarette',
  little_cigar: 'Little cigar',
  otp: 'Other tobacco product (OTP)',
  non_tobacco: 'Non-tobacco',
};

export const STOCK_UNIT_LABELS: Record<StockUnit, string> = {
  pack: 'Pack',
  carton: 'Carton',
  case: 'Case',
  other: 'Other',
};

export function emptyTobaccoComplianceForm(): TobaccoComplianceFormValue {
  return {
    tobacco_class: 'unknown',
    cigarette_pack_size: '',
    stock_unit: '',
    packs_per_stock_unit: '',
  };
}

export function tobaccoFormFromProduct(product: {
  tobacco_class?: string | null;
  cigarette_pack_size?: number | null;
  stock_unit?: string | null;
  packs_per_stock_unit?: number | null;
}): TobaccoComplianceFormValue {
  const tobacco_class = TOBACCO_CLASSES.includes(product.tobacco_class as TobaccoClass)
    ? (product.tobacco_class as TobaccoClass)
    : 'unknown';
  const packSize = product.cigarette_pack_size === 20 || product.cigarette_pack_size === 25
    ? product.cigarette_pack_size
    : '';
  const stock_unit = STOCK_UNITS.includes(product.stock_unit as StockUnit)
    ? (product.stock_unit as StockUnit)
    : '';
  const packs =
    product.packs_per_stock_unit != null && Number.isInteger(product.packs_per_stock_unit) && product.packs_per_stock_unit >= 1
      ? product.packs_per_stock_unit
      : '';
  return { tobacco_class, cigarette_pack_size: packSize, stock_unit, packs_per_stock_unit: packs };
}

export function tobaccoComplianceFormStatus(value: TobaccoComplianceFormValue): {
  profileComplete: boolean;
  cigaretteReportingReady: boolean;
  cigaretteReportingApplicable: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  if (value.tobacco_class === 'unknown') issues.push('Regulatory classification has not been verified.');
  const cigaretteReportingApplicable = value.tobacco_class === 'cigarette';
  if (cigaretteReportingApplicable) {
    if (value.cigarette_pack_size !== 20 && value.cigarette_pack_size !== 25) {
      issues.push('Cigarette pack size (20 or 25) is required for cigarette reporting.');
    }
    if (!value.stock_unit) issues.push('Stock unit is required for cigarette reporting.');
    if (value.stock_unit === 'pack' && value.packs_per_stock_unit !== 1) {
      issues.push('When stock unit is pack, packs per stock unit must be 1.');
    } else if (value.stock_unit && value.stock_unit !== 'pack' && (value.packs_per_stock_unit === '' || value.packs_per_stock_unit == null)) {
      issues.push('Carton, case, and other units need an explicit packs-per-stock-unit value.');
    } else if (!value.stock_unit && (value.packs_per_stock_unit === '' || value.packs_per_stock_unit == null)) {
      issues.push('Packs per stock unit is required for cigarette reporting and is not assumed to be 1.');
    }
  }
  const cigaretteReportingReady = cigaretteReportingApplicable && issues.length === 0;
  const profileComplete = value.tobacco_class !== 'unknown' && (!cigaretteReportingApplicable || cigaretteReportingReady);
  return { profileComplete, cigaretteReportingReady, cigaretteReportingApplicable, issues };
}

export function tobaccoPayloadFromForm(value: TobaccoComplianceFormValue): {
  tobacco_class: TobaccoClass;
  cigarette_pack_size: CigarettePackSize | null;
  stock_unit: StockUnit | null;
  packs_per_stock_unit: number | null;
} {
  return {
    tobacco_class: value.tobacco_class,
    cigarette_pack_size: value.cigarette_pack_size === 20 || value.cigarette_pack_size === 25 ? value.cigarette_pack_size : null,
    stock_unit: value.stock_unit || null,
    packs_per_stock_unit:
      value.stock_unit === 'pack'
        ? 1
        : value.packs_per_stock_unit === '' || value.packs_per_stock_unit == null
          ? null
          : Math.trunc(Number(value.packs_per_stock_unit)),
  };
}
