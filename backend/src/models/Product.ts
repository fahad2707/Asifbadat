import mongoose, { Schema, Document } from 'mongoose';

export type ProductType = 'inventory' | 'non_inventory' | 'service';

export interface IProduct extends Document {
  name: string;
  slug: string;
  description?: string;
  product_type: ProductType; // inventory (stock tracked), non_inventory (e.g. fees), service
  price: number;
  cost_price?: number; // Hidden from staff, for profit calculation
  category_id?: mongoose.Types.ObjectId;
  sub_category_id?: mongoose.Types.ObjectId;
  image_url?: string;
  product_id?: string; // Permanent 5-digit store ID (POS + website badge)
  barcode?: string; // Legacy — prefer sku for UPC
  plu?: string; // Legacy — unused
  sku?: string; // Barcode / UPC / vendor SKU (scannable)
  stock_quantity: number;
  /** Customer returns marked damaged. Not part of sellable stock_quantity. */
  damaged_quantity?: number;
  committed_quantity: number; // Reserved by open orders (available = stock_quantity - committed_quantity)
  low_stock_threshold: number;
  reorder_point?: number; // Alert when stock falls below (for purchasing)
  vendor_id?: mongoose.Types.ObjectId; // Primary vendor for this product
  is_active: boolean;
  /** Set when an admin removes the product from the catalog table. Invoice history keeps the name. */
  deleted_at?: Date;
  tax_rate?: number; // Tax percentage used by POS / online checkout. Do not remove.
  /**
   * Optional TaxType assignment for admin / future invoice inheritance.
   * Missing field = not configured (legacy products).
   * null = explicit No Tax.
   * ObjectId = assigned TaxType.
   */
  tax_type_id?: mongoose.Types.ObjectId | null;
  /**
   * PA tobacco reporting classification. Explicit admin value only — never inferred.
   * Default `unknown` for existing products and unverified new products.
   */
  tobacco_class?: 'unknown' | 'cigarette' | 'little_cigar' | 'otp' | 'non_tobacco';
  /** Sticks per cigarette pack when tobacco_class is cigarette. Unset until configured. */
  cigarette_pack_size?: 20 | 25;
  /** How this product's stock_quantity is stored. Unset until configured. */
  stock_unit?: 'pack' | 'carton' | 'case' | 'other';
  /**
   * Reportable cigarette packs represented by one stock unit.
   * Unset until an admin sets a positive integer. Never defaulted to 1.
   */
  packs_per_stock_unit?: number;
  created_at: Date;
  updated_at: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: String,
    product_type: { type: String, enum: ['inventory', 'non_inventory', 'service'], default: 'inventory' },
    price: { type: Number, required: true },
    cost_price: Number, // Hidden from staff
    category_id: { type: Schema.Types.ObjectId, ref: 'Category' },
    sub_category_id: { type: Schema.Types.ObjectId, ref: 'SubCategory' },
    image_url: String,
    product_id: { type: String, unique: true, sparse: true },
    barcode: { type: String, unique: true, sparse: true },
    plu: { type: String, unique: true, sparse: true },
    sku: { type: String, unique: true, sparse: true },
    stock_quantity: { type: Number, default: 0 },
    damaged_quantity: { type: Number, default: 0 },
    committed_quantity: { type: Number, default: 0 }, // Reserved by open orders
    low_stock_threshold: { type: Number, default: 10 },
    reorder_point: Number,
    vendor_id: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    is_active: { type: Boolean, default: true },
    deleted_at: Date,
    tax_rate: { type: Number, default: 0 }, // Tax percentage — POS / online snapshot source
    tax_type_id: { type: Schema.Types.ObjectId, ref: 'TaxType', default: undefined },
    tobacco_class: {
      type: String,
      enum: ['unknown', 'cigarette', 'little_cigar', 'otp', 'non_tobacco'],
      default: 'unknown',
    },
    cigarette_pack_size: { type: Number, enum: [20, 25], default: undefined },
    stock_unit: { type: String, enum: ['pack', 'carton', 'case', 'other'], default: undefined },
    packs_per_stock_unit: {
      type: Number,
      min: 1,
      default: undefined,
      validate: {
        validator: (v: unknown) => v == null || (Number.isInteger(v) && Number(v) >= 1),
        message: 'packs_per_stock_unit must be a positive integer',
      },
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

ProductSchema.index({ category_id: 1 });

/** Catalog lists omit rows an admin deleted from the products table. */
export const PRODUCT_NOT_DELETED = {
  $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
} as const;

export default mongoose.model<IProduct>('Product', ProductSchema);
