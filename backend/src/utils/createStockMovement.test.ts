/**
 * Canonical StockMovement write contract — isolated harness, no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/utils/createStockMovement.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import mongoose from 'mongoose';
import StockMovement from '../models/StockMovement';
import { StockMovementType } from '../shared/enums';
import { createStockMovement, StockMovementWriteError } from './createStockMovement';

const PRODUCT_ID = '64b0000000000000000c0001';
const REFERENCE_ID = '64b0000000000000000d0001';
const ADMIN_ID = '64b0000000000000000a0001';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'write-contract tests must not open a MongoDB connection');
}

type CapturedCreate = {
  docs: Record<string, unknown>[];
  options: unknown;
};

function stubCreate(): CapturedCreate {
  const captured: CapturedCreate = { docs: [], options: undefined };
  mock.method(StockMovement, 'create', async (docs: unknown, options?: unknown) => {
    captured.docs = docs as Record<string, unknown>[];
    captured.options = options;
    return [captured.docs[0]];
  });
  return captured;
}

test('positive movement 48 → +2 → 50 succeeds', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await createStockMovement({
    productId: PRODUCT_ID,
    movementType: StockMovementType.PURCHASE,
    quantityBefore: 48,
    quantityChange: 2,
    quantityAfter: 50,
  });

  const doc = captured.docs[0];
  assert.equal(String(doc.product_id), PRODUCT_ID);
  assert.equal(doc.movement_type, StockMovementType.PURCHASE);
  assert.equal(doc.quantity_before, 48);
  assert.equal(doc.quantity_change, 2);
  assert.equal(doc.quantity_after, 50);
});

test('negative movement 50 → -5 → 45 succeeds', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await createStockMovement({
    productId: PRODUCT_ID,
    movementType: StockMovementType.SALE,
    quantityBefore: 50,
    quantityChange: -5,
    quantityAfter: 45,
  });

  const doc = captured.docs[0];
  assert.equal(doc.quantity_before, 50);
  assert.equal(doc.quantity_change, -5);
  assert.equal(doc.quantity_after, 45);
});

test('zero-delta 50 → 0 → 50 is accepted; callers still skip persisting no-ops', async () => {
  // Decision: the helper enforces the invariant only. 50 + 0 = 50 is valid.
  // Physical count and stock adjust already skip writing zero-delta rows at the
  // caller. Future writers should keep that skip and simply not call this helper
  // for unchanged stock. The helper does not invent a "no movement" policy.
  assertNoMongoConnection();
  const captured = stubCreate();

  await createStockMovement({
    productId: PRODUCT_ID,
    movementType: StockMovementType.ADJUSTMENT,
    quantityBefore: 50,
    quantityChange: 0,
    quantityAfter: 50,
  });

  assert.equal(captured.docs[0].quantity_change, 0);
  assert.equal(captured.docs[0].quantity_before, 50);
  assert.equal(captured.docs[0].quantity_after, 50);
});

test('invalid invariant 48 → +2 → 51 is rejected and not written', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await assert.rejects(
    () =>
      createStockMovement({
        productId: PRODUCT_ID,
        movementType: StockMovementType.PHYSICAL_COUNT,
        quantityBefore: 48,
        quantityChange: 2,
        quantityAfter: 51,
      }),
    (err: unknown) => {
      assert.ok(err instanceof StockMovementWriteError);
      assert.match(err.message, /quantity_after must equal quantity_before \+ quantity_change/);
      return true;
    }
  );
  assert.equal(captured.docs.length, 0);
});

test('invalid negative invariant 50 → -5 → 44 is rejected and not written', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await assert.rejects(
    () =>
      createStockMovement({
        productId: PRODUCT_ID,
        movementType: StockMovementType.ADJUSTMENT,
        quantityBefore: 50,
        quantityChange: -5,
        quantityAfter: 44,
      }),
    (err: unknown) => {
      assert.ok(err instanceof StockMovementWriteError);
      return true;
    }
  );
  assert.equal(captured.docs.length, 0);
});

test('reference_type, reference_id, and reference_number are persisted distinctly', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await createStockMovement({
    productId: PRODUCT_ID,
    movementType: StockMovementType.PURCHASE,
    quantityBefore: 48,
    quantityChange: 20,
    quantityAfter: 68,
    referenceType: 'purchase_order',
    referenceId: REFERENCE_ID,
    referenceNumber: 'PO-1042',
  });

  const doc = captured.docs[0];
  assert.equal(doc.reference_type, 'purchase_order');
  assert.equal(String(doc.reference_id), REFERENCE_ID);
  assert.equal(doc.reference_number, 'PO-1042');
});

test('reason and notes remain distinct and are not copied into each other', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await createStockMovement({
    productId: PRODUCT_ID,
    movementType: StockMovementType.PHYSICAL_COUNT,
    quantityBefore: 60,
    quantityChange: -10,
    quantityAfter: 50,
    reason: 'PHYSICAL_COUNT',
    notes: 'Warehouse recount',
  });

  const doc = captured.docs[0];
  assert.equal(doc.reason, 'PHYSICAL_COUNT');
  assert.equal(doc.notes, 'Warehouse recount');
  assert.notEqual(doc.reason, doc.notes);
});

test('admin_id is persisted as the actor', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();

  await createStockMovement({
    productId: PRODUCT_ID,
    movementType: StockMovementType.CREDIT_MEMO,
    quantityBefore: 58,
    quantityChange: 2,
    quantityAfter: 60,
    adminId: ADMIN_ID,
  });

  assert.equal(String(captured.docs[0].admin_id), ADMIN_ID);
});

test('provided Mongo session is forwarded to StockMovement.create; helper does not start a transaction', async () => {
  assertNoMongoConnection();
  const captured = stubCreate();
  const session = {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(),
    abortTransaction: mock.fn(),
    endSession: mock.fn(),
  };

  await createStockMovement({
    session: session as unknown as mongoose.ClientSession,
    productId: PRODUCT_ID,
    movementType: StockMovementType.SHIPMENT_OUT,
    quantityBefore: 68,
    quantityChange: -10,
    quantityAfter: 58,
  });

  assert.deepEqual(captured.options, { session });
  assert.equal(session.startTransaction.mock.callCount(), 0);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.abortTransaction.mock.callCount(), 0);
  assert.equal(session.endSession.mock.callCount(), 0);
});
