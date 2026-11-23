import mongoose from 'mongoose';
import express from 'express';
import multer from 'multer';
import Category from '../models/Category';
import SubCategory from '../models/SubCategory';
import Product from '../models/Product';
import { authenticateAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { uploadImageBufferToCloudinary } from '../services/cloudinary';
import { assertAllowedImageBuffer } from '../utils/validateImageBuffer';

const router = express.Router();

const catUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// Admin: Delete ALL categories (and subcategories); clear category refs on products
router.delete('/all', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    await Product.updateMany({}, { $unset: { category_id: 1, sub_category_id: 1 } });
    await SubCategory.deleteMany({});
    const result = await Category.deleteMany({});
    res.json({ message: 'All categories removed', deleted: result.deletedCount });
  } catch (error) {
    console.error('Delete all categories error:', error);
    res.status(500).json({ error: 'Failed to remove categories' });
  }
});

// Upload category image
router.post('/upload-image', authenticateAdmin, catUpload.single('image'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    assertAllowedImageBuffer(req.file.buffer, req.file.mimetype);
    const uploaded = await uploadImageBufferToCloudinary(
      req.file.buffer,
      req.file.mimetype,
      'categories',
      'image'
    );
    res.json({ url: uploaded.url, publicId: uploaded.publicId });
  } catch (error) {
    console.error('Category image upload error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Get all categories
router.get('/', async (req, res) => {
  try {
    const categories = await Category.find().sort({ display_order: 1, name: 1 }).lean();
    res.json(categories.map(cat => ({
      id: cat._id.toString(),
      ...cat,
    })));
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get category by slug
router.get('/:slug', async (req, res) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug }).lean();

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({
      id: category._id.toString(),
      ...category,
    });
  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({ error: 'Failed to fetch category' });
  }
});

// Admin: Create category
router.post('/', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      image_url: z.string().optional(),
      display_order: z.number().int().default(0),
    });

    const data = schema.parse(req.body);
    let slug = data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'category';
    let exists = await Category.findOne({ slug });
    let n = 1;
    while (exists) {
      slug = `${slug}-${n++}`;
      exists = await Category.findOne({ slug });
    }

    const category = await Category.create({
      name: data.name,
      slug,
      description: data.description,
      image_url: data.image_url,
      display_order: data.display_order,
    });

    res.status(201).json({
      id: category._id.toString(),
      ...category.toObject(),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Admin: Update category
router.put('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      image_url: z.string().optional(),
      display_order: z.number().int().optional(),
    });

    const data = schema.parse(req.body);

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { ...data, updated_at: new Date() },
      { new: true }
    );

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({
      id: category._id.toString(),
      ...category.toObject(),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Admin: Bulk delete categories (and unset category_id on products; delete subcategories under these categories)
router.post('/bulk-delete', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({ ids: z.array(z.string()).min(1) });
    const { ids } = schema.parse(req.body);
    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
    await Product.updateMany({ category_id: { $in: objectIds } }, { $unset: { category_id: 1, sub_category_id: 1 } });
    await SubCategory.deleteMany({ category_id: { $in: objectIds } });
    const result = await Category.deleteMany({ _id: { $in: objectIds } });
    res.json({ message: `${result.deletedCount} category(ies) deleted`, deleted: result.deletedCount });
  } catch (error: any) {
    if (error?.name === 'ZodError') return res.status(400).json({ error: error.errors?.[0]?.message });
    console.error('Bulk delete categories error:', error);
    res.status(500).json({ error: 'Failed to delete categories' });
  }
});

// Admin: Delete category
router.delete('/:id', authenticateAdmin, async (req: AuthRequest, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
