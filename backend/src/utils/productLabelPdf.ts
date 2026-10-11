import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import { pdfDocumentToBuffer } from './pdfHelpers';
import { isBlankSku } from './productCodes';

/** Physical label size (warehouse default). PDFKit uses 72 pt/inch. */
export const LABEL_WIDTH_IN = 2;
export const LABEL_HEIGHT_IN = 1;
export const LABEL_WIDTH_PT = LABEL_WIDTH_IN * 72;
export const LABEL_HEIGHT_PT = LABEL_HEIGHT_IN * 72;

export const MAX_LABEL_PRODUCTS = 50;
export const MAX_QTY_PER_PRODUCT = 50;
export const MAX_TOTAL_LABELS = 200;

export class LabelPdfError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'LabelPdfError';
  }
}

export type LabelProductInput = {
  id: string;
  name?: string | null;
  sku?: string | null;
  product_id?: string | null;
};

export type LabelRequestItem = {
  product_id: string;
  quantity: number;
};

export type ResolvedLabel = {
  id: string;
  name: string;
  sku: string;
  product_id: string;
  quantity: number;
};

/** Canonical printable code: non-empty stored sku only (never invent UPC/EAN/GTIN). */
export function resolvePrintableSku(product: LabelProductInput): string {
  const sku = String(product.sku ?? '').trim();
  if (!sku) {
    throw new LabelPdfError(
      400,
      `Product ${product.id} has no SKU. Generate an internal SKU (EDI-<product ID>) first, or enter a manufacturer SKU.`
    );
  }
  return sku;
}

export function normalizeLabelQuantity(raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    if (Number.isInteger(n) && n > 0) return n;
  }
  throw new LabelPdfError(400, 'Label quantity must be a positive integer');
}

export function validateLabelRequestItems(items: unknown): LabelRequestItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new LabelPdfError(400, 'Select at least one product');
  }
  if (items.length > MAX_LABEL_PRODUCTS) {
    throw new LabelPdfError(400, `At most ${MAX_LABEL_PRODUCTS} products per print job`);
  }

  const normalized: LabelRequestItem[] = [];
  let total = 0;
  for (const row of items) {
    const product_id = String((row as { product_id?: unknown })?.product_id ?? '').trim();
    if (!product_id) throw new LabelPdfError(400, 'Each item requires product_id');
    const quantity = normalizeLabelQuantity((row as { quantity?: unknown })?.quantity);
    if (quantity > MAX_QTY_PER_PRODUCT) {
      throw new LabelPdfError(400, `Quantity per product cannot exceed ${MAX_QTY_PER_PRODUCT}`);
    }
    total += quantity;
    if (total > MAX_TOTAL_LABELS) {
      throw new LabelPdfError(400, `Total labels cannot exceed ${MAX_TOTAL_LABELS}`);
    }
    normalized.push({ product_id, quantity });
  }
  return normalized;
}

/**
 * Render a real Code 128 barcode PNG encoding `text` exactly.
 * Returns the payload that was encoded (must match human-readable SKU on the label).
 */
export async function renderCode128Png(text: string): Promise<{ png: Buffer; payload: string }> {
  const payload = String(text ?? '').trim();
  if (!payload) {
    throw new LabelPdfError(400, 'Cannot encode an empty barcode payload');
  }
  if (payload.length > 64) {
    throw new LabelPdfError(400, 'SKU is too long for a warehouse label barcode');
  }
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: payload,
      scale: 2,
      height: 8,
      includetext: false,
      paddingwidth: 2,
      paddingheight: 1,
    });
    return { png: Buffer.from(png), payload };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Barcode encoding failed';
    throw new LabelPdfError(400, `Barcode generation failed for "${payload}": ${msg}`);
  }
}

function truncateName(name: string, maxChars: number): string {
  const t = name.trim() || 'Unnamed product';
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(1, maxChars - 1))}…`;
}

export async function buildProductLabelsPdf(labels: ResolvedLabel[]): Promise<{
  buffer: Buffer;
  labelCount: number;
  encodedPayloads: string[];
}> {
  if (!labels.length) {
    throw new LabelPdfError(400, 'No labels to print');
  }

  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
    size: [LABEL_WIDTH_PT, LABEL_HEIGHT_PT],
  });
  const done = pdfDocumentToBuffer(doc);
  const encodedPayloads: string[] = [];
  let labelCount = 0;

  for (const label of labels) {
    if (isBlankSku(label.sku)) {
      throw new LabelPdfError(400, `Product ${label.id} has no SKU`);
    }
    const { png, payload } = await renderCode128Png(label.sku);
    if (payload !== label.sku.trim()) {
      throw new LabelPdfError(500, 'Barcode payload does not match SKU');
    }

    for (let i = 0; i < label.quantity; i++) {
      doc.addPage({ size: [LABEL_WIDTH_PT, LABEL_HEIGHT_PT], margin: 0 });
      const pad = 6;
      const name = truncateName(label.name || 'Unnamed product', 42);
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(7);
      doc.text(name, pad, pad, { width: LABEL_WIDTH_PT - pad * 2, height: 16, ellipsis: true });

      const barcodeW = LABEL_WIDTH_PT - pad * 2;
      const barcodeH = 28;
      const barcodeY = 22;
      doc.image(png, pad, barcodeY, { fit: [barcodeW, barcodeH], align: 'center' });

      doc.fillColor('#111827').font('Helvetica').fontSize(7);
      doc.text(payload, pad, barcodeY + barcodeH + 2, {
        width: LABEL_WIDTH_PT - pad * 2,
        align: 'center',
        lineBreak: false,
        ellipsis: true,
      });

      const pid = String(label.product_id || '').trim();
      if (pid) {
        doc.fillColor('#6b7280').font('Helvetica').fontSize(5.5);
        doc.text(`ID ${pid}`, pad, LABEL_HEIGHT_PT - 10, {
          width: LABEL_WIDTH_PT - pad * 2,
          align: 'center',
        });
      }

      encodedPayloads.push(payload);
      labelCount += 1;
    }
  }

  doc.end();
  const buffer = await done;
  return { buffer, labelCount, encodedPayloads };
}

export function resolveLabelsFromProducts(
  requestItems: LabelRequestItem[],
  productsById: Map<string, LabelProductInput>
): ResolvedLabel[] {
  const resolved: ResolvedLabel[] = [];
  for (const item of requestItems) {
    const product = productsById.get(item.product_id);
    if (!product) {
      throw new LabelPdfError(404, `Product not found: ${item.product_id}`);
    }
    const sku = resolvePrintableSku(product);
    resolved.push({
      id: String(product.id),
      name: String(product.name ?? '').trim() || 'Unnamed product',
      sku,
      product_id: String(product.product_id ?? '').trim(),
      quantity: item.quantity,
    });
  }
  return resolved;
}
