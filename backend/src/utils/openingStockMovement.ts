import mongoose from 'mongoose';
import { StockMovementType } from '../shared/enums';
import { createStockMovement } from './createStockMovement';

export const OPENING_STOCK_REFERENCE_TYPE = 'opening';
export const OPENING_STOCK_REASON = 'Opening inventory';

export function shouldWriteOpeningStockMovement(productType: unknown, openingQty: number): boolean {
  if (productType === 'service' || productType === 'non_inventory') return false;
  return openingQty !== 0;
}

export function optionalOpeningAdminId(adminId?: string): mongoose.Types.ObjectId | undefined {
  if (!adminId || !mongoose.Types.ObjectId.isValid(adminId)) return undefined;
  return new mongoose.Types.ObjectId(adminId);
}

export async function writeOpeningStockMovement(opts: {
  productId: mongoose.Types.ObjectId | string;
  openingQty: number;
  session: mongoose.ClientSession;
  adminId?: mongoose.Types.ObjectId | string;
}) {
  await createStockMovement({
    session: opts.session,
    productId: opts.productId,
    movementType: StockMovementType.ADJUSTMENT,
    quantityBefore: 0,
    quantityChange: opts.openingQty,
    quantityAfter: opts.openingQty,
    referenceType: OPENING_STOCK_REFERENCE_TYPE,
    referenceId: opts.productId,
    reason: OPENING_STOCK_REASON,
    adminId: opts.adminId,
  });
}
