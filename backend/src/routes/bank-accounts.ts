import express from 'express';
import BankAccount from '../models/BankAccount';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = express.Router();

// List bank accounts (for receive payment and bank transactions)
router.get('/', async (req, res) => {
  try {
    const list = await BankAccount.find({ is_active: true }).sort({ name: 1 }).lean();
    res.json(
      list.map((b: any) => ({
        id: b._id.toString(),
        name: b.name,
        account_number: b.account_number,
      }))
    );
  } catch (error) {
    console.error('List bank accounts error:', error);
    res.status(500).json({ error: 'Failed to fetch bank accounts' });
  }
});

// Admin: List all (including inactive) for catalog management
router.get('/admin', authenticateAdmin, async (req, res) => {
  try {
    const list = await BankAccount.find().sort({ name: 1 }).lean();
    res.json(
      list.map((b: any) => ({
        id: b._id.toString(),
        name: b.name,
        account_number: b.account_number,
        is_active: b.is_active !== false,
      }))
    );
  } catch (error) {
    console.error('List bank accounts error:', error);
    res.status(500).json({ error: 'Failed to fetch bank accounts' });
  }
});

// Admin: Create
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      account_number: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const bank = await BankAccount.create({
      name: data.name.trim(),
      account_number: data.account_number?.trim(),
    });
    const b = bank as any;
    res.status(201).json({ id: b._id.toString(), name: b.name, account_number: b.account_number });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to create bank account' });
  }
});

// Admin: Update
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      account_number: z.string().optional(),
      is_active: z.boolean().optional(),
    });
    const data = schema.parse(req.body);
    const bank = await BankAccount.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!bank) return res.status(404).json({ error: 'Bank account not found' });
    const b = bank as any;
    res.json({ id: b._id.toString(), name: b.name, account_number: b.account_number, is_active: b.is_active !== false });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to update' });
  }
});

// Admin: Delete
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    await BankAccount.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

export default router;
