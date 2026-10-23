import express from 'express';
import mongoose from 'mongoose';
import { authenticateAdmin, AuthRequest } from '../../../middleware/auth';
import { sendPdfResponse } from '../../../utils/pdfHelpers';
import ShipmentPackage from '../models/ShipmentPackage';
import {
  PackageServiceError,
  getPackageByCode,
} from '../services/shipmentPackageService';
import {
  LabelPdfError,
  buildPackageLabelsPdf,
  resolveLabelsFromPackages,
  validatePackageLabelRequestItems,
} from '../utils/packageLabelPdf';

const router = express.Router();

function markStaffPrivate(res: express.Response) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Vary', 'Authorization');
}

function handlePackageError(res: express.Response, e: unknown, logLabel: string) {
  if (e instanceof PackageServiceError) {
    return res.status(e.status).json({ error: e.message });
  }
  console.error(logLabel, e);
  return res.status(500).json({ error: 'Failed to look up package' });
}

/**
 * POST /api/packages/labels/pdf
 * Admin-only: print 2×1" Code 128 labels for existing packages.
 * Body: { items: [{ package_id: string, quantity: number }] }
 * Registered before /by-code/:code so "labels" is not captured as a code.
 */
router.post('/labels/pdf', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    markStaffPrivate(res);
    const items = validatePackageLabelRequestItems(req.body?.items);
    const ids = items.map((i) => i.package_id);
    for (const id of ids) {
      if (!mongoose.isValidObjectId(id)) {
        throw new LabelPdfError(400, `Invalid package id: ${id}`);
      }
    }

    const docs = await ShipmentPackage.find({ _id: { $in: ids } })
      .select('_id package_code shipment_number')
      .lean();

    const byId = new Map(
      (
        docs as {
          _id: { toString: () => string };
          package_code?: string;
          shipment_number?: string;
        }[]
      ).map((d) => [
        d._id.toString(),
        {
          id: d._id.toString(),
          package_code: String(d.package_code ?? ''),
          shipment_number: d.shipment_number,
        },
      ])
    );

    const labels = resolveLabelsFromPackages(items, byId);
    const { buffer, labelCount } = await buildPackageLabelsPdf(labels);
    sendPdfResponse(res, buffer, `package-labels-${labelCount}.pdf`);
  } catch (e: unknown) {
    if (e instanceof LabelPdfError) {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('Package labels PDF error:', e);
    return res.status(500).json({ error: 'Failed to generate package labels' });
  }
});

/**
 * GET /api/packages/by-code/:code
 * Admin-only package lookup. Does not fall back to Product / barcode APIs.
 */
router.get('/by-code/:code', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await getPackageByCode(req.params.code);
    res.json(result);
  } catch (e) {
    handlePackageError(res, e, 'Package by-code:');
  }
});

export default router;
