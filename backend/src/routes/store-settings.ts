import express from 'express';
import StoreSettings from '../models/StoreSettings';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = express.Router();

// Get settings (single doc)
router.get('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    let settings = await StoreSettings.findOne().lean();
    if (!settings) {
      const created = await StoreSettings.create({
        business_name: 'Express Distributors Inc',
        currency: 'USD',
        default_tax_rate: 0,
      });
      settings = created.toObject() as NonNullable<typeof settings>;
    }
    const s = settings as any;
    res.json({
      id: s._id?.toString(),
      business_name: s.business_name,
      address: s.address,
      city: s.city,
      state: s.state,
      zip: s.zip,
      phone: s.phone,
      email: s.email,
      tax_id: s.tax_id,
      default_tax_rate: s.default_tax_rate ?? 0,
      receipt_header: s.receipt_header,
      receipt_footer: s.receipt_footer,
      currency: s.currency ?? 'USD',
      updated_at: s.updated_at,
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update settings
router.put('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      business_name: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      tax_id: z.string().optional(),
      default_tax_rate: z.number().min(0).optional(),
      receipt_header: z.string().optional(),
      receipt_footer: z.string().optional(),
      currency: z.string().optional(),
    });
    const data = schema.parse(req.body);
    let settings = await StoreSettings.findOne();
    if (!settings) {
      settings = await StoreSettings.create({ business_name: 'Express Distributors Inc', ...data });
    } else {
      Object.assign(settings, data);
      await settings.save();
    }
    res.json({
      id: settings._id.toString(),
      ...settings.toObject(),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.message });
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
