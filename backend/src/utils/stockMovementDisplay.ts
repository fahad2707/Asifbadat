import { StockMovementType } from '../shared/enums';

/**
 * New writers use StockMovementType enum values.
 * Legacy rows used lowercase / POS-specific strings. Read them as-is;
 * this map is only for API display labels.
 */
const LEGACY_MOVEMENT_TYPE: Record<string, string> = {
  sale: StockMovementType.SALE,
  purchase: StockMovementType.PURCHASE,
  adjustment: StockMovementType.ADJUSTMENT,
  pos_return: StockMovementType.RETURN_IN,
};

const DISPLAY_LABEL: Record<string, string> = {
  [StockMovementType.PURCHASE]: 'Purchase',
  [StockMovementType.SALE]: 'Sale',
  [StockMovementType.RETURN_IN]: 'Return in',
  [StockMovementType.RETURN_OUT]: 'Return out',
  [StockMovementType.ADJUSTMENT]: 'Adjustment',
  [StockMovementType.CREDIT_MEMO]: 'Credit memo',
  [StockMovementType.SHIPMENT_OUT]: 'Shipment out',
  [StockMovementType.SHIPMENT_IN]: 'Shipment in',
  [StockMovementType.PHYSICAL_COUNT]: 'Physical count',
};

export function canonicalStockMovementType(stored: unknown): string {
  const raw = String(stored || '');
  if (!raw) return '';
  if (LEGACY_MOVEMENT_TYPE[raw]) return LEGACY_MOVEMENT_TYPE[raw];
  return raw;
}

export function stockMovementTypeLabel(stored: unknown): string {
  const canonical = canonicalStockMovementType(stored);
  return DISPLAY_LABEL[canonical] || canonical || rawFallback(stored);
}

function rawFallback(stored: unknown): string {
  const raw = String(stored || '').trim();
  if (!raw) return 'Movement';
  return raw.replace(/_/g, ' ');
}

export function serializeStockMovement(m: Record<string, unknown>) {
  const admin = m.admin_id as { _id?: unknown; name?: string; email?: string } | string | undefined;
  const adminDoc = admin && typeof admin === 'object' ? admin : null;
  const quantityChange = Number(m.quantity_change) || 0;
  const createdAt = m.created_at;
  return {
    id: String((m._id as { toString?: () => string })?.toString?.() || m._id || ''),
    product_id: String((m.product_id as { toString?: () => string })?.toString?.() || m.product_id || ''),
    movement_type: m.movement_type,
    movement_type_canonical: canonicalStockMovementType(m.movement_type),
    movement_type_label: stockMovementTypeLabel(m.movement_type),
    quantity_before: m.quantity_before != null ? Number(m.quantity_before) : null,
    quantity_change: quantityChange,
    quantity_delta: quantityChange,
    quantity_after: m.quantity_after != null ? Number(m.quantity_after) : null,
    reference_type: m.reference_type || null,
    reference_id: m.reference_id ? String(m.reference_id) : null,
    reference_number: m.reference_number || null,
    reason: m.reason || null,
    notes: m.notes || null,
    admin_id: adminDoc?._id ? String(adminDoc._id) : m.admin_id ? String(m.admin_id) : null,
    performed_by: adminDoc?.name || adminDoc?.email || null,
    created_at: createdAt,
    occurred_at: createdAt,
  };
}
