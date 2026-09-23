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
  receivableInvoiceMatch,
  shouldAdjustInventoryForDocumentType,
} from '../utils/documentType';
import { derivedUnpaidReceivableMatch, invoiceFinancialState } from '../utils/invoiceFinancialState';
import { httpErrorFromPayment, paymentApplication } from '../services/paymentApplication';

const router = express.Router();

const LOCATION_OF_SALE = '511 W Germantown Pike, Plymouth Meeting, PA 19462-1303';

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
      payment_status: state.payment_status,
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
      const subtotal_amount = items.reduce((s: number, i: any) => s + (i.subtotal || 0), 0);
      invoice.subtotal_amount = subtotal_amount;
      invoice.tax_amount = Number(body.tax_amount) ?? invoice.tax_amount;
      invoice.total_amount = subtotal_amount + invoice.tax_amount;
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

// Receive payment: thin HTTP layer. Application lives in paymentApplication.
router.post('/receive-payment', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { amount_received, payment_date, payment_method, deposit_to, bank_account_id, allocations } = req.body as {
      amount_received?: number;
      payment_date?: string;
      payment_method?: string;
      deposit_to?: string;
      bank_account_id?: string;
      allocations: { invoice_id: string; amount: number }[];
    };

    const result = await paymentApplication.applyCustomerPayment({
      allocations,
      amount_received,
      payment_date: payment_date ? new Date(payment_date) : undefined,
      payment_method,
      bank_account_id: bank_account_id || deposit_to || undefined,
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
