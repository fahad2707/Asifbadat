import express from 'express';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice';
import Customer from '../models/Customer';
import StoreSettings from '../models/StoreSettings';
import Product from '../models/Product';
import CustomerProductPrice from '../models/CustomerProductPrice';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import nodemailer from 'nodemailer';
import { buildInvoicePdfBuffer } from '../utils/invoicePdfLayout';
import { sendPdfResponse } from '../utils/pdfHelpers';
import {
  DOCUMENT_TYPE_INVOICE,
  DOCUMENT_TYPE_QUOTATION,
  isPosSaleInvoiceType,
  isQuotationType,
  receivableInvoiceMatch,
  shouldAdjustInventoryForDocumentType,
} from '../utils/documentType';
import {
  assertReceivableInvoiceEdit,
  derivedUnpaidReceivableMatch,
  invoiceFinancialState,
} from '../utils/invoiceFinancialState';
import { httpErrorFromPayment, paymentApplication } from '../services/paymentApplication';

const router = express.Router();

const LOCATION_OF_SALE = '511 W Germantown Pike, Plymouth Meeting, PA 19462-1303';

function quotationMark(shippingType?: string | null): { quote_status: 'open' | 'rejected' | 'converted'; converted_invoice_number?: string } {
  const raw = String(shippingType || '');
  if (raw === 'rejected') return { quote_status: 'rejected' };
  if (raw.startsWith('converted:')) return { quote_status: 'converted', converted_invoice_number: raw.slice('converted:'.length) };
  return { quote_status: 'open' };
}

async function saveCustomerProductPrices(customerId: string | mongoose.Types.ObjectId, items: any[], invoiceId: string | mongoose.Types.ObjectId, invoiceDate: Date) {
  if (!customerId) return;
  const cid = typeof customerId === 'string' ? new mongoose.Types.ObjectId(customerId) : customerId;
  const iid = typeof invoiceId === 'string' ? new mongoose.Types.ObjectId(invoiceId) : invoiceId;
  const ops = items
    .filter((i: any) => i.product_id && Number(i.price) > 0)
    .map((i: any) => ({
      updateOne: {
        filter: { customer_id: cid, product_id: typeof i.product_id === 'string' ? new mongoose.Types.ObjectId(i.product_id) : i.product_id },
        update: { $set: { last_price: Number(i.price), last_invoice_id: iid, last_invoice_date: invoiceDate } },
        upsert: true,
      },
    }));
  if (ops.length > 0) {
    await CustomerProductPrice.bulkWrite(ops).catch((err) => console.error('Save customer prices error:', err));
  }
}

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Summary: receivable invoices only. Totals/status/overdue come from invoiceFinancialState.
router.get('/summary', authenticateAdmin, async (_req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const docs = await Invoice.find(receivableInvoiceMatch).lean();
    let totalPaid = 0;
    let totalUnpaid = 0;
    let overdueTotal = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let overdueCount = 0;
    let recentlyPaidTotal = 0;
    for (const doc of docs) {
      const state = invoiceFinancialState(doc, now);
      totalPaid += state.amount_paid;
      if (state.balance_due > 0) totalUnpaid += state.balance_due;
      if (state.overdue) {
        overdueTotal += state.balance_due;
        overdueCount += 1;
      }
      if (state.payment_status === 'paid') paidCount += 1;
      else unpaidCount += 1;
      const updatedAt = (doc as { updated_at?: Date }).updated_at;
      if (updatedAt && new Date(updatedAt) >= thirtyDaysAgo) {
        recentlyPaidTotal += state.amount_paid;
      }
    }
    res.json({
      totalPaid,
      totalUnpaid,
      overdueTotal,
      overdueCount,
      openTotal: totalUnpaid,
      openCount: unpaidCount,
      paidCount,
      recentlyPaidTotal,
    });
  } catch (error) {
    console.error('Invoices summary error:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Get invoices
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { page = 1, limit = 50, search, customer_id, unpaid_only, type: docType } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    let query: any = {};

    if (search) {
      query.$or = [
        { invoice_number: { $regex: search, $options: 'i' } },
        { customer_name: { $regex: search, $options: 'i' } },
        { customer_phone: { $regex: search, $options: 'i' } },
      ];
    }
    if (customer_id && typeof customer_id === 'string') {
      query.customer_id = new mongoose.Types.ObjectId(customer_id);
    }
    if (docType === 'invoice' || docType === 'quotation') {
      query.invoice_type = docType;
    }
    if (unpaid_only === 'true' || unpaid_only === '1') {
      Object.assign(query, derivedUnpaidReceivableMatch);
    }

    const invoices = await Invoice.find(query)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await Invoice.countDocuments(query);

    res.json(
      invoices.map((invoice: any) => {
        const state = invoiceFinancialState(invoice);
        return {
          id: invoice._id.toString(),
          invoice_number: invoice.invoice_number,
          invoice_type: invoice.invoice_type,
          customer_id: invoice.customer_id?.toString(),
          customer_name: invoice.customer_name,
          customer_phone: invoice.customer_phone,
          customer_email: invoice.customer_email,
          customer_address: invoice.customer_address,
          total_amount: state.total,
          amount_paid: state.amount_paid,
          tax_amount: invoice.tax_amount || 0,
          payment_method: invoice.payment_method,
          payment_status: state.payment_status,
          shipping_type: invoice.shipping_type,
          terms: invoice.terms,
          ...quotationMark(invoice.shipping_type),
          invoice_date: invoice.invoice_date,
          due_date: invoice.due_date,
          created_at: invoice.created_at,
          items: invoice.items || [],
        };
      })
    );
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Get next document number: INV#001, INV#002, ... or QTN#001, QTN#002, ...
async function getNextInvoiceNumber(): Promise<string> {
  const docs = await Invoice.find({ invoice_number: /^INV#\d+$/ }).sort({ invoice_number: -1 }).limit(1).lean();
  if (docs.length === 0) return 'INV#001';
  const last = (docs[0] as any).invoice_number;
  const num = parseInt(last.replace(/^INV#/, ''), 10) || 0;
  return `INV#${String(num + 1).padStart(3, '0')}`;
}
async function getNextQuotationNumber(): Promise<string> {
  const docs = await Invoice.find({ invoice_number: /^QTN#\d+$/ }).sort({ invoice_number: -1 }).limit(1).lean();
  if (docs.length === 0) return 'QTN#001';
  const last = (docs[0] as any).invoice_number;
  const num = parseInt(last.replace(/^QTN#/, ''), 10) || 0;
  return `QTN#${String(num + 1).padStart(3, '0')}`;
}

// Generate next invoice or quotation number (for create form)
router.get('/generate-number', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const type = (req.query.type as string) || 'invoice';
    const number = type === 'quotation' ? await getNextQuotationNumber() : await getNextInvoiceNumber();
    res.json({ invoice_number: number });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate number' });
  }
});

// Get customer-specific last prices for all products
router.get('/customer-prices/:customerId', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { customerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.json({});
    }
    const prices = await CustomerProductPrice.find({ customer_id: new mongoose.Types.ObjectId(customerId) }).lean();
    const priceMap: Record<string, number> = {};
    for (const p of prices) {
      priceMap[(p as any).product_id.toString()] = (p as any).last_price;
    }
    res.json(priceMap);
  } catch (error) {
    console.error('Fetch customer prices error:', error);
    res.status(500).json({ error: 'Failed to fetch customer prices' });
  }
});

// Create manual invoice or quotation (saved as unpaid)
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body as any;
    const docType = body.invoice_type === DOCUMENT_TYPE_QUOTATION ? DOCUMENT_TYPE_QUOTATION : DOCUMENT_TYPE_INVOICE;
    const invoice_number = body.invoice_number || (docType === DOCUMENT_TYPE_QUOTATION ? await getNextQuotationNumber() : await getNextInvoiceNumber());
    const invoice_date = body.invoice_date ? new Date(body.invoice_date) : new Date();
    const due_date = body.due_date ? new Date(body.due_date) : invoice_date;
    const customer_id = body.customer_id ? new mongoose.Types.ObjectId(body.customer_id) : undefined;
    const items = (body.items || []).map((i: any) => ({
      product_id: i.product_id ? new mongoose.Types.ObjectId(i.product_id) : undefined,
      product_name: i.product_name || '',
      category_name: i.category_name,
      quantity: Number(i.quantity) || 0,
      price: Number(i.price) || 0,
      subtotal: Number(i.subtotal) || 0,
    }));
    const subtotal_amount = items.reduce((s: number, i: any) => s + (i.subtotal || 0), 0);
    const tax_amount = Number(body.tax_amount) || 0;
    const total_amount = subtotal_amount + tax_amount;

    // Task 05: quotations never reserve or deduct stock. Invoices keep the existing guard.
    if (shouldAdjustInventoryForDocumentType(docType)) {
      for (const item of items) {
        if (!item.product_id || (item.quantity || 0) <= 0) continue;
        const product = await Product.findById(item.product_id);
        if (!product) continue;
        if ((product as any).product_type === 'service' || (product as any).product_type === 'non_inventory') continue;
        const qty = Number(item.quantity) || 0;
        const currentQty = (product as any).stock_quantity ?? 0;
        if (currentQty - qty < 0) {
          return res.status(400).json({ error: `Product "${product.name}" is out of stock. Please restock before invoicing.` });
        }
      }
    }

    const inv = await Invoice.create({
      invoice_number,
      customer_id,
      customer_name: body.customer_name,
      customer_phone: body.customer_phone,
      customer_email: body.customer_email,
      customer_address: body.customer_address,
      location_of_sale: body.location_of_sale || LOCATION_OF_SALE,
      invoice_type: docType,
      invoice_date,
      due_date,
      subtotal_amount,
      tax_amount,
      total_amount,
      amount_paid: 0,
      terms: body.terms,
      payment_status: 'unpaid',
      items,
    });
    // Task 05: only invoices deduct inventory. Quotations are proposals.
    if (shouldAdjustInventoryForDocumentType(docType)) {
      for (const item of items) {
        if (!item.product_id || (item.quantity || 0) <= 0) continue;
        const product = await Product.findById(item.product_id);
        if (!product) continue;
        if ((product as any).product_type === 'service' || (product as any).product_type === 'non_inventory') continue;
        const qty = Number(item.quantity) || 0;
        await Product.findByIdAndUpdate(item.product_id, { $inc: { stock_quantity: -qty } });
      }
    }

    await saveCustomerProductPrices(customer_id as any, items, inv._id, invoice_date);

    const doc = inv.toObject();
    res.status(201).json({
      id: (doc as any)._id.toString(),
      invoice_number: (doc as any).invoice_number,
      customer_id: (doc as any).customer_id?.toString(),
      total_amount: (doc as any).total_amount,
      payment_status: (doc as any).payment_status,
      created_at: (doc as any).created_at,
    });
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// Generate and download invoice PDF (must be before GET /:id so /:id/pdf is matched)
router.get('/:id/pdf', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).lean();

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const items = invoice.items || [];
    const productIds = [...new Set((items || []).map((i: any) => i.product_id).filter(Boolean))];
    const products = productIds.length
      ? await Product.find({ _id: { $in: productIds } }).select('product_id sku').lean()
      : [];
    const idMap: Record<string, string> = {};
    products.forEach((p: any) => {
      idMap[p._id.toString()] = p.product_id || p.sku || p._id.toString();
    });
    const buffer = await buildInvoicePdfBuffer(invoice as any, items as any[], idMap);
    const filename = `invoice-${(invoice as any).invoice_number || req.params.id}.pdf`;
    sendPdfResponse(res, buffer, filename);
  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Get invoice by ID
router.get('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).lean();

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const doc = invoice as any;
    const state = invoiceFinancialState(doc);
    res.json({
      id: doc._id.toString(),
      invoice_number: doc.invoice_number,
      customer_id: doc.customer_id?.toString(),
      customer_name: doc.customer_name,
      customer_phone: doc.customer_phone,
      customer_email: doc.customer_email,
      customer_address: doc.customer_address,
      location_of_sale: doc.location_of_sale,
      invoice_type: doc.invoice_type,
      invoice_date: doc.invoice_date,
      due_date: doc.due_date,
      total_amount: state.total,
      subtotal_amount: doc.subtotal_amount,
      tax_amount: doc.tax_amount,
      amount_paid: state.amount_paid,
      terms: doc.terms,
      payment_method: doc.payment_method,
      shipping_type: doc.shipping_type,
      payment_status: state.payment_status,
      ...quotationMark(doc.shipping_type),
      items: doc.items || [],
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    });
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// Update invoice (e.g. edit draft / unpaid)
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body as any;
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    if (isPosSaleInvoiceType(invoice.invoice_type)) {
      return res.status(400).json({
        error: 'Completed POS sales cannot be edited through the invoice endpoint.',
      });
    }

    if (body.invoice_date !== undefined) invoice.invoice_date = new Date(body.invoice_date);
    // Task 05: document type is immutable here. Conversion is a later explicit operation.
    if (body.customer_id !== undefined) invoice.customer_id = body.customer_id ? new mongoose.Types.ObjectId(body.customer_id) : undefined;
    if (body.customer_name !== undefined) invoice.customer_name = body.customer_name;
    if (body.customer_phone !== undefined) invoice.customer_phone = body.customer_phone;
    if (body.customer_email !== undefined) invoice.customer_email = body.customer_email;
    if (body.customer_address !== undefined) invoice.customer_address = body.customer_address;
    if (body.terms !== undefined) invoice.terms = body.terms;
    if (body.items !== undefined) {
      const items = body.items.map((i: any) => ({
        product_id: i.product_id ? new mongoose.Types.ObjectId(i.product_id) : undefined,
        product_name: i.product_name || '',
        category_name: i.category_name,
        quantity: Number(i.quantity) || 0,
        price: Number(i.price) || 0,
        subtotal: Number(i.subtotal) || 0,
      }));
      const subtotal_amount = items.reduce((s: number, i: any) => s + (i.subtotal || 0), 0);
      const tax_amount = Number(body.tax_amount) ?? invoice.tax_amount;
      const proposedTotal = subtotal_amount + tax_amount;

      try {
        assertReceivableInvoiceEdit({
          invoice_type: invoice.invoice_type,
          total_amount: proposedTotal,
          amount_paid: invoice.amount_paid,
        });
      } catch (error) {
        const mapped = httpErrorFromPayment(error);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        throw error;
      }

      // Task 05: quotations never restore or deduct stock on edit.
      if (shouldAdjustInventoryForDocumentType(invoice.invoice_type)) {
        const oldItems = (invoice as any).items || [];
        for (const item of oldItems) {
          if (!item.product_id || (item.quantity || 0) <= 0) continue;
          const product = await Product.findById(item.product_id).lean();
          if (!product) continue;
          const p = product as any;
          if (p.product_type === 'service' || p.product_type === 'non_inventory') continue;
          await Product.findByIdAndUpdate(item.product_id, { $inc: { stock_quantity: Number(item.quantity) || 0 } });
        }

        for (const item of items) {
          if (!item.product_id || (item.quantity || 0) <= 0) continue;
          const product = await Product.findById(item.product_id);
          if (!product) continue;
          if ((product as any).product_type === 'service' || (product as any).product_type === 'non_inventory') continue;
          await Product.findByIdAndUpdate(item.product_id, { $inc: { stock_quantity: -(Number(item.quantity) || 0) } });
        }
      }

      invoice.items = items;
      invoice.subtotal_amount = subtotal_amount;
      invoice.tax_amount = tax_amount;
      invoice.total_amount = proposedTotal;
    }
    // Never overwrite amount_paid on edit. Status comes from the canonical helper.
    const state = invoiceFinancialState(invoice);
    invoice.payment_status = state.payment_status;
    await invoice.save();

    if (invoice.customer_id && invoice.items?.length) {
      await saveCustomerProductPrices(invoice.customer_id, invoice.items, invoice._id, invoice.invoice_date || new Date());
    }

    const doc = invoice.toObject();
    res.json({
      id: (doc as any)._id.toString(),
      invoice_number: (doc as any).invoice_number,
      payment_status: (doc as any).payment_status,
    });
  } catch (error) {
    console.error('Update invoice error:', error);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// Delete a quotation, or an unpaid invoice. POS slips and paid invoices stay in the books.
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Document not found' });

    if (isPosSaleInvoiceType(invoice.invoice_type)) {
      return res.status(400).json({ error: 'POS sales cannot be deleted.' });
    }

    const state = invoiceFinancialState(invoice);
    if (!isQuotationType(invoice.invoice_type) && (state.amount_paid > 0 || state.payment_status === 'paid')) {
      return res.status(400).json({
        error: `${invoice.invoice_number || 'This invoice'} has payments recorded and cannot be deleted. Export it instead.`,
      });
    }

    // Reverse the same stock move create/edit applied (invoices only; quotations never touch stock).
    if (shouldAdjustInventoryForDocumentType(invoice.invoice_type)) {
      const oldItems = (invoice as any).items || [];
      for (const item of oldItems) {
        if (!item.product_id || (item.quantity || 0) <= 0) continue;
        const product = await Product.findById(item.product_id).lean();
        if (!product) continue;
        const p = product as any;
        if (p.product_type === 'service' || p.product_type === 'non_inventory') continue;
        await Product.findByIdAndUpdate(item.product_id, { $inc: { stock_quantity: Number(item.quantity) || 0 } });
      }
    }

    await Invoice.deleteOne({ _id: invoice._id });
    res.json({ success: true, id: invoice._id.toString() });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Convert an accepted quotation into a new unpaid invoice (same inventory path as POST /).
router.post('/:id/convert', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const quote = await Invoice.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quotation not found' });
    if (!isQuotationType(quote.invoice_type)) {
      return res.status(400).json({ error: 'Only quotations can be converted to invoices.' });
    }
    const mark = quotationMark((quote as any).shipping_type);
    if (mark.quote_status === 'rejected') {
      return res.status(400).json({ error: 'This quotation was rejected and cannot be converted.' });
    }
    if (mark.quote_status === 'converted') {
      return res.status(400).json({ error: `This quotation was already converted to ${mark.converted_invoice_number}.` });
    }

    const items = ((quote as any).items || []).map((i: any) => ({
      product_id: i.product_id,
      product_name: i.product_name || '',
      category_name: i.category_name,
      quantity: Number(i.quantity) || 0,
      price: Number(i.price) || 0,
      subtotal: Number(i.subtotal) || 0,
    }));
    const subtotal_amount = items.reduce((s: number, i: any) => s + (i.subtotal || 0), 0);
    const tax_amount = Number((quote as any).tax_amount) || 0;
    const total_amount = Number((quote as any).total_amount) || subtotal_amount + tax_amount;
    const invoice_number = await getNextInvoiceNumber();
    const invoice_date = new Date();
    const due_date = (quote as any).due_date || invoice_date;

    if (shouldAdjustInventoryForDocumentType(DOCUMENT_TYPE_INVOICE)) {
      for (const item of items) {
        if (!item.product_id || (item.quantity || 0) <= 0) continue;
        const product = await Product.findById(item.product_id);
        if (!product) continue;
        if ((product as any).product_type === 'service' || (product as any).product_type === 'non_inventory') continue;
        const qty = Number(item.quantity) || 0;
        const currentQty = (product as any).stock_quantity ?? 0;
        if (currentQty - qty < 0) {
          return res.status(400).json({ error: `Product "${product.name}" is out of stock. Please restock before invoicing.` });
        }
      }
    }

    const inv = await Invoice.create({
      invoice_number,
      customer_id: (quote as any).customer_id,
      customer_name: (quote as any).customer_name,
      customer_phone: (quote as any).customer_phone,
      customer_email: (quote as any).customer_email,
      customer_address: (quote as any).customer_address,
      location_of_sale: (quote as any).location_of_sale || LOCATION_OF_SALE,
      invoice_type: DOCUMENT_TYPE_INVOICE,
      invoice_date,
      due_date,
      subtotal_amount,
      tax_amount,
      total_amount,
      amount_paid: 0,
      terms: (quote as any).terms,
      payment_status: 'unpaid',
      items,
    });

    if (shouldAdjustInventoryForDocumentType(DOCUMENT_TYPE_INVOICE)) {
      for (const item of items) {
        if (!item.product_id || (item.quantity || 0) <= 0) continue;
        const product = await Product.findById(item.product_id);
        if (!product) continue;
        if ((product as any).product_type === 'service' || (product as any).product_type === 'non_inventory') continue;
        await Product.findByIdAndUpdate(item.product_id, { $inc: { stock_quantity: -(Number(item.quantity) || 0) } });
      }
    }

    await saveCustomerProductPrices((quote as any).customer_id, items, inv._id, invoice_date);

    (quote as any).shipping_type = `converted:${invoice_number}`;
    await quote.save();

    const doc = inv.toObject() as any;
    res.status(201).json({
      id: doc._id.toString(),
      invoice_number: doc.invoice_number,
      quotation_id: quote._id.toString(),
      quotation_number: (quote as any).invoice_number,
      total_amount: doc.total_amount,
      payment_status: doc.payment_status,
    });
  } catch (error) {
    console.error('Convert quotation error:', error);
    res.status(500).json({ error: 'Failed to convert quotation' });
  }
});

router.post('/:id/reject', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const quote = await Invoice.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quotation not found' });
    if (!isQuotationType(quote.invoice_type)) {
      return res.status(400).json({ error: 'Only quotations can be marked rejected.' });
    }
    const mark = quotationMark((quote as any).shipping_type);
    if (mark.quote_status === 'converted') {
      return res.status(400).json({ error: `This quotation was already converted to ${mark.converted_invoice_number}.` });
    }
    if (mark.quote_status === 'rejected') {
      return res.json({ success: true, id: quote._id.toString(), quote_status: 'rejected' });
    }
    (quote as any).shipping_type = 'rejected';
    await quote.save();
    res.json({ success: true, id: quote._id.toString(), quote_status: 'rejected' });
  } catch (error) {
    console.error('Reject quotation error:', error);
    res.status(500).json({ error: 'Failed to reject quotation' });
  }
});

// Receive payment: thin HTTP layer. Application lives in paymentApplication.
router.post('/receive-payment', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { amount_received, payment_date, payment_method, deposit_to, bank_account_id, allocations, notes, reference_no } = req.body as {
      amount_received?: number;
      payment_date?: string;
      payment_method?: string;
      deposit_to?: string;
      bank_account_id?: string;
      allocations: { invoice_id: string; amount: number }[];
      notes?: string;
      reference_no?: string;
    };

    const result = await paymentApplication.applyCustomerPayment({
      allocations,
      amount_received,
      payment_date: payment_date ? new Date(payment_date) : undefined,
      payment_method,
      bank_account_id: bank_account_id || deposit_to || undefined,
      notes: notes || reference_no,
    });

    res.json({
      success: true,
      message: 'Payment recorded',
      trx_id: result.trx_ids[0],
      trx_ids: result.trx_ids,
      applications: result.applications,
    });
  } catch (error) {
    const mapped = httpErrorFromPayment(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Receive payment error:', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

// Send invoice via email
router.post('/:id/send-email', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).lean();

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (!invoice.customer_email) {
      return res.status(400).json({ error: 'Customer email not found' });
    }

    const items = invoice.items || [];
    const productIds = [...new Set((items || []).map((i: any) => i.product_id).filter(Boolean))];
    const products = productIds.length
      ? await Product.find({ _id: { $in: productIds } }).select('product_id sku').lean()
      : [];
    const idMap: Record<string, string> = {};
    products.forEach((p: any) => {
      idMap[p._id.toString()] = p.product_id || p.sku || p._id.toString();
    });
    const pdfBuffer = await buildInvoicePdfBuffer(invoice as any, items as any[], idMap);

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: invoice.customer_email,
      subject: `Invoice ${invoice.invoice_number} - Express Distributors Inc`,
      text: `Please find attached your invoice ${invoice.invoice_number}.`,
      attachments: [
        {
          filename: `invoice-${invoice.invoice_number}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    await Invoice.findByIdAndUpdate(req.params.id, { email_sent: true });

    res.json({ message: 'Invoice sent successfully' });
  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({ error: 'Failed to send invoice email' });
  }
});

export default router;
