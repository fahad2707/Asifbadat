import express from 'express';
import mongoose from 'mongoose';
import { authenticateAdmin } from '../middleware/auth';
import Customer from '../models/Customer';
import Product from '../models/Product';
import Invoice from '../models/Invoice';
import Receipt from '../models/Receipt';
import RFQ from '../models/RFQ';
import Vendor from '../models/Vendor';
import PurchaseOrder from '../models/PurchaseOrder';
import OnlineOrder from '../models/OnlineOrder';
import WebsiteSignupApplication, { WEBSITE_SIGNUP_STATUS_PENDING } from '../models/WebsiteSignupApplication';
import CreditMemo from '../modules/credit-memo/models/CreditMemo';
import Shipment from '../modules/shipping/models/Shipment';
import AdminNotice from '../models/AdminNotice';
import { serializeAdminNotice } from '../services/adminNotice';
import { isExactCode, sortDeskHits, textRegex, type DeskHit } from '../services/adminDeskSearch';

const router = express.Router();
const PER_TYPE = 8;

function idOf(doc: { _id?: unknown }): string {
  return String(doc._id || '');
}

router.get('/search', authenticateAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) return res.json({ query: q, hits: [] });
    if (q.length > 80) return res.status(400).json({ error: 'Search is too long.' });
    const rx = textRegex(q);
    const hits: DeskHit[] = [];

    const [
      customers,
      products,
      invoices,
      receipts,
      rfqs,
      shipments,
      memos,
      orders,
      vendors,
      pos,
      signups,
    ] = await Promise.all([
      Customer.find({
        is_active: { $ne: false },
        $or: [{ name: rx }, { company: rx }, { phone: rx }, { email: rx }, { customer_code: rx }],
      })
        .select('name company phone email customer_code')
        .limit(PER_TYPE)
        .lean(),
      Product.find({
        $and: [
          { $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }] },
          { $or: [{ name: rx }, { sku: rx }, { product_id: rx }, { barcode: rx }] },
        ],
      })
        .select('name sku product_id barcode stock_quantity')
        .limit(PER_TYPE)
        .lean(),
      Invoice.find({
        $or: [{ invoice_number: rx }, { customer_name: rx }, { customer_phone: rx }, { customer_email: rx }],
      })
        .select('invoice_number invoice_type customer_name total_amount')
        .sort({ created_at: -1 })
        .limit(PER_TYPE)
        .lean(),
      Receipt.find({
        $or: [{ trx_id: rx }, { customer_name: rx }, { invoice_num: rx }],
      })
        .select('trx_id customer_name invoice_num amount_received state')
        .sort({ trx_date: -1 })
        .limit(PER_TYPE)
        .lean(),
      RFQ.find({
        $or: [{ rfq_number: rx }, { customer_name: rx }, { customer_phone: rx }, { customer_email: rx }, { customer_company: rx }],
      })
        .select('rfq_number customer_name status customer_company')
        .sort({ created_at: -1 })
        .limit(PER_TYPE)
        .lean(),
      Shipment.find({
        $or: [{ shipment_number: rx }, { lr_number: rx }, { vehicle_number: rx }],
      })
        .select('shipment_number status lr_number')
        .sort({ created_at: -1 })
        .limit(PER_TYPE)
        .lean(),
      CreditMemo.find({
        $or: [{ credit_memo_number: rx }, { notes: rx }],
      })
        .select('credit_memo_number type status total_amount customer_id vendor_id')
        .populate('customer_id', 'name')
        .populate('vendor_id', 'name')
        .sort({ created_at: -1 })
        .limit(PER_TYPE)
        .lean(),
      OnlineOrder.find({
        $or: [{ order_number: rx }, { customer_name: rx }, { customer_email: rx }, { customer_phone: rx }],
      })
        .select('order_number customer_name status total_amount')
        .sort({ created_at: -1 })
        .limit(PER_TYPE)
        .lean(),
      Vendor.find({
        is_active: { $ne: false },
        $or: [{ name: rx }, { phone: rx }, { email: rx }, { supplier_id: rx }],
      })
        .select('name phone supplier_id')
        .limit(PER_TYPE)
        .lean(),
      PurchaseOrder.find({ po_number: rx })
        .select('po_number status total_amount')
        .sort({ created_at: -1 })
        .limit(PER_TYPE)
        .lean(),
      WebsiteSignupApplication.find({
        $and: [
          { $or: [{ submitted_name: rx }, { submitted_email: rx }, { submitted_phone: rx }] },
          { $or: [{ removed_at: { $exists: false } }, { removed_at: null }] },
        ],
      })
        .select('submitted_name submitted_email status')
        .sort({ created_at: -1 })
        .limit(PER_TYPE)
        .lean(),
    ]);

    for (const c of customers as Array<{ name?: string; company?: string; phone?: string; customer_code?: string }>) {
      hits.push({
        type: 'Customer',
        title: String(c.name || 'Customer'),
        subtitle: [c.customer_code, c.company, c.phone].filter(Boolean).join(' · '),
        href: `/admin/customers/${idOf(c)}`,
        exact: isExactCode(c.customer_code, q) || isExactCode(c.name, q),
      });
    }
    for (const p of products as Array<{ name?: string; sku?: string; product_id?: string; barcode?: string; stock_quantity?: number }>) {
      hits.push({
        type: 'Product',
        title: String(p.name || 'Product'),
        subtitle: [p.sku, p.product_id, p.barcode ? `barcode ${p.barcode}` : '', `on hand ${p.stock_quantity ?? 0}`]
          .filter(Boolean)
          .join(' · '),
        href: `/admin/products/${idOf(p)}`,
        exact: isExactCode(p.sku, q) || isExactCode(p.product_id, q) || isExactCode(p.barcode, q),
      });
    }
    for (const i of invoices as Array<{ invoice_number?: string; invoice_type?: string; customer_name?: string; total_amount?: number }>) {
      const quote = i.invoice_type === 'quotation';
      hits.push({
        type: quote ? 'Quotation' : 'Invoice',
        title: String(i.invoice_number || 'Invoice'),
        subtitle: [i.customer_name, `$${(Number(i.total_amount) || 0).toFixed(2)}`].filter(Boolean).join(' · '),
        href: `/admin/invoices?q=${encodeURIComponent(String(i.invoice_number || ''))}&open=${idOf(i)}`,
        exact: isExactCode(i.invoice_number, q),
      });
    }
    for (const r of receipts as Array<{ trx_id?: string; customer_name?: string; invoice_num?: string; amount_received?: number; state?: string }>) {
      hits.push({
        type: 'Transaction',
        title: String(r.trx_id || 'TRX'),
        subtitle: [r.customer_name, r.invoice_num, `$${(Number(r.amount_received) || 0).toFixed(2)}`, r.state].filter(Boolean).join(' · '),
        href: `/admin/receipts?q=${encodeURIComponent(String(r.trx_id || ''))}`,
        exact: isExactCode(r.trx_id, q),
      });
    }
    for (const r of rfqs as Array<{ rfq_number?: string; customer_name?: string; status?: string; customer_company?: string }>) {
      hits.push({
        type: 'RFQ',
        title: String(r.rfq_number || 'RFQ'),
        subtitle: [r.customer_name, r.customer_company, r.status].filter(Boolean).join(' · '),
        href: `/admin/rfq?q=${encodeURIComponent(String(r.rfq_number || ''))}&open=${idOf(r)}`,
        exact: isExactCode(r.rfq_number, q),
      });
    }
    for (const s of shipments as Array<{ shipment_number?: string; status?: string; lr_number?: string }>) {
      hits.push({
        type: 'Shipment',
        title: String(s.shipment_number || 'Shipment'),
        subtitle: [s.status, s.lr_number].filter(Boolean).join(' · '),
        href: `/admin/shipments?q=${encodeURIComponent(String(s.shipment_number || ''))}`,
        exact: isExactCode(s.shipment_number, q) || isExactCode(s.lr_number, q),
      });
    }
    for (const m of memos as Array<{
      credit_memo_number?: string;
      type?: string;
      status?: string;
      total_amount?: number;
      customer_id?: { name?: string };
      vendor_id?: { name?: string };
    }>) {
      const party = m.type === 'VENDOR' ? m.vendor_id?.name : m.customer_id?.name;
      const base = m.type === 'VENDOR' ? '/admin/credit-memos/vendors' : '/admin/credit-memos/customers';
      hits.push({
        type: 'Credit memo',
        title: String(m.credit_memo_number || 'Credit memo'),
        subtitle: [party, m.status, `$${(Number(m.total_amount) || 0).toFixed(2)}`].filter(Boolean).join(' · '),
        href: `${base}?q=${encodeURIComponent(String(m.credit_memo_number || ''))}`,
        exact: isExactCode(m.credit_memo_number, q),
      });
    }
    for (const o of orders as Array<{ order_number?: string; customer_name?: string; status?: string; total_amount?: number }>) {
      hits.push({
        type: 'Online order',
        title: String(o.order_number || 'Order'),
        subtitle: [o.customer_name, o.status, `$${(Number(o.total_amount) || 0).toFixed(2)}`].filter(Boolean).join(' · '),
        href: `/admin/orders?q=${encodeURIComponent(String(o.order_number || ''))}`,
        exact: isExactCode(o.order_number, q),
      });
    }
    for (const v of vendors as Array<{ name?: string; phone?: string; supplier_id?: string }>) {
      hits.push({
        type: 'Vendor',
        title: String(v.name || 'Vendor'),
        subtitle: [v.supplier_id, v.phone].filter(Boolean).join(' · '),
        href: `/admin/vendors?q=${encodeURIComponent(String(v.name || ''))}`,
        exact: isExactCode(v.supplier_id, q) || isExactCode(v.name, q),
      });
    }
    for (const po of pos as Array<{ po_number?: string; status?: string; total_amount?: number }>) {
      hits.push({
        type: 'Purchase order',
        title: String(po.po_number || 'PO'),
        subtitle: [po.status, `$${(Number(po.total_amount) || 0).toFixed(2)}`].filter(Boolean).join(' · '),
        href: `/admin/purchase-orders?q=${encodeURIComponent(String(po.po_number || ''))}`,
        exact: isExactCode(po.po_number, q),
      });
    }
    for (const s of signups as Array<{ submitted_name?: string; submitted_email?: string; status?: string }>) {
      hits.push({
        type: 'Website signup',
        title: String(s.submitted_name || s.submitted_email || 'Signup'),
        subtitle: [s.submitted_email, s.status].filter(Boolean).join(' · '),
        href: `/admin/website-signups?q=${encodeURIComponent(String(s.submitted_email || s.submitted_name || ''))}`,
        exact: isExactCode(s.submitted_email, q),
      });
    }

    const sorted = sortDeskHits(hits).slice(0, 40);
    const barcode = sorted.find((hit) => hit.exact) || null;
    res.json({ query: q, hits: sorted, barcode });
  } catch (error) {
    console.error('Admin desk search:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/inbox', authenticateAdmin, async (_req, res) => {
  try {
    const [rfq, website_signups, online_orders] = await Promise.all([
      RFQ.countDocuments({ status: 'pending' }),
      WebsiteSignupApplication.countDocuments({
        status: WEBSITE_SIGNUP_STATUS_PENDING,
        $or: [{ removed_at: { $exists: false } }, { removed_at: null }],
      }),
      OnlineOrder.countDocuments({ status: { $in: ['confirmed', 'quoted', 'packed', 'dispatched'] } }),
    ]);
    res.json({ rfq, website_signups, online_orders });
  } catch (error) {
    console.error('Admin inbox:', error);
    res.status(500).json({ error: 'Could not load inbox counts' });
  }
});

router.get('/notices', authenticateAdmin, async (req, res) => {
  try {
    const afterRaw = String(req.query.after || '').trim();
    const after = afterRaw ? new Date(afterRaw) : null;
    const filter: Record<string, unknown> = {};
    if (after && !Number.isNaN(after.getTime())) filter.created_at = { $gt: after };
    const rows = await AdminNotice.find(filter).sort({ created_at: -1 }).limit(60).lean();
    res.json({ notices: rows.map((row) => serializeAdminNotice(row as { _id: mongoose.Types.ObjectId } & typeof row)) });
  } catch (error) {
    console.error('Admin notices:', error);
    res.status(500).json({ error: 'Could not load notifications' });
  }
});

export default router;
