import mongoose from 'mongoose';
import StockMovement from '../models/StockMovement';
import { StockMovementType } from '../shared/enums';

/**
 * Canonical StockMovement write contract.
 *
 * Product.stock_quantity remains the only authoritative on-hand quantity.
 * This helper never reads or updates Product. The caller must already have
 * applied the stock change and pass the resulting before / delta / after.
 *
 * The helper does not start or commit transactions. Pass the caller's
 * Mongo session so the movement participates in that transaction.
 */

export class StockMovementWriteError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'StockMovementWriteError';
    this.status = status;
  }
}

const CANONICAL_TYPES = new Set<string>(Object.values(StockMovementType));

export type CreateStockMovementInput = {
  session?: mongoose.ClientSession;
  productId: mongoose.Types.ObjectId | string;
  movementType: StockMovementType;
  quantityBefore: number;
  quantityChange: number;
  quantityAfter: number;
  referenceType?: string;
  referenceId?: mongoose.Types.ObjectId | string;
  referenceNumber?: string;
  reason?: string;
  notes?: string;
  adminId?: mongoose.Types.ObjectId | string;
};

function assertInteger(field: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new StockMovementWriteError(`${field} must be a finite integer.`);
  }
}

function toObjectId(value: mongoose.Types.ObjectId | string, field: string): mongoose.Types.ObjectId {
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = String(value);
  if (!mongoose.Types.ObjectId.isValid(raw)) {
    throw new StockMovementWriteError(`Invalid ${field}.`);
  }
  return new mongoose.Types.ObjectId(raw);
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

export async function createStockMovement(input: CreateStockMovementInput) {
  const {
    session,
    productId,
    movementType,
    quantityBefore,
    quantityChange,
    quantityAfter,
    referenceType,
    referenceId,
    referenceNumber,
    reason,
    notes,
    adminId,
  } = input;

  if (!productId) {
    throw new StockMovementWriteError('product_id is required.');
  }
  if (!movementType || !CANONICAL_TYPES.has(movementType)) {
    throw new StockMovementWriteError('movement_type must be a canonical StockMovementType.');
  }

  assertInteger('quantity_before', quantityBefore);
  assertInteger('quantity_change', quantityChange);
  assertInteger('quantity_after', quantityAfter);

  if (quantityAfter !== quantityBefore + quantityChange) {
    throw new StockMovementWriteError('quantity_after must equal quantity_before + quantity_change.');
  }

  const doc: Record<string, unknown> = {
    product_id: toObjectId(productId, 'product_id'),
    movement_type: movementType,
    quantity_change: quantityChange,
    quantity_before: quantityBefore,
    quantity_after: quantityAfter,
  };

  const nextReferenceType = optionalString(referenceType);
  const nextReferenceNumber = optionalString(referenceNumber);
  const nextReason = optionalString(reason);
  const nextNotes = optionalString(notes);

  if (nextReferenceType) doc.reference_type = nextReferenceType;
  if (referenceId) doc.reference_id = toObjectId(referenceId, 'reference_id');
  if (nextReferenceNumber) doc.reference_number = nextReferenceNumber;
  if (nextReason) doc.reason = nextReason;
  if (nextNotes) doc.notes = nextNotes;
  if (adminId) doc.admin_id = toObjectId(adminId, 'admin_id');

  const created = await StockMovement.create([doc], session ? { session } : {});
  return created[0];
}
