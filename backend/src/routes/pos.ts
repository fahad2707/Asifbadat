import express from 'express';
import mongoose from 'mongoose';
import POSSale from '../models/POSSale';
import Product from '../models/Product';
import Invoice from '../models/Invoice';
import StockMovement from '../models/StockMovement';
import User from '../models/User';
import Customer from '../models/Customer';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { roundMoney } from '../services/paymentApplication';
import { PosTenderError, normalizePosTenders } from '../utils/posTender';
import { PosStockError, posStockDecrementFilter } from '../utils/posStock';
import {
  formatPosSaleResponse,
  isIdempotencyDuplicateKey,
  waitForCommittedKeyedSale,
} from '../utils/posIdempotency';

const router = express.Router();

// Generate sale number
const generateSaleNumber = () => {
  return `POS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

async function sendCommittedPosSaleReplay(res: express.Response, sale: { invoice_id?: unknown }) {
  if (!sale.invoice_id) {
    return res.status(500).json({ error: 'Failed to load POS sale invoice' });
  }
  const invoice = await Invoice.findById(sale.invoice_id);
  if (!invoice) {
    return res.status(500).json({ error: 'Failed to load POS sale invoice' });
  }
  // 200: replay of an already-committed sale (201 remains the first-create contract).
  return res.status(200).json(formatPosSaleResponse(sale, invoice));
}

const POS_CATALOG_ACTIVE = {
  $nor: [{ is_active: false }, { is_active: 'false' }, { is_active: 0 }],
} as const;

// Search product by barcode, PLU, SKU, or name
router.get('/products/search', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { q, type } = req.query; // q = search term, type = 'barcode', 'plu', 'sku', 'name'

    if (!q) {
      return res.json({ products: [] });
    }

    const code = String(q).trim();
    let query: any;

    if (type === 'sku') {
      query = { $and: [POS_CATALOG_ACTIVE, { $or: [{ sku: code }, { product_id: code }] }] };
    } else if (type === 'product_id') {
      query = { $and: [POS_CATALOG_ACTIVE, { product_id: code }] };
    } else {
      query = {
        $and: [
          POS_CATALOG_ACTIVE,
          {
            $or: [
              { name: { $regex: q, $options: 'i' } },
              { product_id: { $regex: q, $options: 'i' } },
              { sku: { $regex: q, $options: 'i' } },
            ],
          },
        ],
      };
    }

    const products = await Product.find(query).limit(20).lean();

    res.json({
      products: products.map((p: any) => ({
        id: p._id.toString(),
        name: p.name,
        price: p.price,
        cost_price: p.cost_price,
        stock_quantity: p.stock_quantity,
        product_id: p.product_id,
        sku: p.sku,
        tax_rate: p.tax_rate || 0,
        image_url: p.image_url,
      })),
    });
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({ error: 'Failed to search products' });
  }
});

// Create POS sale
router.post('/sale', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      items: z.array(
        z.object({
          product_id: z.string(),
          quantity: z.number().int().positive(),
          discount: z.number().min(0).optional(),
        })
      ),
      pos_customer_id: z.string().optional(), // Link to Customer (POS)
      customer_name: z.string().optional(),
      customer_phone: z.string().optional(),
      customer_email: z.string().email().optional(),
      payment_method: z.enum(['cash', 'card', 'digital', 'split']),
      payment_split: z
        .object({
          cash: z.number().min(0).optional(),
          card: z.number().min(0).optional(),
          digital: z.number().min(0).optional(),
        })
        .optional(),
      discount_amount: z.number().min(0).optional(), // Bill-level discount
      sale_type: z.enum(['pos', 'website', 'store_pickup']).default('pos'),
      idempotency_key: z.string().trim().min(1).max(128).optional(),
    });

    const {
      items,
      pos_customer_id,
      customer_name: nameOverride,
      customer_phone: phoneOverride,
      customer_email: emailOverride,
      payment_method,
      payment_split,
      discount_amount = 0,
      sale_type = 'pos',
      idempotency_key: idempotencyKey,
    } = schema.parse(req.body);

    const adminId = req.userId!;

    // Consolidate items by product_id so invoice shows one line per product with total qty (e.g. 2× Pepsi not 1+1)
    const itemsByProduct = new Map<string, { product_id: string; quantity: number; discount: number }>();
    for (const item of items) {
      const key = item.product_id;
      const existing = itemsByProduct.get(key);
      if (existing) {
        existing.quantity += item.quantity;
        existing.discount += (item.discount ?? 0);
      } else {
        itemsByProduct.set(key, {
          product_id: item.product_id,
          quantity: item.quantity,
          discount: item.discount ?? 0,
        });
      }
    }
    const consolidatedItems = Array.from(itemsByProduct.values());

    // Resolve customer: prefer POS Customer, then User by phone, or use overrides
    let customerId: string | undefined;
    let customerName = nameOverride;
    let customerPhone = phoneOverride;
    let customerEmail = emailOverride;

    if (pos_customer_id) {
      const posCustomer = await Customer.findById(pos_customer_id).lean();
      if (posCustomer) {
        customerName = customerName ?? posCustomer.name;
        customerPhone = customerPhone ?? posCustomer.phone;
        customerEmail = customerEmail ?? posCustomer.email;
      }
    }
    let createUserForSale = false;
    if (customerPhone && !customerId) {
      const user = await User.findOne({ phone: customerPhone });
      if (user) {
        customerId = user._id.toString();
      } else {
        createUserForSale = true;
      }
    }

    // Calculate totals and validate stock
    let subtotal = 0;
    let totalTax = 0;
    const saleItems: any[] = [];

    for (const item of consolidatedItems) {
      const product = await Product.findById(item.product_id);

      if (!product || !product.is_active) {
        return res.status(404).json({ error: `Product not found` });
      }

      const isInventory = (product as any).product_type !== 'non_inventory' && (product as any).product_type !== 'service';
      if (isInventory) {
        const onHand = product.stock_quantity ?? 0;
        const committed = (product as any).committed_quantity ?? 0;
        const available = onHand - committed;
        if (available < item.quantity) {
          return res.status(400).json({
            error: `Insufficient stock for ${product.name}. Available: ${available}`,
          });
        }
      }

      const lineSubtotal = product.price * item.quantity;
      const lineDiscount = item.discount || 0;
      const lineTotalAfterDiscount = lineSubtotal - lineDiscount;
      const lineTax = (lineTotalAfterDiscount * (product.tax_rate || 0)) / 100;
      const lineFinal = lineTotalAfterDiscount + lineTax;

      subtotal += lineSubtotal;
      totalTax += lineTax;

      saleItems.push({
        product_id: product._id,
        product_name: product.name,
        quantity: item.quantity,
        price: product.price,
        discount: lineDiscount,
        tax: lineTax,
        subtotal: lineFinal,
        // Sale-time snapshot only. Not used for price, tax, or tender math.
        cost_price: Number((product as { cost_price?: number }).cost_price) || 0,
        isInventory,
      });
    }

    // Apply bill-level discount
    const finalDiscount = discount_amount || 0;
    const totalAfterDiscount = subtotal - finalDiscount;
    const finalTax = (totalTax * (totalAfterDiscount / subtotal)) || totalTax; // Adjust tax proportionally
    const totalAmount = roundMoney(totalAfterDiscount + finalTax);

    let tenders;
    try {
      tenders = normalizePosTenders(payment_method, payment_split, totalAmount);
    } catch (error) {
      if (error instanceof PosTenderError) {
        return res.status(error.status).json({ error: error.message });
      }
      throw error;
    }

    // Completed-sale replay is after tenders so invalid tender still 400s
    // before User.create. The unique index — not this lookup — is the
    // concurrency guarantee for two in-flight same-key requests.
    if (idempotencyKey) {
      const existingSale = await POSSale.findOne({ idempotency_key: idempotencyKey });
      if (existingSale) {
        return sendCommittedPosSaleReplay(res, existingSale);
      }
    }

    // Financial + inventory writes are one Mongo transaction (same pattern as
    // credit-memo approve / shipment deliver). Tender validation stays above.
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      if (createUserForSale && customerPhone) {
        const [createdUser] = await User.create(
          [
            {
              phone: customerPhone,
              name: customerName,
              email: customerEmail,
            },
          ],
          { session }
        );
        customerId = createdUser._id.toString();
      }

      const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const [invoice] = await Invoice.create(
        [
          {
            invoice_number: invoiceNumber,
            invoice_type: sale_type,
            customer_name: customerName || undefined,
            customer_phone: customerPhone || undefined,
            customer_email: customerEmail || undefined,
            total_amount: totalAmount,
            tax_amount: finalTax,
            discount_amount: finalDiscount,
            payment_method: payment_method,
            amount_paid: totalAmount,
            payment_status: 'paid',
            items: saleItems.map((item: any) => ({
              product_id: item.product_id,
              product_name: item.product_name || 'Product',
              quantity: item.quantity,
              price: item.price,
              subtotal: item.subtotal,
            })),
          },
        ],
        { session }
      );

      const saleNumber = generateSaleNumber();
      const [sale] = await POSSale.create(
        [
          {
            sale_number: saleNumber,
            invoice_id: invoice._id,
            customer_name: customerName || undefined,
            customer_phone: customerPhone || undefined,
            customer_email: customerEmail || undefined,
            customer_id: customerId ? customerId : undefined,
            pos_customer_id: pos_customer_id || undefined,
            items: saleItems,
            subtotal,
            discount_amount: finalDiscount,
            tax_amount: finalTax,
            total_amount: totalAmount,
            payment_method,
            payment_split: {
              cash: tenders.cash,
              card: tenders.card,
              digital: tenders.digital,
            },
            sale_type,
            admin_id: adminId,
            ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
          },
        ],
        { session }
      );

      for (const item of saleItems) {
        if (!(item as any).isInventory) continue;
        const decremented = await Product.findOneAndUpdate(
          posStockDecrementFilter(item.product_id, item.quantity),
          { $inc: { stock_quantity: -item.quantity } },
          { session, new: true }
        );
        if (!decremented) {
          throw new PosStockError(`Insufficient stock for ${item.product_name}.`);
        }
        await StockMovement.create(
          [
            {
              product_id: item.product_id,
              movement_type: 'sale',
              quantity_change: -item.quantity,
              reference_type: 'pos_sale',
              reference_id: sale._id,
              admin_id: adminId,
            },
          ],
          { session }
        );
      }

      if (customerId) {
        await User.findByIdAndUpdate(
          customerId,
          { $inc: { total_spent: totalAmount } },
          { session }
        );
      }

      await session.commitTransaction();

      res.status(201).json(formatPosSaleResponse(sale, invoice));
    } catch (error) {
      await session.abortTransaction();
      if (error instanceof PosStockError) {
        return res.status(error.status).json({ error: error.message });
      }
      if (idempotencyKey && isIdempotencyDuplicateKey(error)) {
        // Unique constraint fired, but the winner may still be uncommitted.
        // Only replay after a no-session read sees the committed sale.
        const committedSale = await waitForCommittedKeyedSale(() =>
          POSSale.findOne({ idempotency_key: idempotencyKey })
        );
        if (committedSale) {
          return sendCommittedPosSaleReplay(res, committedSale);
        }
        return res.status(409).json({
          error: 'POS sale with this idempotency key is not yet committed. Retry the same request.',
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
    console.error('Create POS sale error:', error);
    res.status(500).json({ error: 'Failed to create POS sale' });
  }
});

// Get POS sales
router.get('/sales', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { page = 1, limit = 50, sale_type, start_date, end_date } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    let query: any = {};
    if (sale_type) {
      query.sale_type = sale_type;
    }
    if (start_date || end_date) {
      query.created_at = {};
      if (start_date) query.created_at.$gte = new Date(start_date as string);
      if (end_date) query.created_at.$lte = new Date(end_date as string);
    }

    const sales = await POSSale.find(query)
      .populate('admin_id', 'name email')
      .populate('customer_id', 'phone name email')
      .populate('items.product_id', 'name barcode plu sku')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await POSSale.countDocuments(query);

    res.json({
      sales: sales.map((sale: any) => ({
        id: sale._id.toString(),
        sale_number: sale.sale_number,
        customer_name: sale.customer_name,
        customer_phone: sale.customer_phone,
        customer_email: sale.customer_email,
        items: Array.isArray(sale.items)
          ? sale.items.map(({ cost_price: _costPrice, ...item }: any) => item)
          : sale.items,
        subtotal: sale.subtotal,
        discount_amount: sale.discount_amount,
        tax_amount: sale.tax_amount,
        total_amount: sale.total_amount,
        payment_method: sale.payment_method,
        payment_split: sale.payment_split,
        sale_type: sale.sale_type,
        admin_name: sale.admin_id?.name,
        created_at: sale.created_at,
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get POS sales error:', error);
    res.status(500).json({ error: 'Failed to fetch POS sales' });
  }
});

// Get single sale
router.get('/sales/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const sale = await POSSale.findById(req.params.id)
      .populate('admin_id', 'name email')
      .populate('customer_id', 'phone name email')
      .populate('items.product_id', 'name barcode plu sku price')
      .populate('invoice_id')
      .lean();

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const { items: rawItems, ...saleRest } = sale as { items?: unknown[] };
    res.json({
      id: sale._id.toString(),
      ...saleRest,
      items: Array.isArray(rawItems)
        ? rawItems.map((item: any) => {
            if (!item || typeof item !== 'object') return item;
            const { cost_price: _costPrice, ...rest } = item;
            return rest;
          })
        : rawItems,
    });
  } catch (error) {
    console.error('Get sale error:', error);
    res.status(500).json({ error: 'Failed to fetch sale' });
  }
});

export default router;
