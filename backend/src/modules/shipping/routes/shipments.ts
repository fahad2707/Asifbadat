import express from 'express';
import { z } from 'zod';
import Shipment from '../models/Shipment';
import ShipmentPackage from '../models/ShipmentPackage';
import { authenticateAdmin, AuthRequest } from '../../../middleware/auth';
import {
  generateShipmentNumber,
  markShipmentDelivered,
  markReturnShipmentReceived,
} from '../services/shipmentService';
import {
  PackageServiceError,
  createPackagesForShipment,
  listPackagesForShipment,
} from '../services/shipmentPackageService';

const router = express.Router();

const itemSchema = z.object({
  product_id: z.string(),
  product_name: z.string().optional(),
  quantity: z.number().positive(),
});

const createSchema = z.object({
  shipment_type: z.enum(['GROUND', 'GROUND_RG']),
  linked_invoice_id: z.string().optional(),
  linked_return_request_id: z.string().optional(),
  warehouse_id: z.string().optional(),
  transporter_name: z.string().optional(),
  vehicle_number: z.string().optional(),
  lr_number: z.string().optional(),
  dispatch_date: z.string().optional(),
  expected_delivery_date: z.string().optional(),
  freight_charge: z.number().min(0).default(0),
  weight_kg: z.number().min(0).optional(),
  volume_cbm: z.number().min(0).optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

// Generate shipment number
router.get('/generate-number', authenticateAdmin, (req, res) => {
  const type = (req.query.type as string) === 'GROUND_RG' ? 'GROUND_RG' : 'GROUND';
  res.json({ shipment_number: generateShipmentNumber(type) });
});

function handlePackageRouteError(res: express.Response, e: unknown, logLabel: string) {
  if (e instanceof PackageServiceError) {
    return res.status(e.status).json({ error: e.message });
  }
  console.error(logLabel, e);
  return res.status(500).json({ error: 'Package request failed' });
}

// List packages for a shipment (before generic /:id)
router.get('/:id/packages', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await listPackagesForShipment(req.params.id);
    res.json(result);
  } catch (e) {
    handlePackageRouteError(res, e, 'List shipment packages:');
  }
});

/**
 * Create packages for a shipment.
 * Body (exactly one form):
 *   { "count": 2 }
 *   { "packages": [{ "notes": "fragile" }] }
 */
router.post('/:id/packages', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await createPackagesForShipment(req.params.id, req.body, req.userId);
    res.status(201).json(result);
  } catch (e) {
    handlePackageRouteError(res, e, 'Create shipment packages:');
  }
});

// List shipments
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { shipment_type, status, linked_invoice_id, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter: Record<string, unknown> = {};
    if (shipment_type && typeof shipment_type === 'string') filter.shipment_type = shipment_type;
    if (status && typeof status === 'string') filter.status = status;
    if (linked_invoice_id && typeof linked_invoice_id === 'string') filter.linked_invoice_id = linked_invoice_id;

    const [list, total] = await Promise.all([
      Shipment.find(filter)
        .populate('linked_invoice_id', 'invoice_number total_amount')
        .populate('items.product_id', 'name sku')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Shipment.countDocuments(filter),
    ]);

    const shipmentIds = list.map((s: any) => s._id);
    const countMap = new Map<string, number>();
    if (shipmentIds.length > 0) {
      const packageCounts = await ShipmentPackage.aggregate([
        { $match: { shipment_id: { $in: shipmentIds } } },
        { $group: { _id: '$shipment_id', count: { $sum: 1 } } },
      ]);
      for (const p of packageCounts) {
        countMap.set(p._id.toString(), p.count);
      }
    }

    res.json({
      shipments: list.map((s: any) => ({
        id: s._id.toString(),
        shipment_number: s.shipment_number,
        shipment_type: s.shipment_type,
        linked_invoice_id: s.linked_invoice_id?._id?.toString(),
        status: s.status,
        transporter_name: s.transporter_name,
        vehicle_number: s.vehicle_number,
        dispatch_date: s.dispatch_date,
        expected_delivery_date: s.expected_delivery_date,
        delivered_date: s.delivered_date,
        freight_charge: s.freight_charge,
        package_count: countMap.get(s._id.toString()) || 0,
        created_at: s.created_at,
        items: s.items,
      })),
      pagination: { page: Number(page), limit: Number(limit), total, total_pages: Math.ceil(total / Number(limit)) },
    });
  } catch (e) {
    console.error('List shipments:', e);
    res.status(500).json({ error: 'Failed to list shipments' });
  }
});

// Get one
router.get('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const s = await Shipment.findById(req.params.id)
      .populate('linked_invoice_id')
      .populate('items.product_id', 'name sku barcode')
      .lean();
    if (!s) return res.status(404).json({ error: 'Shipment not found' });
    const sh = s as any;
    res.json({
      id: sh._id.toString(),
      shipment_number: sh.shipment_number,
      shipment_type: sh.shipment_type,
      linked_invoice_id: sh.linked_invoice_id?._id?.toString(),
      linked_return_request_id: sh.linked_return_request_id?.toString(),
      warehouse_id: sh.warehouse_id?.toString(),
      transporter_name: sh.transporter_name,
      vehicle_number: sh.vehicle_number,
      lr_number: sh.lr_number,
      dispatch_date: sh.dispatch_date,
      expected_delivery_date: sh.expected_delivery_date,
      delivered_date: sh.delivered_date,
      freight_charge: sh.freight_charge,
      status: sh.status,
      proof_of_delivery_url: sh.proof_of_delivery_url,
      weight_kg: sh.weight_kg,
      volume_cbm: sh.volume_cbm,
      notes: sh.notes,
      created_at: sh.created_at,
      items: sh.items,
    });
  } catch (e) {
    console.error('Get shipment:', e);
    res.status(500).json({ error: 'Failed to get shipment' });
  }
});

// Create
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const data = createSchema.parse(req.body);
    const type = data.shipment_type as 'GROUND' | 'GROUND_RG';
    const items = data.items.map((i) => ({
      product_id: i.product_id,
      product_name: i.product_name,
      quantity: i.quantity,
      status: 'PENDING' as const,
    }));

    const shipment = await Shipment.create({
      shipment_number: generateShipmentNumber(type),
      shipment_type: type,
      linked_invoice_id: data.linked_invoice_id || undefined,
      linked_return_request_id: data.linked_return_request_id || undefined,
      warehouse_id: data.warehouse_id || undefined,
      transporter_name: data.transporter_name,
      vehicle_number: data.vehicle_number,
      lr_number: data.lr_number,
      dispatch_date: data.dispatch_date ? new Date(data.dispatch_date) : undefined,
      expected_delivery_date: data.expected_delivery_date ? new Date(data.expected_delivery_date) : undefined,
      freight_charge: data.freight_charge ?? 0,
      weight_kg: data.weight_kg,
      volume_cbm: data.volume_cbm,
      notes: data.notes,
      status: 'PENDING',
      created_by: req.userId,
      items,
    });

    res.status(201).json({
      id: shipment._id.toString(),
      shipment_number: shipment.shipment_number,
      shipment_type: shipment.shipment_type,
      status: shipment.status,
      created_at: shipment.created_at,
    });
  } catch (e: any) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors?.[0]?.message || 'Validation error' });
    console.error('Create shipment:', e);
    res.status(500).json({ error: 'Failed to create shipment' });
  }
});

// Update status (packed, dispatched, in_transit)
router.patch('/:id/status', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { status } = req.body;
    const valid = ['PENDING', 'PACKED', 'DISPATCHED', 'IN_TRANSIT'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
    if (shipment.status === 'DELIVERED' || shipment.status === 'RETURNED' || shipment.status === 'FAILED') {
      return res.status(400).json({ error: 'Cannot change status of completed shipment' });
    }
    const update: any = { status };
    if (status === 'DISPATCHED') update.dispatch_date = new Date();
    await Shipment.findByIdAndUpdate(req.params.id, update);
    res.json({ success: true, status });
  } catch (e) {
    console.error('Update shipment status:', e);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Mark delivered (GROUND: decrease stock; GROUND_RG: handled by mark-return-received)
router.post('/:id/mark-delivered', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { proof_of_delivery_url } = req.body || {};
    const result = await markShipmentDelivered(req.params.id, proof_of_delivery_url, req.userId);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, message: 'Shipment marked delivered' });
  } catch (e) {
    console.error('Mark delivered:', e);
    res.status(500).json({ error: 'Failed to mark delivered' });
  }
});

// Mark return received (GROUND_RG: increase stock, optional auto-create credit memo)
router.post('/:id/mark-return-received', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const { auto_create_credit_memo, customer_id } = req.body || {};
    const result = await markReturnShipmentReceived(
      req.params.id,
      {
        autoCreateCreditMemo: !!auto_create_credit_memo,
        customer_id: customer_id || undefined,
      },
      req.userId
    );
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, credit_memo_id: result.credit_memo_id, message: 'Return received' });
  } catch (e: any) {
    if (e?.status === 400 && typeof e.message === 'string') {
      return res.status(400).json({ error: e.message });
    }
    console.error('Mark return received:', e);
    res.status(500).json({ error: 'Failed to mark return received' });
  }
});

export default router;
