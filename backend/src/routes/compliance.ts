/**
 * Compliance reporting API.
 * Reads existing sales and product records. Writes only compliance drafts,
 * exemption reviews, tobacco ledger rows, and preview report snapshots.
 * It does not change invoices, POS sales, stock, or customer tax_exempt.
 * Filing-ready and filed are rejected.
 */

import { Router } from 'express';
import mongoose from 'mongoose';
import { authenticateAdmin, type AuthRequest } from '../middleware/auth';
import Invoice from '../models/Invoice';
import POSSale from '../models/POSSale';
import OnlineOrder from '../models/OnlineOrder';
import Order from '../models/Order';
import Receipt from '../models/Receipt';
import Product from '../models/Product';
import Customer from '../models/Customer';
import Admin from '../models/Admin';
import AuditLog from '../models/AuditLog';
import ComplianceConfiguration from '../models/ComplianceConfiguration';
import ComplianceReport from '../models/ComplianceReport';
import SalesTaxExemption from '../models/SalesTaxExemption';
import TobaccoLedgerEntry from '../models/TobaccoLedgerEntry';
import { writeAuditLogInTransaction } from '../utils/auditLog';
import { salesTaxSetupStatus, COMPLIANCE_DECISIONS, TOBACCO_REPORT_GATES } from '../services/salesTax/decisions';
import { calculateSalesTaxPreview } from '../services/salesTax/salesTaxService';
import { resolveSalesTaxJurisdiction } from '../services/salesTax/jurisdictionResolver';
import { toPreviewCsv } from '../services/complianceReporting/csvExport';
import { transitionReportingPeriod } from '../services/complianceReporting/periodWorkflow';
import {
  summarizeSalesTaxRecords,
  type StoredOnlineOrder,
  type StoredPosSale,
  type StoredWholesaleInvoice,
} from '../services/complianceReporting/salesTaxAggregate';
import { buildRev772Preview, buildRev777Preview, TOBACCO_OFFICIAL_SOURCES, type TobaccoMovementInput } from '../services/complianceReporting/tobaccoReports';
import { assessRegisterDocument, filterTransactionRegister, pageRows, type RegisterDocument } from '../services/complianceReporting/transactionRegister';
import { applyTobaccoComplianceToMongoUpdate, parseTobaccoComplianceBody } from '../utils/productTobaccoCompliance';
import { attachActors } from '../services/complianceReporting/actorDisplay';
import { tobaccoProductSearch } from '../services/complianceReporting/productSearch';
import { createExemptionDraft, DuplicateExemptionError, ExemptionCertificateRequiredError } from '../services/exemptions/exemptionDraft';

const router = Router();
const QUERY_LIMIT = 2000;

router.use(authenticateAdmin);

function adminId(req: AuthRequest): mongoose.Types.ObjectId | null {
  return req.userId && mongoose.Types.ObjectId.isValid(req.userId) ? new mongoose.Types.ObjectId(req.userId) : null;
}

function lookupAdminNames(ids: string[]) {
  return Admin.find({ _id: { $in: ids } }).select('name').lean();
}

function periodQuery(req: AuthRequest): { start: Date; end: Date; label: string } | { error: string } {
  const startRaw = String(req.query.start || '');
  const endRaw = String(req.query.end || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(endRaw) || startRaw > endRaw) {
    return { error: 'Provide start and end as YYYY-MM-DD, with start on or before end.' };
  }
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T23:59:59.999Z`);
  return { start, end, label: `${startRaw} to ${endRaw}` };
}

router.get('/overview', async (_req, res) => {
  const setup = salesTaxSetupStatus();
  res.json({
    postingAllowed: false,
    filingReady: false,
    setup,
    decisions: COMPLIANCE_DECISIONS,
    tobaccoReports: TOBACCO_REPORT_GATES,
    officialSources: TOBACCO_OFFICIAL_SOURCES,
    liveTaxPosting: false,
    note: 'Recorded amounts are previews of stored snapshots. They are not a sales-tax return or a tobacco filing.',
  });
});

router.get('/sales-tax/summary', async (req: AuthRequest, res) => {
  const period = periodQuery(req);
  if ('error' in period) return res.status(400).json({ error: period.error });
  const date = { $gte: period.start, $lte: period.end };
  const [invoices, invoiceCount, posSales, posCount, onlineOrders, onlineCount, legacyCount, receiptCount, posSlipCount, quotationCount] =
    await Promise.all([
      Invoice.find({
        invoice_date: date,
        invoice_type: 'invoice',
        source: 'WHOLESALE',
      })
        .select('invoice_number invoice_type source tax_amount items.taxable items.tax_exempt items.subtotal items.tax_amount')
        .limit(QUERY_LIMIT)
        .lean(),
      Invoice.countDocuments({ invoice_date: date, invoice_type: 'invoice', source: 'WHOLESALE' }),
      POSSale.find({ created_at: date })
        .select('sale_number tax_amount items.tax items.price items.quantity items.discount')
        .limit(QUERY_LIMIT)
        .lean(),
      POSSale.countDocuments({ created_at: date }),
      OnlineOrder.find({ created_at: date })
        .select('order_number tax_amount items.tax_rate items.subtotal status')
        .limit(QUERY_LIMIT)
        .lean(),
      OnlineOrder.countDocuments({ created_at: date }),
      Order.countDocuments({ created_at: date }),
      Receipt.countDocuments({ trx_date: date }),
      Invoice.countDocuments({ invoice_date: date, invoice_type: { $in: ['pos', 'website', 'store_pickup'] } }),
      Invoice.countDocuments({ invoice_date: date, invoice_type: 'quotation' }),
    ]);

  const summary = summarizeSalesTaxRecords({
    invoices: invoices.map(mapInvoice),
    posSales: posSales.map(mapPos),
    onlineOrders: onlineOrders.map(mapOnline),
    legacyOrderCount: legacyCount,
    receiptCount,
  });
  summary.excluded.posSlips += posSlipCount;
  summary.excluded.quotations += quotationCount;
  const truncated = invoiceCount > QUERY_LIMIT || posCount > QUERY_LIMIT || onlineCount > QUERY_LIMIT;
  if (truncated) {
    summary.status = 'incomplete';
    summary.blockers.push('result_truncated');
  }
  res.json({
    period: period.label,
    truncated,
    counts: { invoices: invoiceCount, posSales: posCount, onlineOrders: onlineCount, legacyOrders: legacyCount },
    summary,
  });
});

router.get('/operations', async (_req, res) => {
  const [pendingExemptions, reportsNeedingReview, savedReports, unknownProducts, missingPackaging, incompleteMovements] = await Promise.all([
    SalesTaxExemption.countDocuments({ status: 'pending_review' }),
    ComplianceReport.countDocuments({ status: 'needs_review' }),
    ComplianceReport.countDocuments({}),
    Product.countDocuments({ $or: [{ tobacco_class: 'unknown' }, { tobacco_class: { $exists: false } }, { tobacco_class: null }] }),
    Product.countDocuments({
      tobacco_class: 'cigarette',
      $or: [
        { cigarette_pack_size: { $exists: false } },
        { cigarette_pack_size: null },
        { stock_unit: { $exists: false } },
        { stock_unit: null },
        { packs_per_stock_unit: { $exists: false } },
        { packs_per_stock_unit: null },
      ],
    }),
    TobaccoLedgerEntry.countDocuments({
      $or: [
        { stamp: { $in: ['unknown', null, ''] } },
        { stamp: { $exists: false } },
        { packs_per_stock_unit: { $exists: false } },
        { packs_per_stock_unit: null },
        { cigarette_pack_size: { $nin: [20, 25] } },
      ],
    }),
  ]);
  res.json({
    postingAllowed: false,
    filingReady: false,
    pendingReviews: { availability: 'recorded', count: pendingExemptions + reportsNeedingReview },
    incompleteTransactions: { availability: 'unavailable', reason: 'Select a reporting period in Sales Tax.' },
    unreconciledPeriods: { availability: 'unavailable', reason: 'A verified reconciled status is not stored.' },
    savedReports: { availability: 'recorded', count: savedReports },
    workQueue: [
      { id: 'tax-period', title: 'Missing tax information', status: 'Review', detail: 'Open a period to see transactions that still need a tax snapshot.', href: '/admin/compliance/sales-tax?tab=transactions', count: null },
      { id: 'exemptions', title: 'Exemption reviews', status: pendingExemptions > 0 ? 'Pending' : 'None waiting', detail: 'Certificates in pending review.', href: '/admin/compliance/sales-tax?tab=exemptions', count: pendingExemptions },
      { id: 'tobacco-class', title: 'Unclassified products', status: unknownProducts > 0 ? 'Incomplete' : 'None waiting', detail: 'Catalogue products still marked unknown.', href: '/admin/compliance/tobacco?tab=products', count: unknownProducts },
      { id: 'tobacco-packaging', title: 'Cigarettes missing packaging', status: missingPackaging > 0 ? 'Incomplete' : 'None waiting', detail: 'Cigarette products missing pack size, unit, or packs per unit.', href: '/admin/compliance/tobacco?tab=products', count: missingPackaging },
      { id: 'ledger', title: 'Tobacco movements', status: incompleteMovements > 0 ? 'Incomplete' : 'None waiting', detail: 'Ledger rows missing a stamp or a pack conversion.', href: '/admin/compliance/tobacco?tab=ledger', count: incompleteMovements },
      { id: 'reports', title: 'Reports requiring review', status: reportsNeedingReview > 0 ? 'Needs review' : 'None waiting', detail: 'Saved previews sent for review.', href: '/admin/compliance/reports', count: reportsNeedingReview },
    ],
  });
});

router.get('/sales-tax/transactions', async (req: AuthRequest, res) => {
  const period = periodQuery(req);
  if ('error' in period) return res.status(400).json({ error: period.error });
  const date = { $gte: period.start, $lte: period.end };
  const source = String(req.query.source || 'all');
  const wantWholesale = source === 'all' || source === 'wholesale';
  const wantPos = source === 'all' || source === 'pos';
  const wantOnline = source === 'all' || source === 'online';
  const [invoices, invoiceCount, posSales, posCount, onlineOrders, onlineCount] = await Promise.all([
    wantWholesale
      ? Invoice.find({ invoice_date: date, invoice_type: 'invoice', source: 'WHOLESALE' })
          .select('invoice_number invoice_date customer_name total_amount tax_amount invoice_type source items.taxable items.tax_exempt items.subtotal items.tax_amount')
          .limit(QUERY_LIMIT)
          .lean()
      : Promise.resolve([]),
    wantWholesale ? Invoice.countDocuments({ invoice_date: date, invoice_type: 'invoice', source: 'WHOLESALE' }) : Promise.resolve(0),
    wantPos
      ? POSSale.find({ created_at: date })
          .select('sale_number created_at customer_name total_amount tax_amount items.tax items.price items.quantity items.discount')
          .limit(QUERY_LIMIT)
          .lean()
      : Promise.resolve([]),
    wantPos ? POSSale.countDocuments({ created_at: date }) : Promise.resolve(0),
    wantOnline
      ? OnlineOrder.find({ created_at: date })
          .select('order_number created_at customer_name total_amount tax_amount items.tax_rate items.subtotal')
          .limit(QUERY_LIMIT)
          .lean()
      : Promise.resolve([]),
    wantOnline ? OnlineOrder.countDocuments({ created_at: date }) : Promise.resolve(0),
  ]);
  const documents: RegisterDocument[] = [
    ...invoices.map((invoice) => ({
      id: String(invoice._id),
      source: 'wholesale' as const,
      number: invoice.invoice_number,
      date: invoice.invoice_date ? new Date(invoice.invoice_date).toISOString().slice(0, 10) : null,
      customer: invoice.customer_name || null,
      storedTotal: invoice.total_amount,
      invoice: mapInvoice(invoice),
    })),
    ...posSales.map((sale) => ({
      id: String(sale._id),
      source: 'pos' as const,
      number: sale.sale_number,
      date: sale.created_at ? new Date(sale.created_at).toISOString().slice(0, 10) : null,
      customer: sale.customer_name || null,
      storedTotal: sale.total_amount,
      pos: mapPos(sale),
    })),
    ...onlineOrders.map((order) => ({
      id: String(order._id),
      source: 'online' as const,
      number: order.order_number,
      date: order.created_at ? new Date(order.created_at).toISOString().slice(0, 10) : null,
      customer: order.customer_name || null,
      storedTotal: order.total_amount,
      online: mapOnline(order),
    })),
  ];
  const filtered = filterTransactionRegister(
    documents.map(assessRegisterDocument),
    { source, status: String(req.query.status || 'all'), q: String(req.query.q || '') }
  ).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.number.localeCompare(b.number));
  const page = pageRows(filtered, Number(req.query.page || 1), Number(req.query.limit || 50));
  const truncated = invoiceCount > QUERY_LIMIT || posCount > QUERY_LIMIT || onlineCount > QUERY_LIMIT;
  res.json({ ...page, truncated, filingReady: false, postingAllowed: false });
});

router.get('/sales-tax/transactions/:source/:id', async (req: AuthRequest, res) => {
  const source = req.params.source;
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Transaction not found.' });
  if (source === 'wholesale') {
    const invoice = await Invoice.findOne({ _id: req.params.id, invoice_type: 'invoice', source: 'WHOLESALE' })
      .select('invoice_number invoice_date customer_name customer_address location_of_sale total_amount subtotal_amount tax_amount invoice_type source items.product_name items.quantity items.subtotal items.taxable items.tax_exempt items.tax_amount')
      .lean();
    if (!invoice) return res.status(404).json({ error: 'Transaction not found.' });
    const row = assessRegisterDocument({
      id: String(invoice._id),
      source: 'wholesale',
      number: invoice.invoice_number,
      date: invoice.invoice_date ? new Date(invoice.invoice_date).toISOString().slice(0, 10) : null,
      customer: invoice.customer_name || null,
      storedTotal: invoice.total_amount,
      invoice: mapInvoice(invoice),
    });
    return res.json({
      ...row,
      storedLocation: invoice.location_of_sale || null,
      storedAddress: invoice.customer_address || null,
      lines: invoice.items || [],
      filingReady: false,
    });
  }
  if (source === 'pos') {
    const sale = await POSSale.findById(req.params.id)
      .select('sale_number created_at customer_name total_amount tax_amount items.quantity items.price items.discount items.tax items.subtotal')
      .lean();
    if (!sale) return res.status(404).json({ error: 'Transaction not found.' });
    const row = assessRegisterDocument({
      id: String(sale._id),
      source: 'pos',
      number: sale.sale_number,
      date: sale.created_at ? new Date(sale.created_at).toISOString().slice(0, 10) : null,
      customer: sale.customer_name || null,
      storedTotal: sale.total_amount,
      pos: mapPos(sale),
    });
    return res.json({ ...row, storedLocation: null, storedAddress: null, lines: sale.items || [], filingReady: false });
  }
  if (source === 'online') {
    const order = await OnlineOrder.findById(req.params.id)
      .select('order_number created_at customer_name address_line1 address_line2 city state zip country total_amount tax_amount items.product_name items.quantity items.subtotal items.tax_rate')
      .lean();
    if (!order) return res.status(404).json({ error: 'Transaction not found.' });
    const row = assessRegisterDocument({
      id: String(order._id),
      source: 'online',
      number: order.order_number,
      date: order.created_at ? new Date(order.created_at).toISOString().slice(0, 10) : null,
      customer: order.customer_name || null,
      storedTotal: order.total_amount,
      online: mapOnline(order),
    });
    const storedAddress = [order.address_line1, order.address_line2, order.city, order.state, order.zip, order.country].filter(Boolean).join(', ');
    return res.json({ ...row, storedLocation: null, storedAddress, lines: order.items || [], filingReady: false });
  }
  return res.status(404).json({ error: 'Transaction not found.' });
});

router.post('/reports/sales-tax', async (req: AuthRequest, res) => {
  const period = periodFromBody(req.body);
  if ('error' in period) return res.status(400).json({ error: period.error });
  const date = { $gte: period.start, $lte: period.end };
  const [invoices, posSales, onlineOrders, legacyCount, receiptCount] = await Promise.all([
    Invoice.find({ invoice_date: date, invoice_type: 'invoice', source: 'WHOLESALE' })
      .select('invoice_number invoice_type source tax_amount items.taxable items.tax_exempt items.subtotal items.tax_amount')
      .limit(QUERY_LIMIT)
      .lean(),
    POSSale.find({ created_at: date }).select('sale_number tax_amount items.tax').limit(QUERY_LIMIT).lean(),
    OnlineOrder.find({ created_at: date }).select('order_number tax_amount items.tax_rate items.subtotal').limit(QUERY_LIMIT).lean(),
    Order.countDocuments({ created_at: date }),
    Receipt.countDocuments({ trx_date: date }),
  ]);
  const summary = summarizeSalesTaxRecords({
    invoices: invoices.map(mapInvoice),
    posSales: posSales.map(mapPos),
    onlineOrders: onlineOrders.map(mapOnline),
    legacyOrderCount: legacyCount,
    receiptCount,
  });
  try {
    const saved = await savePreviewReport(req, 'sales_tax_summary', period, summary);
    res.status(201).json({ id: saved.id, summary, filingReady: false });
  } catch {
    res.status(500).json({ error: 'The compliance write failed and was rolled back.' });
  }
});

router.get('/sales-tax/export.csv', async (req: AuthRequest, res) => {
  const period = periodQuery(req);
  if ('error' in period) return res.status(400).json({ error: period.error });
  const date = { $gte: period.start, $lte: period.end };
  const invoices = await Invoice.find({ invoice_date: date, invoice_type: 'invoice', source: 'WHOLESALE' })
    .select('invoice_number tax_amount items.taxable items.tax_amount')
    .limit(QUERY_LIMIT)
    .lean();
  const csv = toPreviewCsv({
    title: 'Sales tax recorded snapshots',
    periodLabel: period.label,
    generatedAt: new Date().toISOString(),
    blockers: ['rounding_method', 'jurisdiction_sourcing', 'filing_frequency'],
    headers: ['invoice_number', 'stored_tax'],
    rows: invoices.map((invoice) => [invoice.invoice_number, invoice.tax_amount ?? '']),
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sales-tax-preview.csv"');
  res.send(csv);
});

router.post('/sales-tax/preview', (req: AuthRequest, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const jurisdiction = resolveSalesTaxJurisdiction((body.jurisdiction ?? {}) as never);
  if (jurisdiction.status !== 'resolved') {
    return res.status(200).json({ postingAllowed: false, filingReady: false, jurisdiction, calculation: null });
  }
  const calculation = calculateSalesTaxPreview((body.calculation ?? {}) as never);
  res.json({ postingAllowed: false, filingReady: false, jurisdiction, calculation });
});

router.post('/configuration', async (req: AuthRequest, res) => {
  const domain = req.body?.domain === 'tobacco' ? 'tobacco' : req.body?.domain === 'sales_tax' ? 'sales_tax' : null;
  if (!domain || req.body?.payload == null || typeof req.body.payload !== 'object') {
    return res.status(400).json({ error: 'domain and payload are required.' });
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const [created] = await ComplianceConfiguration.create(
      [
        {
          domain,
          status: 'draft',
          effective_from: req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : undefined,
          effective_to: req.body.effectiveTo ? new Date(req.body.effectiveTo) : undefined,
          payload: req.body.payload,
          created_by: adminId(req) ?? undefined,
          updated_by: adminId(req) ?? undefined,
        },
      ],
      { session }
    );
    await writeAuditLogInTransaction(session, {
      action: 'compliance_configuration_draft_created',
      entityType: 'ComplianceConfiguration',
      entityId: created._id,
      adminId: adminId(req),
      after: { domain, status: 'draft' },
    });
    await session.commitTransaction();
    res.status(201).json({ id: created._id, status: 'draft', filingReady: false, postingAllowed: false });
  } catch (error) {
    await session.abortTransaction();
    console.error('Compliance write rolled back:', error);
    return res.status(500).json({ error: 'The compliance write failed and was rolled back.' });
  } finally {
    session.endSession();
  }
});

router.get('/configuration', async (_req, res) => {
  const rows = await ComplianceConfiguration.find().sort({ created_at: -1 }).limit(50).lean();
  res.json({ rows, filingReady: false });
});

router.post('/exemptions', async (req: AuthRequest, res) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.body?.customerId || ''))) {
    return res.status(400).json({ error: 'A customer id is required.' });
  }
  const customer = await Customer.findById(req.body.customerId).select('_id tax_exempt').lean();
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  try {
    const created = await createExemptionDraft({
      customerId: customer._id,
      certificateNumber: req.body.certificateNumber,
      exemptionType: req.body.exemptionType,
      effectiveOn: req.body.effectiveOn,
      expiresOn: req.body.expiresOn,
      adminId: adminId(req),
    });
    const unchanged = await Customer.findById(customer._id).select('tax_exempt').lean();
    res.status(201).json({
      id: created.id,
      status: created.status,
      customerTaxExemptChanged: unchanged?.tax_exempt !== customer.tax_exempt,
    });
  } catch (error) {
    if (error instanceof ExemptionCertificateRequiredError) return res.status(400).json({ error: error.message });
    if (error instanceof DuplicateExemptionError) return res.status(409).json({ error: error.message });
    console.error('Compliance write rolled back:', error);
    return res.status(500).json({ error: 'The compliance write failed and was rolled back.' });
  }
});

router.post('/exemptions/:id/review', async (req: AuthRequest, res) => {
  const next = String(req.body?.status || '');
  if (!['pending_review', 'approved', 'rejected', 'revoked'].includes(next)) {
    return res.status(400).json({ error: 'Unsupported exemption status.' });
  }
  const existing = await SalesTaxExemption.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Exemption not found.' });
  if (next === 'approved' && !existing.effective_on) {
    return res.status(400).json({ error: 'An approved exemption needs an effective date.' });
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const before = existing.status;
    existing.status = next as typeof existing.status;
    existing.reviewed_by = adminId(req) ?? undefined;
    existing.review_note = req.body?.note ? String(req.body.note) : existing.review_note;
    await existing.save({ session });
    await writeAuditLogInTransaction(session, {
      action: 'sales_tax_exemption_reviewed',
      entityType: 'SalesTaxExemption',
      entityId: existing._id,
      adminId: adminId(req),
      before: { status: before },
      after: { status: next },
    });
    await session.commitTransaction();
    res.json({ id: existing._id, status: existing.status, customerTaxExemptChanged: false });
  } catch (error) {
    await session.abortTransaction();
    console.error('Compliance write rolled back:', error);
    return res.status(500).json({ error: 'The compliance write failed and was rolled back.' });
  } finally {
    session.endSession();
  }
});

router.get('/exemptions', async (_req, res) => {
  const [rows, history] = await Promise.all([
    SalesTaxExemption.find()
      .select('customer_id certificate_number exemption_type status effective_on expires_on review_note created_at')
      .sort({ created_at: -1 })
      .limit(50)
      .lean(),
    AuditLog.find({ action: { $in: ['sales_tax_exemption_draft_created', 'sales_tax_exemption_reviewed'] } })
      .select('action entity_type entity_id old_value new_value created_at admin_id')
      .sort({ created_at: -1 })
      .limit(20)
      .lean(),
  ]);
  res.json({
    rows,
    history: await attachActors(history, 'admin_id', lookupAdminNames),
    customerTaxExemptChanged: false,
  });
});

router.get('/audit', async (_req, res) => {
  const rows = await AuditLog.find({
    action: {
      $in: [
        'compliance_configuration_draft_created',
        'sales_tax_exemption_draft_created',
        'sales_tax_exemption_reviewed',
        'tobacco_ledger_manual_entry',
        'tobacco_classification_changed',
        'compliance_report_preview_created',
        'compliance_report_transition',
      ],
    },
  })
    .select('action entity_type entity_id old_value new_value created_at admin_id')
    .sort({ created_at: -1 })
    .limit(50)
    .lean();
  res.json({ rows: await attachActors(rows, 'admin_id', lookupAdminNames) });
});

router.get('/tobacco/products', async (req, res) => {
  const q = String(req.query.q || '');
  const tobaccoClass = String(req.query.tobaccoClass || '');
  const search = tobaccoProductSearch(q);
  if (search.searchRequired) {
    return res.json({ rows: [], page: 1, limit: 50, total: 0, searchRequired: true, filingReady: false });
  }
  const filter: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [search.clause];
  if (tobaccoClass === 'unknown') {
    and.push({
      $or: [{ tobacco_class: 'unknown' }, { tobacco_class: { $exists: false } }, { tobacco_class: null }],
    });
  } else if (['cigarette', 'little_cigar', 'otp', 'non_tobacco'].includes(tobaccoClass)) {
    filter.tobacco_class = tobaccoClass;
  }
  if (and.length) filter.$and = and;
  const page = Math.max(Number(req.query.page || 1) || 1, 1);
  const [rows, total] = await Promise.all([
    Product.find(filter)
      .select('name product_id sku barcode tobacco_class cigarette_pack_size stock_unit packs_per_stock_unit updated_at')
      .sort({ updated_at: -1 })
      .skip((page - 1) * 50)
      .limit(50)
      .lean(),
    Product.countDocuments(filter),
  ]);
  res.json({ rows, page, limit: 50, total, searchRequired: false, filingReady: false });
});

router.post('/tobacco/products/:id/classification', async (req: AuthRequest, res) => {
  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: 'Explicit confirmation is required. Product names are not used to classify tobacco.' });
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Product not found.' });
  const product = await Product.findById(req.params.id)
    .select('name tobacco_class cigarette_pack_size stock_unit packs_per_stock_unit stock_quantity')
    .lean();
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  let parsed;
  try {
    parsed = parseTobaccoComplianceBody(req.body as Record<string, unknown>);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid classification.' });
  }
  if (
    parsed.tobacco_class === undefined &&
    parsed.cigarette_pack_size === undefined &&
    parsed.stock_unit === undefined &&
    parsed.packs_per_stock_unit === undefined
  ) {
    return res.status(400).json({ error: 'Provide the classification fields to change.' });
  }
  const update: Record<string, unknown> = { updated_at: new Date() };
  const unset: Record<string, 1> = {};
  try {
    applyTobaccoComplianceToMongoUpdate(parsed, update, unset, product);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid classification.' });
  }
  const mongoUpdate: Record<string, unknown> = { $set: update };
  if (Object.keys(unset).length) mongoUpdate.$unset = unset;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const updated = await Product.findByIdAndUpdate(product._id, mongoUpdate, { new: true, session });
    if (!updated) throw new Error('Product not found.');
    await writeAuditLogInTransaction(session, {
      action: 'tobacco_classification_changed',
      entityType: 'Product',
      entityId: updated._id,
      adminId: adminId(req),
      before: {
        tobacco_class: product.tobacco_class ?? 'unknown',
        cigarette_pack_size: product.cigarette_pack_size ?? null,
        stock_unit: product.stock_unit ?? null,
        packs_per_stock_unit: product.packs_per_stock_unit ?? null,
      },
      after: {
        tobacco_class: updated.tobacco_class ?? 'unknown',
        cigarette_pack_size: updated.cigarette_pack_size ?? null,
        stock_unit: updated.stock_unit ?? null,
        packs_per_stock_unit: updated.packs_per_stock_unit ?? null,
        stock_quantity_changed: false,
      },
    });
    await session.commitTransaction();
    res.json({
      id: updated._id,
      tobacco_class: updated.tobacco_class,
      cigarette_pack_size: updated.cigarette_pack_size ?? null,
      stock_unit: updated.stock_unit ?? null,
      packs_per_stock_unit: updated.packs_per_stock_unit ?? null,
      stockQuantityChanged: false,
      filingReady: false,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Compliance write rolled back:', error);
    return res.status(500).json({ error: 'The compliance write failed and was rolled back.' });
  } finally {
    session.endSession();
  }
});

router.get('/tobacco/ledger', async (_req, res) => {
  const rows = await TobaccoLedgerEntry.find()
    .select('product_id product_name movement_type movement_date quantity stock_unit packs_per_stock_unit cigarette_pack_size stamp source_type source_number reason affects_physical_stock created_by created_at')
    .sort({ movement_date: -1 })
    .limit(100)
    .lean();
  res.json({ rows: await attachActors(rows, 'created_by', lookupAdminNames), affectsPhysicalStock: false, filingReady: false });
});

router.get('/tobacco/summary', async (_req, res) => {
  const [groups, cigaretteCount] = await Promise.all([
    Product.aggregate<{ _id: string | null; count: number }>([
      { $group: { _id: { $ifNull: ['$tobacco_class', 'unknown'] }, count: { $sum: 1 } } },
    ]),
    Product.countDocuments({
      tobacco_class: 'cigarette',
      $or: [
        { cigarette_pack_size: { $exists: false } },
        { cigarette_pack_size: null },
        { stock_unit: { $exists: false } },
        { stock_unit: null },
        { packs_per_stock_unit: { $exists: false } },
        { packs_per_stock_unit: null },
      ],
    }),
  ]);
  const counts: Record<string, number> = {};
  for (const row of groups) counts[row._id || 'unknown'] = row.count;
  res.json({
    filingReady: false,
    counts,
    cigarettesMissingPackaging: cigaretteCount,
    conditionalReports: TOBACCO_REPORT_GATES,
    officialSources: TOBACCO_OFFICIAL_SOURCES,
  });
});

router.post('/tobacco/movements', async (req: AuthRequest, res) => {
  const productId = String(req.body?.productId || '');
  if (!mongoose.Types.ObjectId.isValid(productId)) return res.status(400).json({ error: 'A product id is required.' });
  const quantity = Number(req.body?.quantity);
  if (!Number.isInteger(quantity) || quantity === 0) {
    return res.status(400).json({ error: 'Quantity must be a non-zero integer. Pack counts are not rounded.' });
  }
  const movementType = String(req.body?.movementType || '');
  const allowed = ['opening', 'receipt', 'sale', 'supplier_return', 'customer_return', 'adjustment', 'other_removal', 'closing'];
  if (!allowed.includes(movementType)) return res.status(400).json({ error: 'Unsupported movement type.' });
  if (!req.body?.reason || String(req.body.reason).trim() === '') {
    return res.status(400).json({ error: 'A reason is required. Stock quantities are not changed.' });
  }
  const product = await Product.findById(productId)
    .select('name tobacco_class cigarette_pack_size stock_unit packs_per_stock_unit')
    .lean();
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  if (product.tobacco_class !== 'cigarette') {
    return res.status(400).json({ error: 'Only an explicit cigarette classification can be snapshotted onto the tobacco ledger.' });
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const [created] = await TobaccoLedgerEntry.create(
      [
        {
          product_id: product._id,
          product_name: product.name,
          movement_type: movementType,
          movement_date: req.body.movementDate ? new Date(req.body.movementDate) : new Date(),
          quantity,
          stock_unit: product.stock_unit,
          packs_per_stock_unit: product.packs_per_stock_unit,
          cigarette_pack_size: product.cigarette_pack_size,
          tobacco_class: product.tobacco_class,
          stamp: req.body.stamp ? String(req.body.stamp) : 'unknown',
          source_type: 'manual_adjustment',
          source_number: req.body.sourceNumber ? String(req.body.sourceNumber) : undefined,
          reason: String(req.body.reason),
          affects_physical_stock: false,
          created_by: adminId(req) ?? undefined,
        },
      ],
      { session }
    );
    await writeAuditLogInTransaction(session, {
      action: 'tobacco_ledger_manual_entry',
      entityType: 'TobaccoLedgerEntry',
      entityId: created._id,
      adminId: adminId(req),
      after: { movement_type: movementType, quantity, affects_physical_stock: false },
    });
    await session.commitTransaction();
    res.status(201).json({ id: created._id, affectsPhysicalStock: false, filingReady: false });
  } catch (error) {
    await session.abortTransaction();
    console.error('Compliance write rolled back:', error);
    return res.status(500).json({ error: 'The compliance write failed and was rolled back.' });
  } finally {
    session.endSession();
  }
});

router.post('/reports/rev-772', async (req: AuthRequest, res) => {
  const period = periodFromBody(req.body);
  if ('error' in period) return res.status(400).json({ error: period.error });
  const rows = await TobaccoLedgerEntry.find({
    movement_date: { $gte: period.start, $lte: period.end },
  })
    .limit(QUERY_LIMIT)
    .lean();
  const preview = buildRev772Preview(rows.map(mapLedger));
  try {
    const saved = await savePreviewReport(req, 'rev_772', period, preview);
    res.status(201).json({ id: saved.id, preview, filingReady: false });
  } catch {
    res.status(500).json({ error: 'The compliance write failed and was rolled back.' });
  }
});

router.post('/reports/rev-777', async (req: AuthRequest, res) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const preview = buildRev777Preview(lines);
  const period = periodFromBody(req.body);
  if ('error' in period) return res.status(400).json({ error: period.error });
  try {
    const saved = await savePreviewReport(req, 'rev_777', period, preview);
    res.status(201).json({ id: saved.id, preview, filingReady: false });
  } catch {
    res.status(500).json({ error: 'The compliance write failed and was rolled back.' });
  }
});

router.post('/reports/:id/transition', async (req: AuthRequest, res) => {
  const report = await ComplianceReport.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  const transition = transitionReportingPeriod(report.status, String(req.body?.status || ''));
  if (!transition.ok) return res.status(409).json({ error: transition.error, blockers: transition.blockers, filingReady: false });
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const before = report.status;
    report.status = transition.status;
    report.filing_ready = false;
    await report.save({ session });
    await writeAuditLogInTransaction(session, {
      action: 'compliance_report_transition',
      entityType: 'ComplianceReport',
      entityId: report._id,
      adminId: adminId(req),
      before: { status: before },
      after: { status: transition.status, filing_ready: false },
    });
    await session.commitTransaction();
    res.json({ id: report._id, status: report.status, filingReady: false });
  } catch (error) {
    await session.abortTransaction();
    console.error('Compliance write rolled back:', error);
    return res.status(500).json({ error: 'The compliance write failed and was rolled back.' });
  } finally {
    session.endSession();
  }
});

router.get('/reports', async (_req, res) => {
  const rows = await ComplianceReport.find()
    .select('report_key status filing_ready period_start period_end blockers created_at created_by')
    .sort({ created_at: -1 })
    .limit(50)
    .lean();
  res.json({ rows: await attachActors(rows, 'created_by', lookupAdminNames), filingReady: false });
});

router.get('/reports/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Report not found.' });
  const report = await ComplianceReport.findById(req.params.id).lean();
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  const history = await AuditLog.find({ entity_type: 'ComplianceReport', entity_id: String(report._id) })
    .select('action old_value new_value created_at admin_id')
    .sort({ created_at: -1 })
    .limit(20)
    .lean();
  const [withActor] = await attachActors([{ ...report, filing_ready: false }], 'created_by', lookupAdminNames);
  res.json({
    report: withActor,
    history: await attachActors(history, 'admin_id', lookupAdminNames),
    filingReady: false,
  });
});

router.get('/tobacco/reconciliation', async (req: AuthRequest, res) => {
  const period = periodQuery(req);
  if ('error' in period) return res.status(400).json({ error: period.error });
  const rows = await TobaccoLedgerEntry.find({ movement_date: { $gte: period.start, $lte: period.end } })
    .limit(QUERY_LIMIT)
    .lean();
  const preview = buildRev772Preview(rows.map(mapLedger));
  res.json({ period: period.label, count: rows.length, preview, filingReady: false });
});

function mapInvoice(doc: {
  _id: unknown;
  invoice_number?: string;
  invoice_type?: unknown;
  source?: unknown;
  tax_amount?: unknown;
  items?: Array<{ taxable?: boolean; tax_exempt?: boolean; subtotal?: unknown; tax_amount?: unknown }>;
}): StoredWholesaleInvoice {
  return {
    id: String(doc._id),
    invoiceNumber: doc.invoice_number,
    invoiceType: doc.invoice_type,
    source: doc.source,
    headerTax: doc.tax_amount,
    lines: (doc.items || []).map((item) => ({
      hasTaxableKey: Object.prototype.hasOwnProperty.call(item, 'taxable'),
      taxable: item.taxable,
      taxExempt: item.tax_exempt === true,
      subtotal: item.subtotal,
      taxAmount: item.tax_amount,
    })),
  };
}

function mapPos(doc: {
  _id: unknown;
  sale_number?: string;
  tax_amount?: unknown;
  items?: Array<{ tax?: unknown; price?: unknown; quantity?: unknown; discount?: unknown }>;
}): StoredPosSale {
  return {
    id: String(doc._id),
    saleNumber: doc.sale_number,
    headerTax: doc.tax_amount,
    lines: doc.items || [],
  };
}

function mapOnline(doc: {
  _id: unknown;
  order_number?: string;
  tax_amount?: unknown;
  items?: Array<{ tax_rate?: unknown; subtotal?: unknown }>;
}): StoredOnlineOrder {
  return {
    id: String(doc._id),
    orderNumber: doc.order_number,
    headerTax: doc.tax_amount,
    lines: (doc.items || []).map((item) => ({ taxRate: item.tax_rate, subtotal: item.subtotal })),
  };
}

function mapLedger(doc: {
  _id: unknown;
  movement_type?: string;
  quantity?: number;
  tobacco_class?: unknown;
  stock_unit?: unknown;
  packs_per_stock_unit?: unknown;
  cigarette_pack_size?: number;
  stamp?: string;
}): TobaccoMovementInput {
  const packSize = doc.cigarette_pack_size === 20 || doc.cigarette_pack_size === 25 ? doc.cigarette_pack_size : null;
  const stamp = doc.stamp === 'pennsylvania' || doc.stamp === 'philadelphia' || doc.stamp === 'other' ? doc.stamp : 'unknown';
  return {
    id: String(doc._id),
    movementType: (doc.movement_type || 'other_removal') as TobaccoMovementInput['movementType'],
    quantity: Number(doc.quantity),
    tobaccoClass: doc.tobacco_class,
    stockUnit: doc.stock_unit,
    packsPerStockUnit: doc.packs_per_stock_unit,
    packSize,
    stamp,
  };
}

function periodFromBody(body: { start?: string; end?: string }): { start: Date; end: Date; startRaw: string; endRaw: string } | { error: string } {
  const startRaw = String(body?.start || '');
  const endRaw = String(body?.end || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(endRaw) || startRaw > endRaw) {
    return { error: 'Provide start and end as YYYY-MM-DD.' };
  }
  return {
    start: new Date(`${startRaw}T00:00:00.000Z`),
    end: new Date(`${endRaw}T23:59:59.999Z`),
    startRaw,
    endRaw,
  };
}

async function savePreviewReport(
  req: AuthRequest,
  reportKey: 'rev_772' | 'rev_777' | 'sales_tax_summary',
  period: { startRaw: string; endRaw: string },
  preview: { blockers: string[]; filingReady: false }
): Promise<{ id: string }> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const [created] = await ComplianceReport.create(
      [
        {
          report_key: reportKey,
          status: 'preview',
          filing_ready: false,
          period_start: period.startRaw,
          period_end: period.endRaw,
          snapshot: preview,
          blockers: preview.blockers,
          created_by: adminId(req) ?? undefined,
        },
      ],
      { session }
    );
    await writeAuditLogInTransaction(session, {
      action: 'compliance_report_preview_created',
      entityType: 'ComplianceReport',
      entityId: created._id,
      adminId: adminId(req),
      after: { report_key: reportKey, status: 'preview', filing_ready: false },
    });
    await session.commitTransaction();
    return { id: String(created._id) };
  } catch (error) {
    await session.abortTransaction();
    console.error('Compliance write rolled back:', error);
    throw error;
  } finally {
    session.endSession();
  }
}

export default router;
