import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import CreditMemo from '../models/CreditMemo';
import { authenticateAdmin, AuthRequest } from '../../../middleware/auth';
import { recordAdminNotice } from '../../../services/adminNotice';
import Customer from '../../../models/Customer';
import Vendor from '../../../models/Vendor';
import {
  approveCreditMemo,
  cancelCreditMemo,
  generateCreditMemoNumber,
  markCreditMemoDeliveredToVendor,
  markCreditMemoDispatched,
  markCreditMemoReceived,
  CreditMemoInventoryError,
} from '../services/creditMemoService';
import {
  CreditMemoFromInvoiceError,
  buildValidatedCustomerCreditItems,
  customerCreditLineAmounts,
  loadCustomerInvoicesForCredit,
} from '../services/creditMemoFromInvoice';
import { buildInvoicePdfBuffer } from '../../../utils/invoicePdfLayout';
import {
  CreditMemoFromPoError,
  buildValidatedVendorCreditItems,
  loadVendorPosForCredit,
} from '../services/creditMemoFromPurchaseOrder';
import { sendPdfResponse } from '../../../utils/pdfHelpers';
import { annotateDamagedPurchaseSources } from '../services/purchaseSourceByRate';

const router = express.Router();

function purchaseStamp(item: {
  purchase_match?: string;
  purchase_rate?: number | null;
  purchase_vendor_id?: unknown;
  purchase_vendor_name?: string;
  purchase_po_id?: unknown;
  purchase_po_number?: string;
  purchase_unit_cost?: number;
}) {
  if (!item.purchase_match) return {};
  return {
    purchase_rate: item.purchase_rate,
    purchase_match: item.purchase_match,
    purchase_vendor_id: item.purchase_vendor_id,
    purchase_vendor_name: item.purchase_vendor_name,
    purchase_po_id: item.purchase_po_id,
    purchase_po_number: item.purchase_po_number,
    purchase_unit_cost: item.purchase_unit_cost,
  };
}

function partyAddress(party: { address?: string; billing_address?: string; city?: string; state?: string; zip?: string } | null | undefined): string {
  if (!party) return '';
  const street = party.billing_address || party.address || '';
  const region = [party.city, party.state, party.zip].filter(Boolean).join(' ');
  return [street, region].filter(Boolean).join(', ');
}

async function generateCreditMemoPDFBuffer(cm: any): Promise<Buffer> {
  const party = cm.type === 'VENDOR' ? cm.vendor_id : cm.customer_id;
  const items = (cm.items || []).map((item: any) => ({
    product_name: item.product_name || 'Product',
    quantity: item.quantity ?? 0,
    price: Number(item.unit_price ?? 0),
    subtotal: Math.round((Number(item.quantity ?? 0) * Number(item.unit_price ?? 0)) * 100) / 100,
    taxable: Number(item.tax_amount) > 0,
    tax_type_name: item.tax_type_name || null,
    tax_type_label: item.tax_type_label || null,
    tax_amount: Number(item.tax_amount) || 0,
  }));
  return buildInvoicePdfBuffer(
    {
      invoice_number: cm.credit_memo_number || '—',
      invoice_date: cm.created_at,
      document_kind: 'credit_memo',
      customer_name: party?.name || '—',
      customer_company: party?.company || '',
      customer_address: partyAddress(party),
      customer_phone: party?.phone || '',
      customer_email: party?.email || '',
      terms: String(cm.reason || '').replace(/_/g, ' '),
      shipping_type: cm.reference_invoice_id?.invoice_number || cm.reference_purchase_order_id?.po_number || '',
      payment_method: String(cm.status || ''),
      party_heading: cm.type === 'VENDOR' ? 'VENDOR' : 'BILL TO',
      reference_label: cm.type === 'VENDOR' ? 'PO' : 'Invoice',
      subtotal_amount: Number(cm.subtotal ?? 0),
      tax_amount: Number(cm.tax_amount ?? 0),
      total_amount: Number(cm.total_amount ?? 0),
    },
    items
  );
}

function mongoIdOrUndef(value?: string): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const v = value.trim();
  return /^[a-fA-F0-9]{24}$/.test(v) ? v : undefined;
}

const itemSchema = z.object({
  product_id: z.string().min(1),
  product_name: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unit_price: z.coerce.number().min(0),
  tax_percent: z.coerce.number().min(0).max(100).optional().default(0),
});

const createSchema = z.object({
  type: z.enum(['VENDOR', 'CUSTOMER']),
  reference_invoice_id: z.string().optional(),
  reference_purchase_order_id: z.string().optional(),
  reference_shipment_id: z.string().optional(),
  vendor_id: z.string().optional(),
  customer_id: z.string().optional(),
  reason: z.enum(['DAMAGED', 'RATE_DIFFERENCE', 'RETURN', 'SCHEME', 'OTHER']),
  affects_inventory: z.preprocess((v) => (v === 'false' || v === false ? false : v === 'true' || v === true ? true : v), z.boolean().default(true)),
  items: z.array(itemSchema).min(1),
  document_url: z.string().url().optional().or(z.literal('')),
  notes: z.string().optional(),
});

// Generate credit memo number
router.get('/generate-number', authenticateAdmin, async (req, res) => {
  try {
    const type = String(req.query.type || '').toUpperCase() === 'VENDOR' ? 'VENDOR' : 'CUSTOMER';
    res.json({ credit_memo_number: await generateCreditMemoNumber(type) });
  } catch {
    res.status(500).json({ error: 'Failed to generate credit memo number' });
  }
});

router.get('/customer-invoices', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const customerId = typeof req.query.customer_id === 'string' ? req.query.customer_id : '';
    if (!mongoIdOrUndef(customerId)) {
      return res.status(400).json({ error: 'Select a customer' });
    }
    const invoices = await loadCustomerInvoicesForCredit(customerId);
    res.json({ invoices });
  } catch (e: any) {
    if (e instanceof CreditMemoFromInvoiceError) {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('Customer invoices for credit:', e);
    res.status(500).json({ error: 'Failed to load customer invoices' });
  }
});

router.get('/vendor-pos', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const vendorId = typeof req.query.vendor_id === 'string' ? req.query.vendor_id : '';
    if (!mongoIdOrUndef(vendorId)) {
      return res.status(400).json({ error: 'Select a supplier' });
    }
    const purchase_orders = await loadVendorPosForCredit(vendorId);
    res.json({ purchase_orders });
  } catch (e: any) {
    if (e instanceof CreditMemoFromPoError) {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('Vendor POs for credit:', e);
    res.status(500).json({ error: 'Failed to load purchase orders' });
  }
});

const STATEMENT_PERIODS = ['today', 'yesterday', 'week', '2weeks', 'month', '2months', '3months', '6months', '12months', 'year'] as const;

function creditStatementWindow(period: string): { start: Date; end: Date } | null {
  if (!(STATEMENT_PERIODS as readonly string[]).includes(period)) return null;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (period === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setTime(start.getTime());
    end.setHours(23, 59, 59, 999);
  } else if (period === 'week') start.setDate(start.getDate() - 6);
  else if (period === '2weeks') start.setDate(start.getDate() - 13);
  else if (period === 'month') start.setMonth(start.getMonth() - 1);
  else if (period === '2months') start.setMonth(start.getMonth() - 2);
  else if (period === '3months') start.setMonth(start.getMonth() - 3);
  else if (period === '6months') start.setMonth(start.getMonth() - 6);
  else if (period === '12months') start.setFullYear(start.getFullYear() - 1);
  else if (period === 'year') {
    start.setFullYear(start.getFullYear() - 1, 0, 1);
    start.setHours(0, 0, 0, 0);
    end.setFullYear(end.getFullYear() - 1, 11, 31);
    end.setHours(23, 59, 59, 999);
  }
  return { start, end };
}

function creditDayKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function creditSettlement(status: string): { settlement: string; counts: boolean } {
  if (status === 'CANCELLED') return { settlement: 'Cancelled', counts: false };
  if (status === 'DRAFT') return { settlement: 'Not settled', counts: false };
  if (status === 'APPROVED') return { settlement: 'Owed', counts: true };
  if (status === 'ADJUSTED' || status === 'CLOSED') return { settlement: 'Settled', counts: true };
  return { settlement: status || 'Not settled', counts: false };
}

router.get('/statement', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const period = String(req.query.period || 'month');
    const type = String(req.query.type || 'CUSTOMER').toUpperCase() === 'VENDOR' ? 'VENDOR' : 'CUSTOMER';
    const window = creditStatementWindow(period);
    if (!window) return res.status(400).json({ error: 'Choose a statement period.' });
    const memos = await CreditMemo.find({ type, created_at: { $lte: window.end } })
      .populate('customer_id', 'name company')
      .populate('vendor_id', 'name')
      .populate('reference_invoice_id', 'invoice_number')
      .populate('reference_purchase_order_id', 'po_number')
      .sort({ created_at: 1 })
      .lean();
    const round = (n: number) => Math.round(n * 100) / 100;
    let opening = 0;
    let issued = 0;
    let settled = 0;
    let stillOwed = 0;
    const lines: Array<Record<string, unknown>> = [];
    let running = 0;
    for (const memo of memos as any[]) {
      const when = new Date(memo.created_at || 0);
      const book = creditSettlement(String(memo.status || ''));
      const credit = Number(memo.total_amount) || 0;
      const owed = book.counts ? credit : 0;
      if (when < window.start) {
        opening = round(opening + owed);
        continue;
      }
      if (when > window.end) continue;
      issued = round(issued + owed);
      if (book.settlement === 'Settled') settled = round(settled + credit);
      if (book.settlement === 'Owed') stillOwed = round(stillOwed + credit);
      const party = type === 'VENDOR' ? memo.vendor_id : memo.customer_id;
      const items = Array.isArray(memo.items) && memo.items.length ? memo.items : [{ product_name: '', quantity: 0, unit_price: 0, tax_amount: 0, total: credit }];
      items.forEach((item: any, index: number) => {
        const lineCredit = round(Number(item.total) || (Number(item.quantity) || 0) * (Number(item.unit_price) || 0));
        if (index === 0) running = round(opening + issued);
        lines.push({
          date: creditDayKey(when),
          memo: memo.credit_memo_number || '',
          customer: party?.name || '',
          company: party?.company || '',
          invoice: memo.reference_invoice_id?.invoice_number || memo.reference_purchase_order_id?.po_number || '',
          reason: String(memo.reason || '').replace(/_/g, ' '),
          item: item.product_name || '',
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          merchandise: round((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)),
          tax: Number(item.tax_amount) || 0,
          credit: index === 0 ? credit : lineCredit,
          status: memo.status || '',
          settlement: book.settlement,
          we_owe: index === 0 ? owed : 0,
          balance: running,
        });
      });
    }
    res.json({
      period,
      type,
      from: creditDayKey(window.start),
      to: creditDayKey(window.end),
      opening_owed: opening,
      credits_issued: issued,
      settled,
      still_owed: stillOwed,
      closing_owed: round(opening + issued),
      lines,
    });
  } catch (error) {
    console.error('Credit memo statement error:', error);
    res.status(500).json({ error: 'Failed to build the credit memo statement' });
  }
});

// Supplier of a product, matched by the product's cost rate against received purchases.
router.get('/purchase-source', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const raw = String(req.query.product_ids || req.query.product_id || '');
    const ids = [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))].slice(0, 50);
    if (!ids.length) return res.json({ sources: [] });
    for (const id of ids) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'A product id is not valid' });
      }
    }
    const annotated = await annotateDamagedPurchaseSources(ids.map((id) => ({ product_id: id })));
    res.json({
      sources: annotated.map((row) => ({
        product_id: String(row.product_id),
        rate: row.purchase_rate,
        matched: row.purchase_match === 'rate',
        vendor_id: row.purchase_vendor_id ? String(row.purchase_vendor_id) : undefined,
        vendor_name: row.purchase_vendor_name,
        po_id: row.purchase_po_id ? String(row.purchase_po_id) : undefined,
        po_number: row.purchase_po_number,
        unit_cost: row.purchase_unit_cost,
        method: row.purchase_match === 'rate' ? 'purchase_order' : undefined,
      })),
    });
  } catch (error) {
    console.error('Purchase source by rate:', error);
    res.status(500).json({ error: 'Failed to find the purchase source' });
  }
});

// List credit memos
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { type, status, vendor_id, customer_id, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter: Record<string, unknown> = {};
    if (type && typeof type === 'string') filter.type = type;
    if (status && typeof status === 'string') filter.status = status;
    if (vendor_id && typeof vendor_id === 'string') filter.vendor_id = vendor_id;
    if (customer_id && typeof customer_id === 'string') filter.customer_id = customer_id;

    const [list, total] = await Promise.all([
      CreditMemo.find(filter)
        .populate('vendor_id', 'name supplier_id')
        .populate('customer_id', 'name phone')
        .populate('reference_invoice_id', 'invoice_number total_amount')
        .populate('reference_purchase_order_id', 'po_number total_amount')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      CreditMemo.countDocuments(filter),
    ]);

    res.json({
      credit_memos: list.map((cm: any) => ({
        id: cm._id.toString(),
        credit_memo_number: cm.credit_memo_number,
        type: cm.type,
        reference_invoice_id: cm.reference_invoice_id?._id?.toString(),
        reference_invoice_number: cm.reference_invoice_id?.invoice_number,
        reference_purchase_order_id: cm.reference_purchase_order_id?._id?.toString(),
        reference_po_number: cm.reference_purchase_order_id?.po_number,
        reference_shipment_id: cm.reference_shipment_id?.toString(),
        vendor_id: cm.vendor_id?._id?.toString(),
        vendor_name: cm.vendor_id?.name,
        customer_id: cm.customer_id?._id?.toString(),
        customer_name: cm.customer_id?.name,
        reason: cm.reason,
        affects_inventory: cm.affects_inventory,
        subtotal: cm.subtotal,
        tax_amount: cm.tax_amount,
        total_amount: cm.total_amount,
        status: cm.status,
        document_url: cm.document_url,
        notes: cm.notes,
        created_at: cm.created_at,
        approved_at: cm.approved_at,
        received_at: cm.received_at,
        dispatched_at: cm.dispatched_at,
        delivered_at: cm.delivered_at,
        items: cm.items,
      })),
      pagination: { page: Number(page), limit: Number(limit), total, total_pages: Math.ceil(total / Number(limit)) },
    });
  } catch (e) {
    console.error('List credit memos:', e);
    res.status(500).json({ error: 'Failed to list credit memos' });
  }
});

// Credit memo PDF (must be before GET /:id)
router.get('/:id/pdf', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const cm = await CreditMemo.findById(req.params.id)
      .populate('vendor_id', 'name phone email address city state zip')
      .populate('customer_id', 'name company phone email address billing_address city state zip')
      .populate('reference_invoice_id', 'invoice_number')
      .populate('reference_purchase_order_id', 'po_number')
      .lean();
    if (!cm) return res.status(404).json({ error: 'Credit memo not found' });
    const buffer = await generateCreditMemoPDFBuffer(cm);
    const filename = `credit-memo-${cm.credit_memo_number || req.params.id}.pdf`;
    sendPdfResponse(res, buffer, filename);
  } catch (e: any) {
    console.error('Credit memo PDF error:', e);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Get one
router.get('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const cm = await CreditMemo.findById(req.params.id)
      .populate('vendor_id')
      .populate('customer_id')
      .populate('reference_invoice_id')
      .populate('reference_purchase_order_id', 'po_number')
      .populate('items.product_id', 'name sku barcode')
      .lean();
    if (!cm) return res.status(404).json({ error: 'Credit memo not found' });
    const c = cm as any;
    res.json({
      id: c._id.toString(),
      credit_memo_number: c.credit_memo_number,
      type: c.type,
      reference_invoice_id: c.reference_invoice_id?._id?.toString(),
      reference_invoice_number: c.reference_invoice_id?.invoice_number,
      reference_purchase_order_id: c.reference_purchase_order_id?._id?.toString(),
      reference_po_number: c.reference_purchase_order_id?.po_number,
      reference_shipment_id: c.reference_shipment_id?.toString(),
      vendor_id: c.vendor_id?._id?.toString(),
      vendor_name: c.vendor_id?.name,
      vendor: c.vendor_id,
      customer_id: c.customer_id?._id?.toString(),
      customer_name: c.customer_id?.name,
      customer: c.customer_id,
      reason: c.reason,
      affects_inventory: c.affects_inventory,
      subtotal: c.subtotal,
      tax_amount: c.tax_amount,
      total_amount: c.total_amount,
      status: c.status,
      document_url: c.document_url,
      notes: c.notes,
      created_at: c.created_at,
      approved_at: c.approved_at,
      received_at: c.received_at,
      dispatched_at: c.dispatched_at,
      delivered_at: c.delivered_at,
      items: c.items,
    });
  } catch (e) {
    console.error('Get credit memo:', e);
    res.status(500).json({ error: 'Failed to get credit memo' });
  }
});

// Create
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const data = createSchema.parse(req.body);
    if (data.type === 'VENDOR' && !mongoIdOrUndef(data.vendor_id)) {
      return res.status(400).json({ error: 'Vendor credit memo requires a vendor' });
    }
    if (data.type === 'CUSTOMER' && !mongoIdOrUndef(data.customer_id)) {
      return res.status(400).json({ error: 'Customer credit memo requires a customer' });
    }
    for (const i of data.items) {
      if (!mongoIdOrUndef(i.product_id)) {
        return res.status(400).json({ error: `"${i.product_name || 'A line'}" needs a valid product` });
      }
    }

    let sourceItems = data.items;
    let affectsInventory = data.affects_inventory;
    let referenceInvoiceId = mongoIdOrUndef(data.reference_invoice_id);
    let referencePurchaseOrderId = mongoIdOrUndef(data.reference_purchase_order_id);
    let extraNotes = '';
    if (data.type === 'VENDOR') {
      if (!referencePurchaseOrderId) {
        return res.status(400).json({ error: 'Choose the purchase order this credit is for' });
      }
      const built = await buildValidatedVendorCreditItems({
        vendorId: mongoIdOrUndef(data.vendor_id) as string,
        purchaseOrderId: referencePurchaseOrderId,
        reason: data.reason,
        requested: data.items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      });
      sourceItems = built.items;
      affectsInventory = built.affects_inventory;
      extraNotes = built.po_number ? `PO ${built.po_number}` : '';
    }
    if (data.type === 'CUSTOMER') {
      if (!referenceInvoiceId) {
        return res.status(400).json({ error: 'Choose the invoice this credit is for' });
      }
      const built = await buildValidatedCustomerCreditItems({
        customerId: mongoIdOrUndef(data.customer_id) as string,
        invoiceId: referenceInvoiceId,
        reason: data.reason,
        requested: data.items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      });
      sourceItems = built.items;
      affectsInventory = built.affects_inventory;
      extraNotes = built.invoice_number ? `Invoice ${built.invoice_number}` : '';
    }

    const stampedItems =
      data.type === 'CUSTOMER' && data.reason === 'DAMAGED'
        ? await annotateDamagedPurchaseSources(sourceItems)
        : sourceItems;
    const items = stampedItems.map((i) => {
      const priced = data.type === 'CUSTOMER'
        ? customerCreditLineAmounts(i)
        : {
          tax_percent: i.tax_percent || 0,
          tax_amount: (i.quantity * i.unit_price * (i.tax_percent || 0)) / 100,
          total: i.quantity * i.unit_price + (i.quantity * i.unit_price * (i.tax_percent || 0)) / 100,
        };
      return {
        product_id: i.product_id,
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        tax_percent: priced.tax_percent,
        tax_amount: priced.tax_amount,
        total: priced.total,
        ...(purchaseStamp(i) as any),
      };
    });
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const tax_amount = items.reduce((s, i) => s + i.tax_amount, 0);
    const total_amount = subtotal + tax_amount;
    let notes = data.notes || '';
    if (data.reference_invoice_id && !referenceInvoiceId) {
      notes = [notes, `Reference: ${data.reference_invoice_id}`].filter(Boolean).join('\n');
    }
    if (extraNotes) notes = [notes, extraNotes].filter(Boolean).join('\n');

    const cm = await CreditMemo.create({
      credit_memo_number: await generateCreditMemoNumber(data.type),
      type: data.type,
      reference_invoice_id: referenceInvoiceId,
      reference_purchase_order_id: referencePurchaseOrderId,
      reference_shipment_id: mongoIdOrUndef(data.reference_shipment_id),
      vendor_id: data.type === 'VENDOR' ? mongoIdOrUndef(data.vendor_id) : undefined,
      customer_id: data.type === 'CUSTOMER' ? mongoIdOrUndef(data.customer_id) : undefined,
      reason: data.reason,
      affects_inventory: affectsInventory,
      subtotal,
      tax_amount,
      total_amount,
      status: 'DRAFT',
      document_url: data.document_url || undefined,
      notes: notes || undefined,
      created_by: mongoIdOrUndef(req.userId),
      items,
    });

    res.status(201).json({
      id: cm._id.toString(),
      credit_memo_number: cm.credit_memo_number,
      type: cm.type,
      status: cm.status,
      total_amount: cm.total_amount,
      created_at: cm.created_at,
    });
    const party =
      data.type === 'VENDOR'
        ? await Vendor.findById(cm.vendor_id).select('name').lean()
        : await Customer.findById(cm.customer_id).select('name').lean();
    const partyName = String((party as { name?: string } | null)?.name || (data.type === 'VENDOR' ? 'vendor' : 'customer'));
    const hrefBase = data.type === 'VENDOR' ? '/admin/credit-memos/vendors' : '/admin/credit-memos/customers';
    const invoiceHint = extraNotes || '';
    void recordAdminNotice({
      kind: 'credit_memo',
      title: `${cm.credit_memo_number} credit memo`,
      body: `Credit memo created for ${partyName}${invoiceHint ? ` · ${invoiceHint}` : ''}`,
      href: `${hrefBase}?q=${encodeURIComponent(cm.credit_memo_number)}`,
      ref: cm.credit_memo_number,
    });
  } catch (e: any) {
    if (e instanceof CreditMemoFromInvoiceError) return res.status(e.status).json({ error: e.message });
    if (e instanceof CreditMemoFromPoError) return res.status(e.status).json({ error: e.message });
    if (e instanceof CreditMemoInventoryError) return res.status(e.status).json({ error: e.message });
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors?.[0]?.message || 'Validation error' });
    if (e.name === 'CastError' || e.name === 'ValidationError') {
      return res.status(400).json({ error: e.message || 'Invalid credit memo data' });
    }
    console.error('Create credit memo:', e);
    res.status(500).json({ error: 'Failed to create credit memo' });
  }
});

// Update (draft only)
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const cm = await CreditMemo.findById(req.params.id);
    if (!cm) return res.status(404).json({ error: 'Credit memo not found' });
    if (cm.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Only draft credit memos can be updated' });
    }
    const data = createSchema.partial().extend({ items: z.array(itemSchema).min(1).optional() }).parse(req.body);

    let items = cm.items;
    if (data.items) {
      items = data.items.map((i) => {
        const priced = cm.type === 'CUSTOMER'
          ? customerCreditLineAmounts(i)
          : {
            tax_percent: i.tax_percent || 0,
            tax_amount: (i.quantity * i.unit_price * (i.tax_percent || 0)) / 100,
            total: i.quantity * i.unit_price + (i.quantity * i.unit_price * (i.tax_percent || 0)) / 100,
          };
        return {
          product_id: new mongoose.Types.ObjectId(i.product_id),
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          tax_percent: priced.tax_percent,
          tax_amount: priced.tax_amount,
          total: priced.total,
        };
      }) as typeof cm.items;
    }
    const nextReason = data.reason ?? cm.reason;
    if (cm.type === 'CUSTOMER' && nextReason === 'DAMAGED') {
      const annotated = await annotateDamagedPurchaseSources(
        items.map((item) => ({
          product_id: String(item.product_id),
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          tax_percent: item.tax_percent,
          tax_amount: item.tax_amount,
          total: item.total,
        }))
      );
      items = annotated.map((item) => ({
        product_id: new mongoose.Types.ObjectId(String(item.product_id)),
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_percent: item.tax_percent,
        tax_amount: item.tax_amount,
        total: item.total,
        ...purchaseStamp(item),
      })) as typeof cm.items;
    }
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const tax_amount = items.reduce((s, i) => s + i.tax_amount, 0);
    const total_amount = subtotal + tax_amount;

    await CreditMemo.findByIdAndUpdate(req.params.id, {
      ...(data.reference_invoice_id !== undefined && { reference_invoice_id: data.reference_invoice_id }),
      ...(data.reference_shipment_id !== undefined && { reference_shipment_id: data.reference_shipment_id }),
      ...(data.vendor_id !== undefined && { vendor_id: data.vendor_id }),
      ...(data.customer_id !== undefined && { customer_id: data.customer_id }),
      ...(data.reason !== undefined && { reason: data.reason }),
      ...(data.affects_inventory !== undefined && { affects_inventory: data.affects_inventory }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.document_url !== undefined && { document_url: data.document_url }),
      items,
      subtotal,
      tax_amount,
      total_amount,
    });

    res.json({ success: true });
  } catch (e: any) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors?.[0]?.message || 'Validation error' });
    console.error('Update credit memo:', e);
    res.status(500).json({ error: 'Failed to update credit memo' });
  }
});

// Approve
router.post('/:id/mark-dispatched', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await markCreditMemoDispatched(req.params.id, req.userId!);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, message: 'Return marked dispatched' });
  } catch (e: any) {
    if (e instanceof CreditMemoInventoryError) {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('Mark credit memo dispatched:', e);
    res.status(500).json({ error: 'Failed to mark dispatched' });
  }
});

router.post('/:id/mark-delivered', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await markCreditMemoDeliveredToVendor(req.params.id, req.userId!);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, message: 'Marked delivered to supplier' });
  } catch (e) {
    console.error('Mark credit memo delivered:', e);
    res.status(500).json({ error: 'Failed to mark delivered' });
  }
});

router.post('/:id/mark-received', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await markCreditMemoReceived(req.params.id, req.userId!);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, message: 'Return marked received' });
  } catch (e: any) {
    if (e instanceof CreditMemoInventoryError) {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('Mark credit memo received:', e);
    res.status(500).json({ error: 'Failed to mark received' });
  }
});

router.post('/:id/approve', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await approveCreditMemo(req.params.id, req.userId!);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, message: 'Credit memo approved' });
  } catch (e: any) {
    if (e instanceof CreditMemoInventoryError) {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('Approve credit memo:', e);
    res.status(500).json({ error: 'Failed to approve credit memo' });
  }
});

// Cancel
router.post('/:id/cancel', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await cancelCreditMemo(req.params.id);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, message: 'Credit memo cancelled' });
  } catch (e) {
    console.error('Cancel credit memo:', e);
    res.status(500).json({ error: 'Failed to cancel credit memo' });
  }
});

// Delete (draft / cancelled only — approved memos stay until cancelled)
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const cm = await CreditMemo.findById(req.params.id);
    if (!cm) return res.status(404).json({ error: 'Credit memo not found' });
    const status = String(cm.status || '').toUpperCase();
    if (status === 'APPROVED' || status === 'ADJUSTED') {
      return res.status(400).json({
        error: `${cm.credit_memo_number || 'This credit memo'} is ${status.toLowerCase()} and cannot be deleted. Export it instead.`,
      });
    }
    if (status === 'CANCELLED' && cm.approved_at) {
      return res.status(400).json({
        error: `${cm.credit_memo_number || 'This credit memo'} was approved and cannot be deleted.`,
      });
    }
    await CreditMemo.deleteOne({ _id: cm._id });
    res.json({ success: true, id: cm._id.toString() });
  } catch (e) {
    console.error('Delete credit memo:', e);
    res.status(500).json({ error: 'Failed to delete credit memo' });
  }
});

// Analytics: total returns per vendor, damage %, return ratio by product
router.get('/analytics/returns-by-vendor', authenticateAdmin, async (req, res) => {
  try {
    const agg = await CreditMemo.aggregate([
      { $match: { type: 'VENDOR', status: 'APPROVED' } },
      { $group: { _id: '$vendor_id', total_amount: { $sum: '$total_amount' }, count: { $sum: 1 } } },
      { $lookup: { from: 'vendors', localField: '_id', foreignField: '_id', as: 'vendor' } },
      { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
      { $project: { vendor_id: '$_id', vendor_name: '$vendor.name', total_amount: 1, count: 1 } },
    ]);
    res.json({ by_vendor: agg });
  } catch (e) {
    console.error('Analytics returns by vendor:', e);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

router.get('/analytics/reason-breakdown', authenticateAdmin, async (req, res) => {
  try {
    const agg = await CreditMemo.aggregate([
      { $match: { status: 'APPROVED' } },
      { $group: { _id: '$reason', count: { $sum: 1 }, total_amount: { $sum: '$total_amount' } } },
    ]);
    const total = agg.reduce((s, x) => s + x.count, 0);
    const withPct = agg.map((x) => ({ ...x, damage_pct: total ? Math.round((x.count / total) * 1000) / 10 : 0 }));
    res.json({ by_reason: withPct });
  } catch (e) {
    console.error('Analytics reason breakdown:', e);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

router.get('/analytics/return-ratio-by-product', authenticateAdmin, async (req, res) => {
  try {
    const agg = await CreditMemo.aggregate([
      { $match: { status: 'APPROVED' } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product_id', quantity_returned: { $sum: '$items.quantity' }, total_value: { $sum: '$items.total' } } },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      { $project: { product_id: '$_id', product_name: '$product.name', quantity_returned: 1, total_value: 1 } },
    ]);
    res.json({ by_product: agg });
  } catch (e) {
    console.error('Analytics return ratio by product:', e);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

export default router;
