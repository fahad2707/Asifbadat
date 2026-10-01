import PDFDocument from 'pdfkit';
import {
  PDF_MARGIN,
  PDF_PAGE,
  PDF_CONTENT_WIDTH,
  PDF_TEAL,
  PDF_GRAY,
  PDF_MUTED,
  PDF_BORDER,
  PDF_LIGHT,
  CompanyInfo,
  loadCompanyInfo,
  pdfDocumentToBuffer,
  drawCompanyHeader,
} from './pdfHelpers';

export type InvoicePdfItem = {
  product_id?: string;
  product_name?: string;
  quantity?: number;
  price?: number;
  subtotal?: number;
  sku?: string;
  taxable?: boolean;
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
  customer_name?: string;
  customer_address?: string;
  customer_phone?: string;
  customer_email?: string;
  discount_amount?: number;
  tax_amount?: number;
  adjustment?: number;
  total_amount?: number;
  subtotal_amount?: number;
};

function fmtDate(d?: Date | string | null): string {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

export async function buildInvoicePdfBuffer(
  invoice: InvoicePdfData,
  items: InvoicePdfItem[],
  idMap: Record<string, string> = {}
): Promise<Buffer> {
  const company = await loadCompanyInfo();
  const doc = new PDFDocument({ margin: PDF_MARGIN, size: 'A4', bufferPages: true });
  const bufferPromise = pdfDocumentToBuffer(doc);

  const invDate = invoice.invoice_date || invoice.created_at;
  const docLabel = invoice.invoice_type === 'quotation' ? 'QUOTATION' : 'INVOICE';
  let y = drawCompanyHeader(doc, company, {
    rightTitle: docLabel,
    rightSubtitle: invoice.invoice_number || '',
  });

  const colW = (PDF_CONTENT_WIDTH - 24) / 2;
  const leftX = PDF_MARGIN;
  const rightX = PDF_MARGIN + colW + 24;
  const boxTop = y;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_TEAL);
  doc.text('FROM', leftX, boxTop);
  doc.font('Helvetica').fontSize(10).fillColor(PDF_GRAY);
  let ly = boxTop + 14;
  doc.text(company.name, leftX, ly, { width: colW });
  ly += 14;
  doc.fontSize(9).fillColor(PDF_MUTED);
  doc.text(company.address, leftX, ly, { width: colW });
  ly += 11;
  doc.text(company.cityLine, leftX, ly, { width: colW });
  ly += 11;
  doc.text(`Tel: ${company.phone}`, leftX, ly, { width: colW });
  ly += 11;
  doc.text(company.email, leftX, ly, { width: colW });

  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_TEAL);
  doc.text('BILL TO', rightX, boxTop);
  doc.font('Helvetica').fontSize(10).fillColor(PDF_GRAY);
  let ry = boxTop + 14;
  const billName = invoice.customer_name || '—';
  doc.text(billName, rightX, ry, { width: colW });
  ry += 14;
  doc.fontSize(9).fillColor(PDF_MUTED);
  if (invoice.customer_address) {
    doc.text(invoice.customer_address, rightX, ry, { width: colW });
    ry += 11;
  }
  if (invoice.customer_phone) {
    doc.text(`Tel: ${invoice.customer_phone}`, rightX, ry, { width: colW });
    ry += 11;
  }
  if (invoice.customer_email) {
    doc.text(invoice.customer_email, rightX, ry, { width: colW });
    ry += 11;
  }

  y = Math.max(ly, ry) + 20;

  const metaY = y;
  doc.font('Helvetica').fontSize(9).fillColor(PDF_MUTED);
  const metaLines = [
    ['Document #', invoice.invoice_number || '—'],
    ['Date', fmtDate(invDate)],
    ['Due date', fmtDate(invoice.due_date)],
    ['Terms', invoice.terms || (invoice.payment_method === 'cash' ? 'C.O.D. — Cash' : invoice.payment_method || '—')],
    ['Shipping', invoice.shipping_type || 'Ground'],
  ];
  metaLines.forEach(([label, val], i) => {
    doc.font('Helvetica-Bold').fillColor(PDF_GRAY).text(`${label}:`, leftX, metaY + i * 13, { continued: true, width: 72 });
    doc.font('Helvetica').fillColor('#000000').text(` ${val}`, { width: colW });
  });

  y = metaY + metaLines.length * 13 + 18;
  doc.strokeColor(PDF_BORDER).lineWidth(0.5);
  doc.moveTo(PDF_MARGIN, y).lineTo(PDF_PAGE.width - PDF_MARGIN, y).stroke();
  y += 14;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(PDF_GRAY);
  doc.text('Line items', PDF_MARGIN, y);
  y += 16;

  const tableW = PDF_CONTENT_WIDTH;
  const rowH = 22;
  const col = {
    qty: PDF_MARGIN,
    id: PDF_MARGIN + 36,
    name: PDF_MARGIN + 96,
    unit: PDF_PAGE.width - PDF_MARGIN - 120,
    amount: PDF_PAGE.width - PDF_MARGIN - 58,
  };

  doc.fillColor(PDF_TEAL);
  doc.rect(PDF_MARGIN, y, tableW, rowH).fill();
  doc.fillColor('#ffffff');
  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('QTY', col.qty + 6, y + 7);
  doc.text('PRODUCT ID', col.id, y + 7);
  doc.text('DESCRIPTION', col.name, y + 7);
  doc.text('UNIT PRICE', col.unit, y + 7, { width: 52, align: 'right' });
  doc.text('AMOUNT', col.amount, y + 7, { width: 52, align: 'right' });
  y += rowH;

  doc.fillColor('#000000').font('Helvetica').fontSize(8);
  items.forEach((item, idx) => {
    if (y > PDF_PAGE.height - PDF_MARGIN - 120) {
      doc.addPage();
      y = PDF_MARGIN;
    }
    if (idx % 2 === 1) {
      doc.fillColor(PDF_LIGHT).rect(PDF_MARGIN, y, tableW, rowH).fill();
    }
    doc.fillColor('#000000');
    const pid = item.product_id ? String(item.product_id) : '';
    const productId = idMap[pid] || item.sku || '—';
    const name = item.product_name || 'Product';
    const qty = item.quantity ?? 0;
    const unit = parseFloat(String(item.price ?? 0));
    const lineTotal = parseFloat(String(item.subtotal ?? qty * unit));

    doc.text(String(qty), col.qty + 6, y + 7);
    doc.text(String(productId).slice(0, 12), col.id, y + 7, { width: 54 });
    doc.text(name, col.name, y + 7, { width: col.unit - col.name - 8 });
    const unitLabel = item.taxable === true ? `${unit.toFixed(2)} T` : unit.toFixed(2);
    doc.text(unitLabel, col.unit, y + 7, { width: 52, align: 'right' });
    doc.text(lineTotal.toFixed(2), col.amount, y + 7, { width: 52, align: 'right' });
    y += rowH;
  });

  y += 12;
  const itemTotal = items.reduce((s, i) => s + parseFloat(String(i.subtotal ?? 0)), 0);
  const taxAmount = Number(invoice.tax_amount ?? 0);
  const adjustment = Number(invoice.adjustment ?? 0);
  const discount = Number(invoice.discount_amount ?? 0);
  const grandTotal = Number(invoice.total_amount ?? itemTotal + taxAmount + adjustment - discount);

  const sumX = PDF_PAGE.width - PDF_MARGIN - 200;
  const sumW = 200;
  doc.fillColor('#f0fdfa');
  doc.rect(sumX, y, sumW, 88).fill();
  doc.strokeColor(PDF_TEAL).lineWidth(1);
  doc.rect(sumX, y, sumW, 88).stroke();

  let sy = y + 10;
  const sumRow = (label: string, val: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? PDF_TEAL : PDF_MUTED);
    doc.text(label, sumX + 12, sy, { width: 90, align: 'left' });
    doc.fillColor('#000000').text(val, sumX + 100, sy, { width: 88, align: 'right' });
    sy += bold ? 18 : 14;
  };

  sumRow('Subtotal', fmtMoney(itemTotal));
  if (discount > 0) sumRow('Discount', `-${discount.toFixed(2)}`);
  sumRow('Tax', fmtMoney(taxAmount));
  if (adjustment !== 0) sumRow('Adjustment', fmtMoney(adjustment));
  sumRow('Total due', fmtMoney(grandTotal), true);

  doc.fontSize(8).fillColor(PDF_MUTED);
  doc.text(
    'Thank you for your business. Questions? Contact us at the address above.',
    PDF_MARGIN,
    PDF_PAGE.height - PDF_MARGIN - 24,
    { width: PDF_CONTENT_WIDTH, align: 'center' }
  );

  doc.end();
  return bufferPromise;
}
