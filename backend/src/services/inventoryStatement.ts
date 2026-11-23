import { stockMovementTypeLabel } from '../utils/stockMovementDisplay';

export type StatementProductInput = {
  id: string;
  product_id?: string | null;
  sku?: string | null;
  barcode?: string | null;
  name: string;
  category_name?: string | null;
  sub_category_name?: string | null;
  stock_quantity: number;
  committed_quantity?: number | null;
  low_stock_threshold?: number | null;
  cost_price?: number | null;
  price?: number | null;
  is_active?: boolean;
};

export type StatementMovementInput = {
  id: string;
  product_id: string;
  created_at: string | Date;
  movement_type?: string | null;
  reference_type?: string | null;
  reference_number?: string | null;
  notes?: string | null;
  quantity_before?: number | null;
  quantity_change: number;
  quantity_after?: number | null;
  performed_by?: string | null;
};

export type StatementLine = {
  id: string;
  created_at: string;
  product_id: string;
  product_name: string;
  product_code: string | null;
  sku: string | null;
  type: string;
  reference: string;
  notes: string | null;
  quantity_in: number;
  quantity_out: number;
  balance_qty: number;
  purchase_value: number | null;
  estimated_value: number | null;
  running_purchase_value: number | null;
  running_estimated_value: number | null;
  performed_by: string | null;
};

export type ProductStatement = {
  id: string;
  product_id: string | null;
  sku: string | null;
  barcode: string | null;
  name: string;
  category_name: string | null;
  sub_category_name: string | null;
  is_active: boolean;
  cost_price: number | null;
  price: number | null;
  buffer: number | null;
  committed_quantity: number;
  available_quantity: number;
  stock_now: number;
  opening_qty: number;
  closing_qty: number;
  units_in: number;
  units_out: number;
  opening_purchase_value: number | null;
  closing_purchase_value: number | null;
  opening_estimated_value: number | null;
  closing_estimated_value: number | null;
  lines: StatementLine[];
};

export type InventoryStatement = {
  business_name: string;
  generated_at: string;
  period_start: string;
  period_end: string;
  valuation_note: string;
  summary: {
    product_count: number;
    opening_units: number;
    closing_units: number;
    units_in: number;
    units_out: number;
    opening_purchase_value: number;
    closing_purchase_value: number;
    opening_estimated_value: number;
    closing_estimated_value: number;
    products_missing_cost: number;
    products_missing_price: number;
    activity: Array<{ type: string; count: number; units_in: number; units_out: number }>;
  };
  register: StatementLine[];
  products: ProductStatement[];
};

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function unitMoney(qty: number, unit: number | null | undefined): number | null {
  if (unit == null || !Number.isFinite(Number(unit))) return null;
  return roundMoney(qty * Number(unit));
}

function finiteUnit(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(value);
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function movementType(row: StatementMovementInput): string {
  if (String(row.reference_type || '').toLowerCase() === 'opening') return 'Opening';
  return stockMovementTypeLabel(row.movement_type);
}

function movementReference(row: StatementMovementInput): string {
  const num = row.reference_number?.trim();
  const type = row.reference_type?.trim();
  const typeLabel = type ? titleCase(type) : '';
  if (num && typeLabel) return `${typeLabel} · ${num}`;
  if (num) return num;
  if (typeLabel) return typeLabel;
  return '—';
}

function at(value: string | Date): number {
  return new Date(value).getTime();
}

export function buildInventoryStatement(input: {
  businessName: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt?: Date;
  products: StatementProductInput[];
  movements: StatementMovementInput[];
}): InventoryStatement {
  const startMs = input.periodStart.getTime();
  const endMs = input.periodEnd.getTime();
  const products = [...input.products].sort((a, b) => a.name.localeCompare(b.name));
  const byProduct = new Map<string, StatementMovementInput[]>();
  for (const movement of input.movements) {
    const list = byProduct.get(movement.product_id) || [];
    list.push(movement);
    byProduct.set(movement.product_id, list);
  }

  const openingQty = new Map<string, number>();
  const closingQty = new Map<string, number>();
  const productStatements: ProductStatement[] = [];
  const during: StatementMovementInput[] = [];

  for (const product of products) {
    const rows = (byProduct.get(product.id) || []).slice().sort((a, b) => at(a.created_at) - at(b.created_at));
    const afterDelta = rows
      .filter((row) => at(row.created_at) > endMs)
      .reduce((sum, row) => sum + (Number(row.quantity_change) || 0), 0);
    const inPeriod = rows.filter((row) => {
      const time = at(row.created_at);
      return time >= startMs && time <= endMs;
    });
    const periodDelta = inPeriod.reduce((sum, row) => sum + (Number(row.quantity_change) || 0), 0);
    const current = Number(product.stock_quantity) || 0;
    const closing = current - afterDelta;
    const opening = closing - periodDelta;
    openingQty.set(product.id, opening);
    closingQty.set(product.id, closing);
    during.push(...inPeriod);

    const cost = finiteUnit(product.cost_price);
    const price = finiteUnit(product.price);
    const unitsIn = inPeriod.reduce((sum, row) => sum + Math.max(0, Number(row.quantity_change) || 0), 0);
    const unitsOut = inPeriod.reduce((sum, row) => sum + Math.max(0, -(Number(row.quantity_change) || 0)), 0);
    const committed = Number(product.committed_quantity) || 0;
    productStatements.push({
      id: product.id,
      product_id: product.product_id || null,
      sku: product.sku || null,
      barcode: product.barcode || null,
      name: product.name,
      category_name: product.category_name || null,
      sub_category_name: product.sub_category_name || null,
      is_active: product.is_active !== false,
      cost_price: cost,
      price,
      buffer: product.low_stock_threshold == null ? null : Number(product.low_stock_threshold),
      committed_quantity: committed,
      available_quantity: current - committed,
      stock_now: current,
      opening_qty: opening,
      closing_qty: closing,
      units_in: unitsIn,
      units_out: unitsOut,
      opening_purchase_value: unitMoney(opening, cost),
      closing_purchase_value: unitMoney(closing, cost),
      opening_estimated_value: unitMoney(opening, price),
      closing_estimated_value: unitMoney(closing, price),
      lines: [],
    });
  }

  const productById = new Map(productStatements.map((product) => [product.id, product]));
  const runningQty = new Map(openingQty);
  let runningPurchase = productStatements.reduce((sum, product) => sum + (product.opening_purchase_value || 0), 0);
  let runningEstimated = productStatements.reduce((sum, product) => sum + (product.opening_estimated_value || 0), 0);
  const activity = new Map<string, { type: string; count: number; units_in: number; units_out: number }>();

  const register: StatementLine[] = during
    .slice()
    .sort((a, b) => at(a.created_at) - at(b.created_at) || a.id.localeCompare(b.id))
    .map((row) => {
      const product = productById.get(row.product_id);
      const change = Number(row.quantity_change) || 0;
      const nextQty = (runningQty.get(row.product_id) || 0) + change;
      runningQty.set(row.product_id, nextQty);
      const cost = product?.cost_price ?? null;
      const price = product?.price ?? null;
      if (cost != null) runningPurchase = roundMoney(runningPurchase + change * cost);
      if (price != null) runningEstimated = roundMoney(runningEstimated + change * price);
      const type = movementType(row);
      const bucket = activity.get(type) || { type, count: 0, units_in: 0, units_out: 0 };
      bucket.count += 1;
      if (change > 0) bucket.units_in += change;
      if (change < 0) bucket.units_out += -change;
      activity.set(type, bucket);
      const line: StatementLine = {
        id: row.id,
        created_at: new Date(row.created_at).toISOString(),
        product_id: row.product_id,
        product_name: product?.name || 'Unknown product',
        product_code: product?.product_id || null,
        sku: product?.sku || null,
        type,
        reference: movementReference(row),
        notes: row.notes?.trim() || null,
        quantity_in: change > 0 ? change : 0,
        quantity_out: change < 0 ? -change : 0,
        balance_qty: nextQty,
        purchase_value: unitMoney(nextQty, cost),
        estimated_value: unitMoney(nextQty, price),
        running_purchase_value: roundMoney(runningPurchase),
        running_estimated_value: roundMoney(runningEstimated),
        performed_by: row.performed_by?.trim() || null,
      };
      product?.lines.push(line);
      return line;
    });

  const sum = (pick: (product: ProductStatement) => number | null) =>
    roundMoney(productStatements.reduce((total, product) => total + (pick(product) || 0), 0));

  return {
    business_name: input.businessName,
    generated_at: (input.generatedAt || new Date()).toISOString(),
    period_start: input.periodStart.toISOString(),
    period_end: input.periodEnd.toISOString(),
    valuation_note:
      'Quantities are rebuilt from stock movements. Dollar amounts use each product’s current cost and selling price.',
    summary: {
      product_count: productStatements.length,
      opening_units: productStatements.reduce((sumQty, product) => sumQty + product.opening_qty, 0),
      closing_units: productStatements.reduce((sumQty, product) => sumQty + product.closing_qty, 0),
      units_in: productStatements.reduce((sumQty, product) => sumQty + product.units_in, 0),
      units_out: productStatements.reduce((sumQty, product) => sumQty + product.units_out, 0),
      opening_purchase_value: sum((product) => product.opening_purchase_value),
      closing_purchase_value: sum((product) => product.closing_purchase_value),
      opening_estimated_value: sum((product) => product.opening_estimated_value),
      closing_estimated_value: sum((product) => product.closing_estimated_value),
      products_missing_cost: productStatements.filter((product) => product.cost_price == null).length,
      products_missing_price: productStatements.filter((product) => product.price == null).length,
      activity: [...activity.values()].sort((a, b) => a.type.localeCompare(b.type)),
    },
    register,
    products: productStatements,
  };
}
