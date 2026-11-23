import PDFDocument from 'pdfkit';
import { renderCode128Png } from './productLabelPdf';
import {
  PDF_MARGIN,
  PDF_PAGE,
  PDF_CONTENT_WIDTH,
  CompanyInfo,
  loadCompanyInfo,
  pdfDocumentToBuffer,
} from './pdfHelpers';
import { summarizeInvoiceTaxes, taxMarkFromName } from './invoiceTaxDisplay';

export type InvoicePdfItem = {
  product_id?: string;
  product_name?: string;
  quantity?: number;
  price?: number;
  subtotal?: number;
  sku?: string;
  taxable?: boolean;
  tax_type_name?: string | null;
  tax_type_label?: string | null;
  tax_amount?: number;
};

export type InvoicePdfData = {
  invoice_number: string;
  invoice_date?: Date | string;
  created_at?: Date | string;
  due_date?: Date | string;
  terms?: string;
  payment_method?: string;
  shipping_type?: string;
  invoice_type?: string;
  document_kind?: 'invoice' | 'quotation' | 'credit_memo' | 'purchase_order';
  party_heading?: string;
  reference_label?: string;
  customer_name?: string;
  customer_company?: string;
  customer_address?: string;
  customer_phone?: string;
  customer_email?: string;
  discount_amount?: number;
  tax_amount?: number;
  adjustment?: number;
  total_amount?: number;
  amount_paid?: number;
  subtotal_amount?: number;
};

const INK = '#1A1A1A';
const MUTED = '#6B6C72';
const LINE = '#D9DADF';
const WASH = '#F6F7F8';
const LEFT = PDF_MARGIN;
const RIGHT = PDF_PAGE.width - PDF_MARGIN;

function fmtDate(d?: Date | string | null): string {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function cleanMeta(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  if (raw === 'rejected') return 'Rejected';
  if (raw.startsWith('converted:')) return 'Converted';
  return raw;
}

function blockHeight(doc: PDFKit.PDFDocument, lines: string[], width: number, size: number, gap: number): number {
  doc.font('Helvetica').fontSize(size);
  return lines.reduce((sum, line, index) => {
    const height = doc.heightOfString(line, { width });
    return sum + height + (index < lines.length - 1 ? gap : 0);
  }, 0);
}

export async function buildInvoicePdfBuffer(
  invoice: InvoicePdfData,
  items: InvoicePdfItem[],
  idMap: Record<string, string> = {}
): Promise<Buffer> {
  const company = await loadCompanyInfo();
  const doc = new PDFDocument({ margin: PDF_MARGIN, size: 'A4', bufferPages: true });
  const bufferPromise = pdfDocumentToBuffer(doc);
  const number = String(invoice.invoice_number || '').trim();
  const kind = invoice.document_kind || (invoice.invoice_type === 'quotation' ? 'quotation' : 'invoice');
  const title = kind === 'credit_memo' ? 'CREDIT MEMO' : kind === 'quotation' ? 'QUOTATION' : kind === 'purchase_order' ? 'PURCHASE ORDER' : 'INVOICE';

  let barcode: Buffer | null = null;
  if (number) {
    try {
      barcode = (await renderCode128Png(number)).png;
    } catch {
      barcode = null;
    }
  }

  let y = drawLetterhead(doc, company, title, number, barcode);
  y = drawParties(doc, invoice, company, y);
  y = drawItems(doc, invoice, items, idMap, y, kind);
  drawFooter(doc, company);

  doc.end();
  return bufferPromise;
}

function drawLetterhead(
  doc: PDFKit.PDFDocument,
  company: CompanyInfo,
  title: string,
  number: string,
  barcode: Buffer | null
): number {
  const identityW = 280;
  let y = PDF_MARGIN;

  if (company.logoPath) {
    try {
      doc.image(company.logoPath, LEFT, y, { fit: [92, 36] });
      y += 42;
    } catch {
      /* a missing logo should not break the document */
    }
  }

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15);
  doc.text(company.name, LEFT, y, { width: identityW });
  y = doc.y + 4;
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  for (const line of [company.address, company.cityLine, company.phone, company.email, company.website].filter(Boolean)) {
    doc.text(line, LEFT, y, { width: identityW });
    y = doc.y + 1;
  }
  const leftBottom = y;

  const blockW = 190;
  const blockX = RIGHT - blockW;
  let rightY = PDF_MARGIN;
  doc.fillColor(MUTED).font('Helvetica').fontSize(9);
  doc.text(title, blockX, rightY, { width: blockW, align: 'right', characterSpacing: 1.4 });
  rightY = doc.y + 2;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13);
  doc.text(number || '—', blockX, rightY, { width: blockW, align: 'right' });
  rightY = doc.y + 6;
  if (barcode) {
    const barcodeW = 168;
    const barcodeH = 38;
    doc.image(barcode, blockX + (blockW - barcodeW), rightY, { fit: [barcodeW, barcodeH] });
    rightY += barcodeH + 3;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
    doc.text(number, blockX, rightY, { width: blockW, align: 'right' });
    rightY = doc.y;
  }

  const ruleY = Math.max(leftBottom, rightY) + 12;
  doc.strokeColor(INK).lineWidth(1.25);
  doc.moveTo(LEFT, ruleY).lineTo(RIGHT, ruleY).stroke();
  return ruleY + 16;
}

function drawParties(doc: PDFKit.PDFDocument, invoice: InvoicePdfData, _company: CompanyInfo, top: number): number {
  const gap = 16;
  const colW = (PDF_CONTENT_WIDTH - gap) / 2;
  const rightX = LEFT + colW + gap;
  const billLines = [
    invoice.customer_name || '—',
    invoice.customer_company || '',
    invoice.customer_address || '',
    invoice.customer_phone ? `Tel ${invoice.customer_phone}` : '',
    invoice.customer_email || '',
  ].filter(Boolean);
  const details: [string, string][] = invoice.document_kind === 'credit_memo'
    ? [
      ['Date', fmtDate(invoice.invoice_date || invoice.created_at)],
      [invoice.reference_label || 'Invoice', cleanMeta(invoice.shipping_type)],
      ['Reason', cleanMeta(invoice.terms)],
      ['Status', cleanMeta(invoice.payment_method)],
    ]
    : invoice.document_kind === 'purchase_order'
      ? [
        ['Date', fmtDate(invoice.invoice_date || invoice.created_at)],
        ['Expected', fmtDate(invoice.due_date)],
        ['Status', cleanMeta(invoice.terms)],
        ['Payment', cleanMeta(invoice.payment_method)],
      ]
      : [
        ['Date', fmtDate(invoice.invoice_date || invoice.created_at)],
        ['Due', fmtDate(invoice.due_date)],
        ['Terms', cleanMeta(invoice.terms || (invoice.payment_method === 'cash' ? 'C.O.D. — Cash' : invoice.payment_method))],
        ['Ship via', cleanMeta(invoice.shipping_type)],
      ];

  doc.font('Helvetica').fontSize(9);
  const valueW = colW - 88;
  const detailHeights = details.map(([, value]) => Math.max(16, doc.heightOfString(value, { width: valueW }) + 4));
  const billBody = blockHeight(doc, billLines, colW - 24, 9, 3);
  const detailBody = detailHeights.reduce((sum, height) => sum + height, 0);
  const boxH = Math.max(78, 28 + billBody, 28 + detailBody);

  doc.fillColor(WASH).rect(LEFT, top, colW, boxH).fill();
  doc.fillColor(WASH).rect(rightX, top, colW, boxH).fill();

  doc.fillColor(MUTED).font('Helvetica').fontSize(8);
  doc.text(invoice.party_heading || (invoice.document_kind === 'purchase_order' ? 'VENDOR' : 'BILL TO'), LEFT + 12, top + 10, { width: colW - 24 });
  let by = top + 24;
  billLines.forEach((line, index) => {
    doc.font(index === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(index === 0 ? 11 : 9).fillColor(index === 0 ? INK : MUTED);
    doc.text(line, LEFT + 12, by, { width: colW - 24 });
    by = doc.y + 2;
  });

  doc.fillColor(MUTED).font('Helvetica').fontSize(8);
  doc.text('DETAILS', rightX + 12, top + 10, { width: colW - 24 });
  let detailY = top + 26;
  details.forEach(([label, value], index) => {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text(label, rightX + 12, detailY, { width: 58 });
    doc.font('Helvetica').fillColor(INK);
    doc.text(value, rightX + 74, detailY, { width: valueW, align: 'right' });
    detailY += detailHeights[index];
  });

  return top + boxH + 22;
}

function drawItems(
  doc: PDFKit.PDFDocument,
  invoice: InvoicePdfData,
  items: InvoicePdfItem[],
  idMap: Record<string, string>,
  startY: number,
  kind: 'invoice' | 'quotation' | 'credit_memo' | 'purchase_order'
): number {
  const qtyW = 40;
  const unitW = 70;
  const taxW = 52;
  const amountW = 84;
  const descW = PDF_CONTENT_WIDTH - qtyW - unitW - taxW - amountW;
  const qtyX = LEFT + descW;
  const unitX = qtyX + qtyW;
  const taxX = unitX + unitW;
  const amountX = taxX + taxW;
  let y = startY;

  const drawHeader = () => {
    doc.fillColor(INK).rect(LEFT, y, PDF_CONTENT_WIDTH, 22).fill();
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
    doc.text('DESCRIPTION', LEFT + 8, y + 7, { width: descW - 16 });
    doc.text('QTY', qtyX, y + 7, { width: qtyW - 8, align: 'right' });
    doc.text(kind === 'purchase_order' ? 'UNIT COST' : 'UNIT PRICE', unitX, y + 7, { width: unitW - 8, align: 'right' });
    doc.text('TAX', taxX, y + 7, { width: taxW - 8, align: 'right' });
    doc.text('AMOUNT', amountX, y + 7, { width: amountW - 8, align: 'right' });
    y += 22;
  };

  drawHeader();

  const rows = items.length ? items : [];
  rows.forEach((item, index) => {
    const name = item.product_name || 'Product';
    const pid = item.product_id ? String(item.product_id) : '';
    const productCode = idMap[pid] || item.sku || '';
    doc.font('Helvetica').fontSize(9);
    const nameH = doc.heightOfString(name, { width: descW - 16 });
    const rowH = Math.max(28, nameH + (productCode ? 16 : 8) + 10);
    if (y + rowH > PDF_PAGE.height - PDF_MARGIN - 150) {
      doc.addPage();
      y = PDF_MARGIN;
      drawHeader();
    }
    if (index % 2 === 1) doc.fillColor(WASH).rect(LEFT, y, PDF_CONTENT_WIDTH, rowH).fill();
    doc.fillColor(INK).font('Helvetica').fontSize(9);
    doc.text(name, LEFT + 8, y + 7, { width: descW - 16 });
    if (productCode) {
      doc.fillColor(MUTED).fontSize(7.5);
      doc.text(productCode, LEFT + 8, y + 8 + nameH, { width: descW - 16 });
    }
    const qty = item.quantity ?? 0;
    const unit = Number(item.price ?? 0);
    const lineTotal = Number(item.subtotal ?? qty * unit);
    const mark = kind === 'purchase_order' ? '' : taxMarkFromName(item.tax_type_name || item.tax_type_label, item.taxable);
    const taxLabel = kind === 'purchase_order' ? '—' : mark || '—';
    doc.fillColor(INK).font('Helvetica').fontSize(9);
    doc.text(String(qty), qtyX, y + 7, { width: qtyW - 8, align: 'right' });
    doc.text(unit.toFixed(2), unitX, y + 7, { width: unitW - 8, align: 'right' });
    doc.text(taxLabel, taxX, y + 7, { width: taxW - 8, align: 'right' });
    const markW = mark ? 16 : 0;
    doc.text(lineTotal.toFixed(2), amountX, y + 7, { width: amountW - 8 - markW, align: 'right' });
    if (mark) {
      doc.fontSize(6.5).fillColor(MUTED);
      doc.text(mark, amountX + amountW - 8 - markW, y + 4, { width: markW, align: 'left' });
      doc.fillColor(INK).fontSize(9);
    }
    doc.strokeColor(LINE).lineWidth(0.4);
    doc.moveTo(LEFT, y + rowH).lineTo(RIGHT, y + rowH).stroke();
    y += rowH;
  });

  if (!rows.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9);
    doc.text('No line items.', LEFT + 8, y + 10);
    y += 32;
  }

  y += 16;
  const itemTotal = items.reduce((sum, item) => sum + Number(item.subtotal ?? 0), 0);
  const taxAmount = Number(invoice.tax_amount ?? 0);
  const adjustment = Number(invoice.adjustment ?? 0);
  const discount = Number(invoice.discount_amount ?? 0);
  const grandTotal = Number(invoice.total_amount ?? itemTotal + taxAmount + adjustment - discount);
  const paid = Number(invoice.amount_paid ?? 0);
  const balance = Math.round((grandTotal - paid) * 100) / 100;
  const isQuote = kind === 'quotation';
  const isCredit = kind === 'credit_memo';
  const taxGroups = kind === 'purchase_order' ? [] : summarizeInvoiceTaxes(items);
  const summary: [string, string, boolean?][] = [['Subtotal', fmtMoney(itemTotal)]];
  if (discount > 0) summary.push(['Discount', fmtMoney(-discount)]);
  if (isCredit && taxAmount === 0) {
    summary.push(['Tax (non-refundable)', fmtMoney(0)]);
  } else if (taxGroups.length) {
    for (const group of taxGroups) {
      const label = isQuote
        ? `${group.mark || group.name} (est.)`
        : group.mark && group.mark !== group.name
          ? `${group.mark} · ${group.name}`
          : group.mark || group.name;
      summary.push([label, fmtMoney(group.amount)]);
    }
    const grouped = taxGroups.reduce((sum, group) => sum + group.amount, 0);
    const extra = Math.round((taxAmount - grouped) * 100) / 100;
    if (extra > 0) summary.push([isQuote ? 'Other estimated tax' : 'Other tax', fmtMoney(extra)]);
  } else {
    summary.push([isQuote ? 'Estimated tax' : 'Tax', fmtMoney(taxAmount)]);
  }
  if (adjustment !== 0) summary.push(['Adjustment', fmtMoney(adjustment)]);
  summary.push([isCredit ? 'Credit' : 'Total', fmtMoney(grandTotal), true]);
  if (!isQuote && !isCredit) {
    summary.push(['Amount paid', fmtMoney(paid)]);
    summary.push(['Balance due', fmtMoney(balance), true]);
  }

  const boxW = 230;
  const boxX = RIGHT - boxW;
  const boxH = 12 + summary.length * 18;
  if (y + boxH > PDF_PAGE.height - PDF_MARGIN - 36) {
    doc.addPage();
    y = PDF_MARGIN;
  }
  summary.forEach(([label, value, strong], index) => {
    const rowY = y + index * 18;
    const last = index === summary.length - 1;
    if (last) {
      doc.fillColor(INK).rect(boxX, rowY - 4, boxW, 22).fill();
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);
    } else {
      doc.fillColor(strong ? INK : MUTED).font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    }
    doc.text(label, boxX + 10, rowY, { width: 100 });
    doc.text(value, boxX + 110, rowY, { width: boxW - 122, align: 'right' });
  });
  return y + boxH;
}

function drawFooter(doc: PDFKit.PDFDocument, company: CompanyInfo) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const previous = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PDF_PAGE.height - 32;
    doc.strokeColor(LINE).lineWidth(0.5);
    doc.moveTo(LEFT, y - 8).lineTo(RIGHT, y - 8).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(8);
    doc.text(`${company.name}  ·  Thank you for your business`, LEFT, y, { width: PDF_CONTENT_WIDTH - 60, lineBreak: false });
    doc.text(`${i + 1} / ${range.count}`, RIGHT - 50, y, { width: 50, align: 'right', lineBreak: false });
    doc.page.margins.bottom = previous;
  }
}
