import express from 'express';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import PurchaseOrder from '../models/PurchaseOrder';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import Vendor from '../models/Vendor';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { buildBusinessDocumentPdf } from '../utils/businessDocPdf';
import { sendPdfResponse } from '../utils/pdfHelpers';
import { z } from 'zod';
import { postVendorLedger } from '../modules/vendors/services/vendorLedgerService';
import { LedgerReferenceType } from '../shared/enums';

const router = express.Router();

function poLineProductId(item: any): string {
  const p = item?.product_id;
  if (!p) return '';
  if (typeof p === 'string') return p;
  if (p._id) return String(p._id);
  if (p.id) return String(p.id);
  return String(p);
}

function serializePoItems(items: any[] = []) {
  return items.map((i) => ({
    product_id: poLineProductId(i),
    product_name: i.product_name || i.product_id?.name || '',
    quantity_ordered: i.quantity_ordered,
    quantity_received: i.quantity_received || 0,
    unit_cost: i.unit_cost,
    subtotal: i.subtotal,
  }));
}

function serializeVendorInvoice(po: any) {
  return {
    vendor_invoice_url: po.vendor_invoice_url || null,
    vendor_invoice_name: po.vendor_invoice_name || null,
    vendor_invoice_uploaded_at: po.vendor_invoice_uploaded_at || null,
  };
}

const vendorInvoiceDir = path.join(__dirname, '../../uploads/purchase-orders');
if (!fs.existsSync(vendorInvoiceDir)) {
  fs.mkdirSync(vendorInvoiceDir, { recursive: true });
}

const vendorInvoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const name = (file.originalname || '').toLowerCase();
    const ok =
      mime === 'image/jpeg' ||
      mime === 'application/pdf' ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg') ||
      name.endsWith('.pdf');
    if (ok) cb(null, true);
    else cb(new Error('Only JPG or PDF files are allowed'));
  },
});

function handleVendorInvoiceUpload(req: express.Request, res: express.Response, next: express.NextFunction) {
  vendorInvoiceUpload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ error: message });
    }
    next();
  });
}

function assertVendorInvoiceBuffer(buffer: Buffer, claimedMime: string, originalName: string) {
  if (!buffer?.length || buffer.length < 5) {
    throw new Error('Invalid or empty file');
  }
  const mime = (claimedMime || '').toLowerCase();
  const name = (originalName || '').toLowerCase();
  const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');
  const isJpg = mime === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg');
  if (isPdf) {
    if (buffer.slice(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('File is not a valid PDF');
    }
    return 'pdf';
  }
  if (isJpg) {
    if (!(buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) {
      throw new Error('File is not a valid JPG');
    }
    return 'jpg';
  }
  throw new Error('Only JPG or PDF files are allowed');
}

async function generatePOPDFBuffer(po: any): Promise<Buffer> {
  const poNumber = po.po_number || po._id?.toString() || '—';
  const vendor = po.vendor_id as any;
  const vendorName = vendor?.name ?? '—';
  const vendorLines: string[] = [];
  if (vendor?.phone) vendorLines.push(`Tel: ${vendor.phone}`);
  if (vendor?.city || vendor?.state) vendorLines.push([vendor.city, vendor.state].filter(Boolean).join(', '));
  const created = po.created_at
    ? new Date(po.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  const items = (po.items || []).map((item: any) => ({
    name: item.product_name || 'Product',
    qty: item.quantity_ordered ?? 0,
    unitPrice: Number(item.unit_cost ?? 0),
    lineTotal: Number(item.subtotal ?? (item.quantity_ordered ?? 0) * (item.unit_cost ?? 0)),
  }));

  return buildBusinessDocumentPdf({
    title: 'PURCHASE ORDER',
    subtitle: poNumber,
    partyLabel: 'Vendor',
    partyName: vendorName,
    partyLines: vendorLines,
    meta: [
      { label: 'PO number', value: poNumber },
      { label: 'Date', value: created },
      { label: 'Status', value: String(po.status || '—') },
      { label: 'Expected', value: po.expected_date ? new Date(po.expected_date).toLocaleDateString('en-US') : '—' },
    ],
    items,
    totals: [
      { label: 'Subtotal', value: `$${Number(po.subtotal ?? 0).toFixed(2)}` },
      { label: 'Tax', value: `$${Number(po.tax_amount ?? 0).toFixed(2)}` },
      { label: 'Total', value: `$${Number(po.total_amount ?? 0).toFixed(2)}`, bold: true },
    ],
    itemColumns: { showProductId: false },
  });
}

const generatePONumber = () => `P${String(Math.floor(10000 + Math.random() * 90000))}`;

router.get('/generate-id', authenticateAdmin, (req, res) => {
  res.json({ po_number: generatePONumber() });
});

// List purchase orders
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { status, vendor_id, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    let query: any = {};
    if (status) query.status = status;
    if (vendor_id) query.vendor_id = vendor_id;
    const [pos, total] = await Promise.all([
      PurchaseOrder.find(query).populate('vendor_id', 'name contact_name phone state city supplier_id').sort({ created_at: -1 }).skip(skip).limit(Number(limit)).lean(),
      PurchaseOrder.countDocuments(query),
    ]);
    res.json({
      purchase_orders: (pos as any[]).map((po) => ({
        id: po._id.toString(),
        po_number: po.po_number,
        vendor_id: po.vendor_id?._id?.toString(),
        vendor_name: po.vendor_id?.name,
        supplier_id: po.vendor_id?.supplier_id,
        state: po.vendor_id?.state,
        city: po.vendor_id?.city,
        status: po.status,
        items: serializePoItems(po.items),
        subtotal: po.subtotal,
        tax_amount: po.tax_amount,
        total_amount: po.total_amount,
        expected_date: po.expected_date,
        received_at: po.received_at,
        notes: po.notes,
        created_at: po.created_at,
        ...serializeVendorInvoice(po),
      })),
      pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    console.error('List POs error:', error);
    res.status(500).json({ error: 'Failed to fetch purchase orders' });
  }
});

// PO PDF (must be before GET /:id)
router.get('/:id/pdf', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id).populate('vendor_id').lean();
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    const buffer = await generatePOPDFBuffer(po);
    const filename = `po-${po.po_number || req.params.id}.pdf`;
    sendPdfResponse(res, buffer, filename);
  } catch (error) {
    console.error('PO PDF error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Vendor-sent invoice (JPG or PDF) for future reference
router.post(
  '/:id/vendor-invoice',
  authenticateAdmin,
  handleVendorInvoiceUpload,
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const po = await PurchaseOrder.findById(req.params.id);
      if (!po) return res.status(404).json({ error: 'Purchase order not found' });
      const kind = assertVendorInvoiceBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
      const ext = kind === 'pdf' ? '.pdf' : '.jpg';
      const filename = `${req.params.id}-${Date.now()}${ext}`;
      fs.writeFileSync(path.join(vendorInvoiceDir, filename), req.file.buffer);

      const previous = po.vendor_invoice_url;
      if (previous && previous.startsWith('/uploads/purchase-orders/')) {
        const prevPath = path.join(__dirname, '../..', previous.replace(/^\/+/, ''));
        if (fs.existsSync(prevPath)) {
          try {
            fs.unlinkSync(prevPath);
          } catch {
            /* ignore */
          }
        }
      }

      po.vendor_invoice_url = `/uploads/purchase-orders/${filename}`;
      po.vendor_invoice_name = req.file.originalname || filename;
      po.vendor_invoice_uploaded_at = new Date();
      await po.save();

      res.json({
        id: po._id.toString(),
        ...serializeVendorInvoice(po),
      });
    } catch (error: any) {
      const message = error?.message || 'Failed to upload vendor invoice';
      if (
        message.includes('JPG') ||
        message.includes('PDF') ||
        message.includes('valid') ||
        message.includes('Only')
      ) {
        return res.status(400).json({ error: message });
      }
      console.error('Vendor invoice upload error:', error);
      res.status(500).json({ error: 'Failed to upload vendor invoice' });
    }
  }
);

// Get one PO
router.get('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id).populate('vendor_id').populate('items.product_id', 'name sku barcode').lean();
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    const p = po as any;
    res.json({
      id: p._id.toString(),
      po_number: p.po_number,
      vendor_id: p.vendor_id?._id?.toString(),
      vendor: p.vendor_id,
      status: p.status,
      items: serializePoItems(p.items),
      subtotal: p.subtotal,
      tax_amount: p.tax_amount,
      total_amount: p.total_amount,
      expected_date: p.expected_date,
      received_at: p.received_at,
      notes: p.notes,
      created_at: p.created_at,
      ...serializeVendorInvoice(p),
    });
  } catch (error) {
    console.error('Get PO error:', error);
    res.status(500).json({ error: 'Failed to fetch purchase order' });
  }
});

// Create PO
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      po_number: z.string().optional(),
      vendor_id: z.string(),
      items: z.array(
        z.object({
          product_id: z.string(),
          product_name: z.string(),
          quantity_ordered: z.coerce.number().int().positive(),
          unit_cost: z.coerce.number().min(0),
        })
      ),
      tax_amount: z.coerce.number().min(0).optional(),
      expected_date: z.string().optional(),
      notes: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const vendor = await Vendor.findById(data.vendor_id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const items = data.items.map((item) => {
      const subtotal = item.quantity_ordered * item.unit_cost;
      return {
        product_id: item.product_id,
        product_name: item.product_name,
        quantity_ordered: item.quantity_ordered,
        quantity_received: 0,
        unit_cost: item.unit_cost,
        subtotal,
      };
    });
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
    const tax_amount = data.tax_amount ?? 0;
    const total_amount = subtotal + tax_amount;

    const po = await PurchaseOrder.create({
      po_number: data.po_number || generatePONumber(),
      vendor_id: data.vendor_id,
      status: 'draft',
      items,
      subtotal,
      tax_amount,
      total_amount,
      expected_date: data.expected_date ? new Date(data.expected_date) : undefined,
      notes: data.notes,
      created_by: req.userId,
    });
    // Update each product's cost_price to this PO's unit cost (so inventory reflects latest purchase cost)
    for (const item of items) {
      if (item.product_id) await Product.findByIdAndUpdate(item.product_id, { $set: { cost_price: item.unit_cost } });
    }
    res.status(201).json({
      id: po._id.toString(),
      po_number: po.po_number,
      vendor_id: po.vendor_id,
      status: po.status,
      items: po.items,
      subtotal: po.subtotal,
      tax_amount: po.tax_amount,
      total_amount: po.total_amount,
      created_at: po.created_at,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Create PO error:', error);
    res.status(500).json({ error: 'Failed to create purchase order' });
  }
});

// Update PO (draft only: items, notes)
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (po.status !== 'draft') return res.status(400).json({ error: 'Can only edit draft POs' });

    const schema = z.object({
      items: z
        .array(
          z.object({
            product_id: z.string(),
            product_name: z.string(),
            quantity_ordered: z.coerce.number().int().positive(),
            unit_cost: z.coerce.number().min(0),
          })
        )
        .optional(),
      tax_amount: z.coerce.number().min(0).optional(),
      expected_date: z.string().optional(),
      notes: z.string().optional(),
    });
    const data = schema.parse(req.body);
    if (data.items) {
      const items = data.items.map((item) => ({
        product_id: new mongoose.Types.ObjectId(item.product_id),
        product_name: item.product_name,
        quantity_ordered: item.quantity_ordered,
        quantity_received: 0,
        unit_cost: item.unit_cost,
        subtotal: item.quantity_ordered * item.unit_cost,
      }));
      po.items = items;
      po.subtotal = items.reduce((s, i) => s + i.subtotal, 0);
    }
    if (data.tax_amount !== undefined) po.tax_amount = data.tax_amount;
    if (data.expected_date !== undefined) po.expected_date = data.expected_date ? new Date(data.expected_date) : undefined;
    if (data.notes !== undefined) po.notes = data.notes;
    po.total_amount = po.subtotal + po.tax_amount;
    await po.save();
    // Update each product's cost_price to this PO's unit cost
    for (const line of po.items) {
      const pid = (line as any).product_id;
      if (pid) await Product.findByIdAndUpdate(pid, { $set: { cost_price: (line as any).unit_cost } });
    }
    res.json({ id: po._id.toString(), ...po.toObject() });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Update PO error:', error);
    res.status(500).json({ error: 'Failed to update purchase order' });
  }
});

// Mark PO as sent
router.post('/:id/send', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const po = await PurchaseOrder.findByIdAndUpdate(req.params.id, { status: 'sent' }, { new: true });
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    res.json({ id: po._id.toString(), status: po.status });
  } catch (error) {
    console.error('Send PO error:', error);
    res.status(500).json({ error: 'Failed to update PO' });
  }
});

// Receive PO (full or partial) - updates stock
router.post('/:id/receive', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      items: z.array(
        z.object({
          product_id: z.preprocess((v) => {
            if (v && typeof v === 'object' && (v as { _id?: unknown })._id) {
              return String((v as { _id: unknown })._id);
            }
            return v;
          }, z.string()),
          quantity_received: z.coerce.number().int().min(0),
        })
      ),
    });
    const { items: receivedItems } = schema.parse(req.body);
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (po.status === 'cancelled') return res.status(400).json({ error: 'PO is cancelled' });

    for (const rec of receivedItems) {
      const recId = String(rec.product_id);
      const line = po.items.find((i: any) => poLineProductId(i) === recId);
      if (!line) continue;
      const qty = Math.min(rec.quantity_received, line.quantity_ordered - line.quantity_received);
      if (qty <= 0) continue;
      line.quantity_received += qty;
      await Product.findByIdAndUpdate(recId, { $inc: { stock_quantity: qty } });
      await StockMovement.create({
        product_id: recId,
        movement_type: 'purchase',
        quantity_change: qty,
        reference_type: 'purchase_order',
        reference_id: po._id,
        admin_id: req.userId,
      });
    }
    const allReceived = po.items.every((i: any) => i.quantity_received >= i.quantity_ordered);
    po.status = allReceived ? 'received' : 'partial';
    if (allReceived) po.received_at = new Date();
    await po.save();

    // Post vendor ledger on full receive: DR VENDOR (increase payable), CR PURCHASE
    if (allReceived && po.total_amount > 0) {
      await postVendorLedger(
        po.vendor_id,
        [
          { account_type: 'VENDOR', debit: po.total_amount, credit: 0, reference_type: LedgerReferenceType.PURCHASE_ORDER, reference_id: po._id, description: `PO ${po.po_number} received` },
          { account_type: 'PURCHASE', debit: 0, credit: po.total_amount, reference_type: LedgerReferenceType.PURCHASE_ORDER, reference_id: po._id, description: `PO ${po.po_number}` },
        ],
        req.userId ? new mongoose.Types.ObjectId(req.userId) : undefined
      );
    }

    res.json({ id: po._id.toString(), status: po.status, items: po.items });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Receive PO error:', error);
    res.status(500).json({ error: 'Failed to receive PO' });
  }
});

// Cancel PO
router.post('/:id/cancel', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const po = await PurchaseOrder.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    res.json({ id: po._id.toString(), status: po.status });
  } catch (error) {
    console.error('Cancel PO error:', error);
    res.status(500).json({ error: 'Failed to cancel PO' });
  }
});

// Delete PO (pending / cancelled only — received goods stay in the books)
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    const status = String(po.status || '').toLowerCase();
    if (status === 'received' || status === 'partial') {
      return res.status(400).json({
        error: `${po.po_number || 'This purchase order'} has received goods and cannot be deleted. Export it instead.`,
      });
    }
    await PurchaseOrder.deleteOne({ _id: po._id });
    res.json({ success: true, id: po._id.toString() });
  } catch (error) {
    console.error('Delete PO error:', error);
    res.status(500).json({ error: 'Failed to delete purchase order' });
  }
});

export default router;
