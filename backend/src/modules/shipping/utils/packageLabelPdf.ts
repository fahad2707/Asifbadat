import PDFDocument from 'pdfkit';
import { pdfDocumentToBuffer } from '../../../utils/pdfHelpers';
import {
  LABEL_HEIGHT_PT,
  LABEL_WIDTH_PT,
  LabelPdfError,
  MAX_LABEL_PRODUCTS,
  MAX_QTY_PER_PRODUCT,
  MAX_TOTAL_LABELS,
  normalizeLabelQuantity,
  renderCode128Png,
} from '../../../utils/productLabelPdf';

/** Same warehouse limits as product labels (entries / copies / expanded total). */
export const MAX_LABEL_PACKAGES = MAX_LABEL_PRODUCTS;
export const MAX_QTY_PER_PACKAGE = MAX_QTY_PER_PRODUCT;
export const MAX_TOTAL_PACKAGE_LABELS = MAX_TOTAL_LABELS;

export { LabelPdfError, LABEL_WIDTH_PT, LABEL_HEIGHT_PT };

export type PackageLabelRequestItem = {
  package_id: string;
  quantity: number;
};

export type PackageLabelInput = {
  id: string;
  package_code: string;
  shipment_number?: string | null;
};

export type ResolvedPackageLabel = {
  id: string;
  package_code: string;
  shipment_number: string;
  quantity: number;
};

/**
 * Validate POST /api/packages/labels/pdf body items.
 * Shape: `{ items: [{ package_id, quantity }] }`
 * Duplicate package_id values are rejected (no silent dedupe).
 */
export function validatePackageLabelRequestItems(items: unknown): PackageLabelRequestItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new LabelPdfError(400, 'Select at least one package');
  }
  if (items.length > MAX_LABEL_PACKAGES) {
    throw new LabelPdfError(400, `At most ${MAX_LABEL_PACKAGES} packages per print job`);
  }

  const seen = new Set<string>();
  const normalized: PackageLabelRequestItem[] = [];
  let total = 0;

  for (const row of items) {
    const package_id = String((row as { package_id?: unknown })?.package_id ?? '').trim();
    if (!package_id) throw new LabelPdfError(400, 'Each item requires package_id');
    if (seen.has(package_id)) {
      throw new LabelPdfError(400, `Duplicate package_id: ${package_id}`);
    }
    seen.add(package_id);

    const quantity = normalizeLabelQuantity((row as { quantity?: unknown })?.quantity);
    if (quantity > MAX_QTY_PER_PACKAGE) {
      throw new LabelPdfError(400, `Quantity per package cannot exceed ${MAX_QTY_PER_PACKAGE}`);
    }
    total += quantity;
    if (total > MAX_TOTAL_PACKAGE_LABELS) {
      throw new LabelPdfError(400, `Total labels cannot exceed ${MAX_TOTAL_PACKAGE_LABELS}`);
    }
    normalized.push({ package_id, quantity });
  }

  return normalized;
}

export function resolveLabelsFromPackages(
  requestItems: PackageLabelRequestItem[],
  packagesById: Map<string, PackageLabelInput>
): ResolvedPackageLabel[] {
  const resolved: ResolvedPackageLabel[] = [];
  for (const item of requestItems) {
    const pkg = packagesById.get(item.package_id);
    if (!pkg) {
      throw new LabelPdfError(404, `Package not found: ${item.package_id}`);
    }
    const package_code = String(pkg.package_code ?? '').trim();
    if (!package_code) {
      throw new LabelPdfError(400, `Package ${pkg.id} has no package_code`);
    }
    resolved.push({
      id: String(pkg.id),
      package_code,
      shipment_number: String(pkg.shipment_number ?? '').trim(),
      quantity: item.quantity,
    });
  }
  return resolved;
}

/**
 * Build 2×1" package labels. Barcode payload is the stored package_code exactly.
 * Does not invent codes from shipment_number or Product SKU.
 */
export async function buildPackageLabelsPdf(labels: ResolvedPackageLabel[]): Promise<{
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
    const code = label.package_code.trim();
    if (!code) {
      throw new LabelPdfError(400, `Package ${label.id} has no package_code`);
    }
    const { png, payload } = await renderCode128Png(code);
    if (payload !== code) {
      throw new LabelPdfError(500, 'Barcode payload does not match package_code');
    }

    for (let i = 0; i < label.quantity; i++) {
      doc.addPage({ size: [LABEL_WIDTH_PT, LABEL_HEIGHT_PT], margin: 0 });
      const pad = 6;

      const title = label.shipment_number ? `Pkg · ${label.shipment_number}` : 'Package';
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(7);
      doc.text(title, pad, pad, { width: LABEL_WIDTH_PT - pad * 2, height: 14, ellipsis: true });

      const barcodeW = LABEL_WIDTH_PT - pad * 2;
      const barcodeH = 30;
      const barcodeY = 20;
      doc.image(png, pad, barcodeY, { fit: [barcodeW, barcodeH], align: 'center' });

      doc.fillColor('#111827').font('Helvetica').fontSize(7);
      doc.text(payload, pad, barcodeY + barcodeH + 2, {
        width: LABEL_WIDTH_PT - pad * 2,
        align: 'center',
        lineBreak: false,
        ellipsis: true,
      });

      encodedPayloads.push(payload);
      labelCount += 1;
    }
  }

  doc.end();
  const buffer = await done;
  return { buffer, labelCount, encodedPayloads };
}
