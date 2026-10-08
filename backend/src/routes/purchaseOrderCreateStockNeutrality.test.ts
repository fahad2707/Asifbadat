/**
 * Phase 3 — PO create is inventory-neutral (stock + StockMovement).
 *
 * Note: PO create may still update Product.cost_price to the line unit cost.
 * That is a pricing side effect, not an inventory quantity / ledger movement.
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/purchaseOrderCreateStockNeutrality.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import PurchaseOrder from '../models/PurchaseOrder';
import Product from '../models/Product';
import Vendor from '../models/Vendor';
import StockMovement from '../models/StockMovement';

const ADMIN_ID = '64b0000000000000000a0001';
const VENDOR_ID = '64b0000000000000000f0001';
const PO_ID = '64b0000000000000000b0001';
const PRODUCT_A = '64b0000000000000000c0001';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'PO create neutrality tests must not open a MongoDB connection');
}

afterEach(() => {
  mock.restoreAll();
});

test('create draft PO does not change stock_quantity or create StockMovement', async () => {
  assertNoMongoConnection();

  const initialStock = 42;
  const stockByProduct: Record<string, number> = { [PRODUCT_A]: initialStock };
  let movementCount = 0;
  let stockQuantityWrites = 0;
  let costPriceUpdates = 0;
  let createdStatus: string | undefined;

  mock.method(Vendor, 'findById', async () => ({ _id: VENDOR_ID, name: 'Acme' }));
  mock.method(PurchaseOrder, 'create', async (doc: Record<string, unknown>) => {
    createdStatus = String(doc.status || '');
    return {
      _id: PO_ID,
      ...doc,
      created_at: new Date(),
    };
  });
  mock.method(Product, 'findByIdAndUpdate', async (id: unknown, update: Record<string, unknown>) => {
    const productId = String(id);
    if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, 'cost_price')) {
      costPriceUpdates += 1;
      // cost_price only — must not touch stock_quantity
      assert.equal(
        Object.prototype.hasOwnProperty.call(update.$set as object, 'stock_quantity'),
        false
      );
      return { _id: productId, cost_price: (update.$set as { cost_price: number }).cost_price };
    }
    if (update.$inc && Object.prototype.hasOwnProperty.call(update.$inc as object, 'stock_quantity')) {
      stockQuantityWrites += 1;
      stockByProduct[productId] =
        (stockByProduct[productId] || 0) + Number((update.$inc as { stock_quantity: number }).stock_quantity);
    }
    if (update.$set && Object.prototype.hasOwnProperty.call(update.$set as object, 'stock_quantity')) {
      stockQuantityWrites += 1;
      stockByProduct[productId] = Number((update.$set as { stock_quantity: number }).stock_quantity);
    }
    return { _id: productId, stock_quantity: stockByProduct[productId] };
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    stockQuantityWrites += 1;
    throw new Error('stock_quantity must not change on PO create');
  });
  mock.method(StockMovement, 'create', async () => {
    movementCount += 1;
    throw new Error('StockMovement must not run on PO create');
  });

  const res = await request(createApp())
    .post('/api/purchase-orders')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      vendor_id: VENDOR_ID,
      items: [
        {
          product_id: PRODUCT_A,
          product_name: 'Lays Box',
          quantity_ordered: 10,
          unit_cost: 2.5,
        },
      ],
    });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'draft');
  assert.ok(Array.isArray(res.body.items));
  assert.equal(res.body.items.length, 1);
  assert.equal(Number(res.body.items[0].quantity_received || 0), 0);
  assert.equal(stockByProduct[PRODUCT_A], initialStock);
  assert.equal(stockQuantityWrites, 0);
  assert.equal(movementCount, 0);
  // Existing create contract may update cost_price; that is not inventory movement.
  assert.equal(costPriceUpdates, 1);
  assert.equal(createdStatus, 'draft');
});
