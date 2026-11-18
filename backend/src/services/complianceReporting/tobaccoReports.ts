/**
 * REV-772 and REV-777 previews.
 *
 * Pack counts come only from convertStockQtyToReportablePacks. Stamp,
 * purchaser, and shipping method are never guessed. Nothing here is filing-ready.
 * The posted paper forms were checked on 2026-11-16; myPATH layouts were not.
 */

import { convertStockQtyToReportablePacks } from '../../utils/productTobaccoCompliance';

export const TOBACCO_OFFICIAL_SOURCES = [
  {
    id: 'rev-772',
    title: 'Cigarette Wholesaler Monthly Report REV-772 (AS) 05-18',
    url: 'https://www.pa.gov/content/dam/copapwp-pagov/en/revenue/documents/formsandpublications/formsforbusinesses/cigarettetax/documents/rev-772.pdf',
    checkedOn: '2026-11-16',
    myPathLayoutVerified: false,
  },
  {
    id: 'rev-777',
    title: 'Schedule B REV-777 AS (10-14)',
    url: 'https://www.pa.gov/content/dam/copapwp-pagov/en/revenue/documents/formsandpublications/formsforbusinesses/cigarettetax/documents/rev-777.pdf',
    checkedOn: '2026-11-16',
    myPathLayoutVerified: false,
  },
] as const;

export const SHIP_METHOD_CODES = ['DT', 'CC', 'PP', 'CT'] as const;
export type ShipMethodCode = (typeof SHIP_METHOD_CODES)[number];

export type StampClass = 'pennsylvania' | 'philadelphia' | 'other' | 'unknown';

export type TobaccoMovementInput = {
  id: string;
  movementType:
    | 'opening'
    | 'receipt'
    | 'sale'
    | 'supplier_return'
    | 'customer_return'
    | 'adjustment'
    | 'other_removal'
    | 'closing';
  quantity: number;
  tobaccoClass?: unknown;
  stockUnit?: unknown;
  packsPerStockUnit?: unknown;
  packSize?: 20 | 25 | null;
  stamp?: StampClass;
};

/**
 * A recorded pack count was produced by a converted movement, including a
 * real zero. Unavailable means that evidence was not on the ledger.
 * Absence of a movement is not stored as zero.
 */
export type EstablishedPacks =
  | { availability: 'recorded'; packs: number }
  | { availability: 'unavailable'; reason: string };

export type PackBuckets = {
  pennsylvania20: EstablishedPacks;
  pennsylvania25: EstablishedPacks;
  philadelphia20: EstablishedPacks;
  philadelphia25: EstablishedPacks;
  other20: EstablishedPacks;
  other25: EstablishedPacks;
};

export type Rev772Categories = {
  opening: EstablishedPacks;
  receipts: EstablishedPacks;
  sales: EstablishedPacks;
  supplierReturns: EstablishedPacks;
  customerReturns: EstablishedPacks;
  adjustments: EstablishedPacks;
  otherRemovals: EstablishedPacks;
};

export type Rev772Preview = {
  filingReady: false;
  status: 'preview' | 'incomplete';
  myPathLayoutVerified: false;
  buckets: PackBuckets;
  categories: Rev772Categories;
  calculatedClosingPacks: EstablishedPacks;
  statedClosingPacks: EstablishedPacks;
  differencePacks: EstablishedPacks;
  exceptions: Array<{ id: string; reason: string }>;
  blockers: string[];
};

export type Rev777LineInput = {
  id: string;
  saleDate?: string | null;
  invoiceNumber?: string | null;
  purchaserName?: string | null;
  purchaserAddress?: string | null;
  destinationState?: string | null;
  shipMethod?: string | null;
  quantity: number;
  tobaccoClass?: unknown;
  stockUnit?: unknown;
  packsPerStockUnit?: unknown;
  packSize?: 20 | 25 | null;
  stamp?: StampClass;
};

export type Rev777Preview = {
  filingReady: false;
  status: 'preview' | 'incomplete';
  myPathLayoutVerified: false;
  lines: Array<{ id: string; packs: number; packSize: 20 | 25; stamp: Exclude<StampClass, 'unknown'>; shipMethod: ShipMethodCode }>;
  exceptions: Array<{ id: string; reason: string }>;
  blockers: string[];
};

const unavailable = (reason: string): EstablishedPacks => ({ availability: 'unavailable', reason });
const recorded = (packs: number): EstablishedPacks => ({ availability: 'recorded', packs });

function freshBuckets(): PackBuckets {
  return {
    pennsylvania20: unavailable('bucket_not_established'),
    pennsylvania25: unavailable('bucket_not_established'),
    philadelphia20: unavailable('bucket_not_established'),
    philadelphia25: unavailable('bucket_not_established'),
    other20: unavailable('bucket_not_established'),
    other25: unavailable('bucket_not_established'),
  };
}

function freshCategories(): Rev772Categories {
  return {
    opening: unavailable('opening_not_established'),
    receipts: unavailable('receipts_not_established'),
    sales: unavailable('sales_not_established'),
    supplierReturns: unavailable('supplier_returns_not_established'),
    customerReturns: unavailable('customer_returns_not_established'),
    adjustments: unavailable('adjustments_not_established'),
    otherRemovals: unavailable('other_removals_not_established'),
  };
}

function addPacks(current: EstablishedPacks, packs: number): EstablishedPacks {
  const base = current.availability === 'recorded' ? current.packs : 0;
  return recorded(base + packs);
}

function bucketKey(stamp: Exclude<StampClass, 'unknown'>, packSize: 20 | 25): keyof PackBuckets {
  if (stamp === 'pennsylvania') return packSize === 20 ? 'pennsylvania20' : 'pennsylvania25';
  if (stamp === 'philadelphia') return packSize === 20 ? 'philadelphia20' : 'philadelphia25';
  return packSize === 20 ? 'other20' : 'other25';
}

function packsFor(movement: {
  id: string;
  quantity: number;
  tobaccoClass?: unknown;
  stockUnit?: unknown;
  packsPerStockUnit?: unknown;
  packSize?: 20 | 25 | null;
  stamp?: StampClass;
}): { ok: true; packs: number; packSize: 20 | 25; stamp: Exclude<StampClass, 'unknown'> } | { ok: false; reason: string } {
  if (movement.packSize !== 20 && movement.packSize !== 25) return { ok: false, reason: 'pack_size_missing' };
  if (!movement.stamp || movement.stamp === 'unknown') return { ok: false, reason: 'stamp_missing' };
  const converted = convertStockQtyToReportablePacks(
    {
      tobacco_class: movement.tobaccoClass,
      stock_unit: movement.stockUnit,
      packs_per_stock_unit: movement.packsPerStockUnit,
    },
    movement.quantity
  );
  if (!converted.ok || converted.reportable_packs == null) {
    return { ok: false, reason: converted.ok ? 'pack_conversion_failed' : converted.reason };
  }
  return { ok: true, packs: converted.reportable_packs, packSize: movement.packSize, stamp: movement.stamp };
}

function signedPacks(movementType: TobaccoMovementInput['movementType'], packs: number): number | null {
  if (movementType === 'opening' || movementType === 'receipt' || movementType === 'customer_return') return packs;
  if (movementType === 'sale' || movementType === 'supplier_return' || movementType === 'other_removal') return -Math.abs(packs);
  if (movementType === 'adjustment') return packs;
  return null;
}

export function buildRev772Preview(movements: TobaccoMovementInput[]): Rev772Preview {
  const buckets = freshBuckets();
  const categories = freshCategories();
  const exceptions: Rev772Preview['exceptions'] = [];
  let flow = 0;
  let flowKnown = true;
  let sawOpening = false;
  let statedClosing: number | null = null;

  for (const movement of movements) {
    const converted = packsFor(movement);
    if (!converted.ok) {
      exceptions.push({ id: movement.id, reason: converted.reason });
      if (movement.movementType !== 'closing') flowKnown = false;
      continue;
    }
    const key = bucketKey(converted.stamp, converted.packSize);
    if (movement.movementType === 'closing') {
      statedClosing = statedClosing == null ? converted.packs : statedClosing + converted.packs;
      continue;
    }
    const signed = signedPacks(movement.movementType, converted.packs);
    if (signed == null) {
      exceptions.push({ id: movement.id, reason: 'movement_type_unsupported' });
      flowKnown = false;
      continue;
    }
    buckets[key] = addPacks(buckets[key], signed);
    flow += signed;
    if (movement.movementType === 'opening') {
      sawOpening = true;
      categories.opening = addPacks(categories.opening, converted.packs);
    }
    if (movement.movementType === 'receipt') categories.receipts = addPacks(categories.receipts, converted.packs);
    if (movement.movementType === 'sale') categories.sales = addPacks(categories.sales, converted.packs);
    if (movement.movementType === 'supplier_return') categories.supplierReturns = addPacks(categories.supplierReturns, converted.packs);
    if (movement.movementType === 'customer_return') categories.customerReturns = addPacks(categories.customerReturns, converted.packs);
    if (movement.movementType === 'adjustment') categories.adjustments = addPacks(categories.adjustments, signed);
    if (movement.movementType === 'other_removal') categories.otherRemovals = addPacks(categories.otherRemovals, converted.packs);
  }

  const calculatedClosingPacks = !flowKnown
    ? unavailable('movement_not_converted')
    : !sawOpening
      ? unavailable('opening_not_established')
      : recorded(flow);
  const statedClosingPacks = statedClosing == null ? unavailable('closing_not_established') : recorded(statedClosing);
  const differencePacks = calculatedClosingPacks.availability === 'recorded' && statedClosingPacks.availability === 'recorded'
    ? recorded(statedClosingPacks.packs - calculatedClosingPacks.packs)
    : unavailable('difference_not_established');
  const balanced = differencePacks.availability === 'recorded' && differencePacks.packs === 0;
  return {
    filingReady: false,
    status: exceptions.length > 0 || !balanced ? 'incomplete' : 'preview',
    myPathLayoutVerified: false,
    buckets,
    categories,
    calculatedClosingPacks,
    statedClosingPacks,
    differencePacks,
    exceptions,
    blockers: ['cigarette_wholesaler_licence', 'my_path_layout_unverified'],
  };
}

export function buildRev777Preview(lines: Rev777LineInput[]): Rev777Preview {
  const included: Rev777Preview['lines'] = [];
  const exceptions: Rev777Preview['exceptions'] = [];
  for (const line of lines) {
    if (!line.saleDate) exceptions.push({ id: line.id, reason: 'sale_date_missing' });
    if (!line.invoiceNumber) exceptions.push({ id: line.id, reason: 'invoice_number_missing' });
    if (!line.purchaserName || !line.purchaserAddress) exceptions.push({ id: line.id, reason: 'purchaser_missing' });
    if (!line.destinationState) exceptions.push({ id: line.id, reason: 'destination_state_missing' });
    const ship = typeof line.shipMethod === 'string' ? line.shipMethod.trim().toUpperCase() : '';
    const shipOk = (SHIP_METHOD_CODES as readonly string[]).includes(ship);
    if (!shipOk) exceptions.push({ id: line.id, reason: 'ship_method_unclassified' });
    const converted = packsFor({ ...line, quantity: line.quantity });
    if (!converted.ok) {
      exceptions.push({ id: line.id, reason: converted.reason });
      continue;
    }
    if (!line.saleDate || !line.invoiceNumber || !line.purchaserName || !line.purchaserAddress || !line.destinationState || !shipOk) {
      continue;
    }
    included.push({
      id: line.id,
      packs: converted.packs,
      packSize: converted.packSize,
      stamp: converted.stamp,
      shipMethod: ship as ShipMethodCode,
    });
  }
  return {
    filingReady: false,
    status: lines.length === 0 || exceptions.length > 0 ? 'incomplete' : 'preview',
    myPathLayoutVerified: false,
    lines: included,
    exceptions,
    blockers: ['cigarette_wholesaler_licence', 'purchaser_classes', 'counter_versus_shipped', 'my_path_layout_unverified'],
  };
}
