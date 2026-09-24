import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import Return, {
  POS_RETURN_DISPOSITIONS,
  POS_RETURN_REFUND_METHODS,
} from '../models/Return';
import POSSale from '../models/POSSale';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import User from '../models/User';
import PosReturnSettlement from '../models/PosReturnSettlement';
import PosCustomerCredit from '../models/PosCustomerCredit';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { calculatePosReturnRefund, PosReturnCalcError } from '../utils/posReturnCalc';
import { PosReturnQtyError, posReturnQuantityClaimFilter, posReturnQuantityClaimUpdate } from '../utils/posReturnQty';
import { PosReturnWindowError, resolvePosReturnWindow } from '../utils/posReturnWindow';
import { isIdempotencyDuplicateKey, waitForCommittedKeyedSale } from '../utils/posIdempotency';
import { roundMoney } from '../services/paymentApplication';
import {
  formatPosReturnSettlementResponse,
  isReturnSettlementDuplicateKey,
  posReturnHasEligibleCreditCustomer,
  posReturnSettlementClaimFilter,
  posReturnSettlementClaimUpdate,
  PosReturnSettlementError,
} from '../utils/posReturnSettlement';

const router = express.Router();

const generateReturnNumber = () => `RET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

function formatPosReturnResponse(ret: any) {
  const obj = typeof ret?.toObject === 'function' ? ret.toObject() : { ...ret };
  return {
    return: {
      id: String(ret?._id ?? obj?._id),
      ...obj,
    },
  };
}

function isInventoryProduct(product: { product_type?: string } | null | undefined): boolean {
  if (!product) return false;
  return product.product_type !== 'non_inventory' && product.product_type !== 'service';
}

function sendCommittedPosReturnReplay(res: express.Response, ret: unknown) {
  return res.status(200).json(formatPosReturnResponse(ret));
}

// List returns
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { limit = 50 } = req.query;
    const returns = await Return.find()
      .sort({ created_at: -1 })
      .limit(Number(limit))
      .lean();
    res.json({
      returns: returns.map((r: any) => ({
        id: r._id.toString(),
        return_number: r.return_number,
        sale_id: r.sale_id?.toString(),
        sale_number: r.sale_number,
        total_refund: r.total_refund,
        refund_method: r.refund_method,
        status: r.status,
        settlement_status: r.settlement_status,
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    console.error('List returns error:', error);
    res.status(500).json({ error: 'Failed to fetch returns' });
  }
});

router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      sale_id: z.string().trim().min(1),
      items: z
        .array(
          z.object({
            product_id: z.string().trim().min(1),
            quantity: z.number().int().positive(),
            inventory_disposition: z.enum(POS_RETURN_DISPOSITIONS),
          })
        )
        .min(1),
      refund_method: z.enum(POS_RETURN_REFUND_METHODS),
      cheque_reference: z.string().trim().min(1).max(128).optional(),
      return_window_days: z.number().optional(),
      idempotency_key: z.string().trim().min(1).max(128).optional(),
    });

    const {
      sale_id: saleId,
      items,
      refund_method,
      cheque_reference,
      return_window_days,
      idempotency_key: idempotencyKey,
    } = schema.parse(req.body);

    const adminId = req.userId!;

    if (idempotencyKey) {
      const existingReturn = await Return.findOne({ idempotency_key: idempotencyKey });
      if (existingReturn) {
        return sendCommittedPosReturnReplay(res, existingReturn);
      }
    }

    if (!mongoose.isValidObjectId(saleId)) {
      return res.status(400).json({ error: 'Invalid sale_id.' });
    }

    const sale = await POSSale.findById(saleId);
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    let window;
    try {
      window = resolvePosReturnWindow({
        saleCreatedAt: sale.created_at,
        requestedWindowDays: return_window_days,
      });
    } catch (error) {
      if (error instanceof PosReturnWindowError) {
        return res.status(error.status).json({ error: error.message });
      }
      throw error;
    }

    const existingReturns = await Return.find({ sale_id: sale._id, status: 'completed' }).lean();

    const requestedByProduct = new Map<string, { product_id: string; quantity: number }>();
    for (const item of items) {
      const existing = requestedByProduct.get(item.product_id);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        requestedByProduct.set(item.product_id, {
          product_id: item.product_id,
          quantity: item.quantity,
        });
      }
    }

    let calc;
    try {
      calc = calculatePosReturnRefund(sale, [...requestedByProduct.values()], existingReturns);
    } catch (error) {
      if (error instanceof PosReturnCalcError) {
        return res.status(error.status).json({ error: error.message });
      }
      throw error;
    }

    const calcByProduct = new Map(calc.lines.map((line) => [line.product_id, line]));
    const uniqueProductIds = [...new Set(items.map((item) => item.product_id))];
    const productsById = new Map<string, any>();
    for (const productId of uniqueProductIds) {
      const product = await Product.findById(productId);
      if (product) productsById.set(productId, product);
    }

    for (const item of items) {
      if (item.inventory_disposition !== 'resalable') continue;
      const product = productsById.get(item.product_id);
      if (!product) {
        return res.status(404).json({ error: `Product ${item.product_id} was not found.` });
      }
    }

    const returnItems = items.map((item) => {
      const calcLine = calcByProduct.get(item.product_id)!;
      const product = productsById.get(item.product_id);
      return {
        product_id: item.product_id,
        product_name: calcLine.product_name || product?.name || 'Product',
        quantity: item.quantity,
        original_unit_price: calcLine.original_unit_price,
        allocated_discount_per_unit: calcLine.allocated_discount_per_unit,
        refundable_unit_amount: calcLine.refundable_unit_amount,
        refundable_amount: roundMoney(calcLine.refundable_unit_amount * item.quantity),
        inventory_disposition: item.inventory_disposition,
      };
    });

    const claimLines = calc.lines.map((line) => ({
      product_id: line.product_id,
      quantity: line.requested_quantity,
      original_quantity: line.original_quantity,
    }));

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const [created] = await Return.create(
        [
          {
            return_number: generateReturnNumber(),
            ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
            status: 'completed',
            sale_id: sale._id,
            sale_number: sale.sale_number,
            invoice_id: sale.invoice_id,
            sale_created_at: sale.created_at,
            customer_id: sale.customer_id,
            pos_customer_id: sale.pos_customer_id,
            customer_name: sale.customer_name,
            customer_phone: sale.customer_phone,
            items: returnItems,
            total_refund: calc.total_refund,
            refund_method,
            settlement_status: 'unsettled',
            ...(cheque_reference ? { cheque_reference } : {}),
            return_window_days: window.return_window_days,
            return_deadline: window.return_deadline,
            window_extended: window.window_extended,
            ...(window.window_extended ? { window_extended_by: adminId } : {}),
            admin_id: adminId,
          },
        ],
        { session }
      );

      const claimed = await POSSale.findOneAndUpdate(
        posReturnQuantityClaimFilter(sale._id, claimLines),
        posReturnQuantityClaimUpdate(claimLines),
        { session, new: true }
      );
      if (!claimed) {
        throw new PosReturnQtyError(
          'Cannot complete this return. Remaining returnable quantity is insufficient.'
        );
      }

      for (const item of returnItems) {
        if (item.inventory_disposition !== 'resalable') continue;
        const product = productsById.get(String(item.product_id));
        if (!isInventoryProduct(product)) continue;

        const restored = await Product.findOneAndUpdate(
          { _id: item.product_id },
          { $inc: { stock_quantity: item.quantity } },
          { session, new: true }
        );
        if (!restored) {
          throw new Error('Failed to restore inventory for a returned product.');
        }

        await StockMovement.create(
          [
            {
              product_id: item.product_id,
              movement_type: 'pos_return',
              quantity_change: item.quantity,
              reference_type: 'pos_return',
              reference_id: created._id,
              admin_id: adminId,
            },
          ],
          { session }
        );
      }

      if (sale.customer_id) {
        await User.findByIdAndUpdate(
          sale.customer_id,
          { $inc: { total_spent: -calc.total_refund } },
          { session }
        );
      }

      await session.commitTransaction();
      return res.status(201).json(formatPosReturnResponse(created));
    } catch (error) {
      await session.abortTransaction();
      if (error instanceof PosReturnQtyError) {
        return res.status(error.status).json({ error: error.message });
      }
      if (idempotencyKey && isIdempotencyDuplicateKey(error)) {
        const committed = await waitForCommittedKeyedSale(() =>
          Return.findOne({ idempotency_key: idempotencyKey })
        );
        if (committed) {
          return sendCommittedPosReturnReplay(res, committed);
        }
        return res.status(409).json({
          error: 'POS return with this idempotency key is not yet committed. Retry the same request.',
        });
      }
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create POS return error:', error);
    res.status(500).json({ error: 'Failed to create POS return' });
  }
});

async function loadCommittedSettlement(returnId: unknown) {
  const settlement = await PosReturnSettlement.findOne({ return_id: returnId });
  if (!settlement) return null;
  const ret = await Return.findById(returnId);
  if (!ret) return null;
  return formatPosReturnSettlementResponse(settlement, ret);
}

router.post('/:returnId/settle', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      refund_method: z.enum(POS_RETURN_REFUND_METHODS),
      cheque_reference: z.string().trim().min(1).max(128).optional(),
    });
    const { refund_method, cheque_reference } = schema.parse(req.body);
    const { returnId } = req.params;
    const adminId = req.userId!;

    if (!mongoose.isValidObjectId(returnId)) {
      return res.status(400).json({ error: 'Invalid return id.' });
    }

    if (refund_method === 'cheque' && !cheque_reference) {
      return res.status(400).json({ error: 'cheque_reference is required for cheque refunds.' });
    }

    const existing = await Return.findById(returnId);
    if (!existing) {
      return res.status(404).json({ error: 'Return not found' });
    }

    if (existing.settlement_status === 'settled') {
      const replay = await loadCommittedSettlement(existing._id);
      if (replay) {
        return res.status(200).json(replay);
      }
      return res.status(409).json({
        error: 'POS return settlement is not yet committed. Retry the same request.',
      });
    }

    if (refund_method === 'credit' && !posReturnHasEligibleCreditCustomer(existing)) {
      return res.status(400).json({ error: 'Credit refunds require an eligible customer on the return.' });
    }

    const amount = roundMoney(existing.total_refund);
    const settledAt = new Date();

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const claimed = await Return.findOneAndUpdate(
        posReturnSettlementClaimFilter(existing._id),
        posReturnSettlementClaimUpdate({
          settled_at: settledAt,
          refund_method,
          cheque_reference,
        }),
        { session, new: true }
      );
      if (!claimed) {
        throw new PosReturnSettlementError('This return has already been settled.', 409);
      }

      const [settlement] = await PosReturnSettlement.create(
        [
          {
            return_id: existing._id,
            return_number: existing.return_number,
            amount,
            refund_method,
            ...(cheque_reference ? { cheque_reference } : {}),
            ...(existing.customer_id ? { customer_id: existing.customer_id } : {}),
            admin_id: adminId,
            settled_at: settledAt,
          },
        ],
        { session }
      );

      if (refund_method === 'credit') {
        await PosCustomerCredit.create(
          [
            {
              customer_id: existing.customer_id,
              return_id: existing._id,
              settlement_id: settlement._id,
              amount,
              type: 'pos_return_credit',
              direction: 'credit',
              admin_id: adminId,
            },
          ],
          { session }
        );
      }

      const settledReturn = await Return.findByIdAndUpdate(
        existing._id,
        { $set: { settlement_id: settlement._id } },
        { session, new: true }
      );

      await session.commitTransaction();
      return res.status(201).json(formatPosReturnSettlementResponse(settlement, settledReturn ?? claimed));
    } catch (error) {
      await session.abortTransaction();
      if (error instanceof PosReturnSettlementError && error.status === 409) {
        const replay = await waitForCommittedKeyedSale(() => loadCommittedSettlement(existing._id));
        if (replay) {
          return res.status(200).json(replay);
        }
        return res.status(409).json({
          error: 'POS return settlement is not yet committed. Retry the same request.',
        });
      }
      if (isReturnSettlementDuplicateKey(error)) {
        const replay = await waitForCommittedKeyedSale(() => loadCommittedSettlement(existing._id));
        if (replay) {
          return res.status(200).json(replay);
        }
        return res.status(409).json({
          error: 'POS return settlement is not yet committed. Retry the same request.',
        });
      }
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (error instanceof PosReturnSettlementError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Settle POS return error:', error);
    res.status(500).json({ error: 'Failed to settle POS return' });
  }
});

export default router;
