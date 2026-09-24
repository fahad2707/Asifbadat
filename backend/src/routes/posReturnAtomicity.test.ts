/**
 * Task 07D-10E-01 — POST /api/returns atomic transaction.
 *
 * Isolated harness: no Mongo connection. These tests prove session
 * propagation, claim/update ordering, commit, abort, and that client
 * money values are ignored. They do NOT prove live MongoDB replica-set
 * rollback or a true concurrent race.
 *
 * Run with:
 *     npx tsx --test src/routes/posReturnAtomicity.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import POSSale from '../models/POSSale';
import Return from '../models/Return';
import Product from '../models/Product';
import StockMovement from '../models/StockMovement';
import User from '../models/User';
import Customer from '../models/Customer';
import Receipt from '../models/Receipt';
import Payment from '../models/Payment';

const SALE_ID = '64b0000000000000000a0a0a';
const PRODUCT_ID = '64b0000000000000000d0404';
const PRODUCT_B = '64b0000000000000000d0505';
const USER_ID = '64b0000000000000000e0505';
const RETURN_ID = '64b0000000000000000f0606';
const KEY = '22222222-2222-4222-8222-222222222222';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07d10e-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'POS return tests must not open a MongoDB connection');
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

afterEach(() => {
  mock.restoreAll();
});

function createFakeSession() {
  return {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
}

function firstDoc(docs: unknown): Record<string, unknown> {
  if (Array.isArray(docs)) return docs[0] as Record<string, unknown>;
  return docs as Record<string, unknown>;
}

function createOptions(args: unknown[]): { session?: unknown } | undefined {
  return args[1] as { session?: unknown } | undefined;
}

function saleFixture(overrides: Record<string, unknown> = {}) {
  const created_at = overrides.created_at instanceof Date
    ? overrides.created_at
    : new Date();
  return {
    _id: SALE_ID,
    sale_number: 'POS-1',
    invoice_id: '64b0000000000000000b0b0b',
    customer_id: USER_ID,
    customer_name: 'Pat',
    customer_phone: '5551234567',
    created_at,
    items: [
      {
        product_id: PRODUCT_ID,
        product_name: 'Retail Item',
        quantity: 3,
        price: 100,
        discount: 0,
        tax: 0,
        subtotal: 300,
      },
    ],
    discount_amount: 30,
    tax_amount: 0,
    total_amount: 270,
    payment_method: 'cash',
    ...overrides,
  };
}

function stubExistingReturns(returns: unknown[] = []) {
  mock.method(Return, 'find', () => ({
    lean: async () => returns,
  }));
}

function stubProduct(opts?: { price?: number; product_type?: string; id?: string }) {
  mock.method(Product, 'findById', async (id: unknown) => ({
    _id: { toString: () => String(id) },
    name: 'Retail Item',
    price: opts?.price ?? 999,
    product_type: opts?.product_type ?? 'inventory',
    stock_quantity: 10,
    is_active: true,
  }));
}

function stubSuccessfulWrites(session: ReturnType<typeof createFakeSession>) {
  mock.method(Return, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    return [
      {
        _id: { toString: () => RETURN_ID },
        ...doc,
        toObject: () => ({ _id: RETURN_ID, ...doc }),
      },
    ];
  });
  mock.method(POSSale, 'findOneAndUpdate', async () => ({ _id: SALE_ID }));
  mock.method(Product, 'findOneAndUpdate', async () => ({ _id: PRODUCT_ID }));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));
}

async function postReturn(body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/returns')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    sale_id: SALE_ID,
    items: [
      {
        product_id: PRODUCT_ID,
        quantity: 3,
        inventory_disposition: 'resalable',
      },
    ],
    refund_method: 'cash',
    ...overrides,
  };
}

test('route uses a session, claim filter, and excludes settlement ledgers', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/returns.ts'), 'utf8');
  assert.match(src, /startSession/);
  assert.match(src, /startTransaction/);
  assert.match(src, /commitTransaction/);
  assert.match(src, /abortTransaction/);
  assert.match(src, /posReturnQuantityClaimFilter/);
  assert.match(src, /calculatePosReturnRefund/);
  assert.match(src, /isIdempotencyDuplicateKey/);
  assert.match(src, /waitForCommittedKeyedSale/);
  assert.equal(src.includes('Receipt.create'), false);
  assert.equal(src.includes('Payment.create'), false);
  assert.equal(src.includes('CreditMemo'), false);
  assert.equal(src.includes('outstanding_balance'), false);
  assert.equal(src.includes('applyPaymentToInvoice'), false);

  const path = POSSale.schema.path('returned_quantities') as { instance?: string };
  assert.equal(path.instance, 'Mixed');
});

test('A — successful full return of 3 × $100 with $30 bill discount is $270', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Return, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    created = firstDoc(docs);
    return [{ _id: { toString: () => RETURN_ID }, ...created, toObject: () => created }];
  });
  mock.method(POSSale, 'findOneAndUpdate', async () => ({ _id: SALE_ID }));
  mock.method(Product, 'findOneAndUpdate', async () => ({ _id: PRODUCT_ID }));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));

  const res = await postReturn(baseBody());

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.total_refund, 270);
  assert.equal(res.body.return.total_refund, 270);
  assert.equal((created?.items as any[])[0].refundable_amount, 270);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
  assert.equal(session.abortTransaction.mock.callCount(), 0);
});

test('B — partial return of 1 of 3 is $90', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Return, 'create', async (docs: unknown) => {
    created = firstDoc(docs);
    return [{ _id: { toString: () => RETURN_ID }, ...created, toObject: () => created }];
  });
  mock.method(POSSale, 'findOneAndUpdate', async () => ({ _id: SALE_ID }));
  mock.method(Product, 'findOneAndUpdate', async () => ({ _id: PRODUCT_ID }));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));

  const res = await postReturn(
    baseBody({
      items: [{ product_id: PRODUCT_ID, quantity: 1, inventory_disposition: 'resalable' }],
    })
  );

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.total_refund, 90);
});

test('C — mixed disposition restocks only resalable units', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Return, 'create', async (docs: unknown) => {
    created = firstDoc(docs);
    return [{ _id: { toString: () => RETURN_ID }, ...created, toObject: () => created }];
  });

  const stockIncs: number[] = [];
  mock.method(POSSale, 'findOneAndUpdate', async () => ({ _id: SALE_ID }));
  mock.method(Product, 'findOneAndUpdate', async (...args: unknown[]) => {
    const update = args[1] as { $inc?: { stock_quantity?: number } };
    stockIncs.push(update?.$inc?.stock_quantity ?? 0);
    return { _id: PRODUCT_ID };
  });
  let movements = 0;
  let movementQty = 0;
  mock.method(StockMovement, 'create', async (docs: unknown) => {
    movements += 1;
    movementQty += Number(firstDoc(docs).quantity_change) || 0;
    return [{}];
  });
  mock.method(User, 'findByIdAndUpdate', async () => ({}));

  const res = await postReturn(
    baseBody({
      items: [
        { product_id: PRODUCT_ID, quantity: 2, inventory_disposition: 'resalable' },
        { product_id: PRODUCT_ID, quantity: 1, inventory_disposition: 'damaged' },
      ],
    })
  );

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  const returnItems = created?.items as Array<{ inventory_disposition: string; quantity: number }>;
  assert.equal(returnItems.length, 2);
  assert.equal(returnItems[0].inventory_disposition, 'resalable');
  assert.equal(returnItems[0].quantity, 2);
  assert.equal(returnItems[1].inventory_disposition, 'damaged');
  assert.equal(returnItems[1].quantity, 1);
  assert.deepEqual(stockIncs, [2]);
  assert.equal(movements, 1);
  assert.equal(movementQty, 2);
});

test('D — original sale tax is excluded from the merchandise refund', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () =>
    saleFixture({
      tax_amount: 24.3,
      total_amount: 294.3,
      items: [
        {
          product_id: PRODUCT_ID,
          product_name: 'Retail Item',
          quantity: 3,
          price: 100,
          discount: 0,
          tax: 24.3,
          subtotal: 294.3,
        },
      ],
    })
  );
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Return, 'create', async (docs: unknown) => {
    created = firstDoc(docs);
    return [{ _id: { toString: () => RETURN_ID }, ...created, toObject: () => created }];
  });
  mock.method(POSSale, 'findOneAndUpdate', async () => ({ _id: SALE_ID }));
  mock.method(Product, 'findOneAndUpdate', async () => ({ _id: PRODUCT_ID }));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));

  const res = await postReturn(baseBody());

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.total_refund, 270);
  assert.equal(Object.prototype.hasOwnProperty.call(created ?? {}, 'tax_refund'), false);
});

test('E — over-return after a completed partial return is rejected with no writes', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns([
    {
      status: 'completed',
      items: [{ product_id: PRODUCT_ID, quantity: 2 }],
    },
  ]);
  stubProduct();
  let sessions = 0;
  let returnCreates = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run after over-return');
  });
  mock.method(Return, 'create', async () => {
    returnCreates += 1;
    throw new Error('Return.create must not run');
  });

  const res = await postReturn(
    baseBody({
      items: [{ product_id: PRODUCT_ID, quantity: 2, inventory_disposition: 'resalable' }],
    })
  );

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /Remaining returnable quantity/i);
  assert.equal(sessions, 0);
  assert.equal(returnCreates, 0);
});

test('F — fully returned sale rejects a further return with no writes', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns([
    {
      status: 'completed',
      items: [{ product_id: PRODUCT_ID, quantity: 3 }],
    },
  ]);
  stubProduct();
  let sessions = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run');
  });

  const res = await postReturn(baseBody());

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /Remaining returnable quantity: 0/i);
  assert.equal(sessions, 0);
});

test('G — product not in the original sale is rejected with no writes', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct();
  let sessions = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run');
  });

  const res = await postReturn(
    baseBody({
      items: [{ product_id: PRODUCT_B, quantity: 1, inventory_disposition: 'resalable' }],
    })
  );

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /not part of the original sale/i);
  assert.equal(sessions, 0);
});

test('H — expired return window is rejected with no writes', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () =>
    saleFixture({ created_at: new Date(Date.now() - 20 * MS_PER_DAY) })
  );
  stubExistingReturns();
  stubProduct();
  let sessions = 0;
  let returnCreates = 0;
  let stockUpdates = 0;
  let spentUpdates = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run after expired window');
  });
  mock.method(Return, 'create', async () => {
    returnCreates += 1;
    throw new Error('Return.create must not run');
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    stockUpdates += 1;
    return {};
  });
  mock.method(User, 'findByIdAndUpdate', async () => {
    spentUpdates += 1;
    return {};
  });

  const res = await postReturn(baseBody());

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /outside the return window/i);
  assert.equal(sessions, 0);
  assert.equal(returnCreates, 0);
  assert.equal(stockUpdates, 0);
  assert.equal(spentUpdates, 0);
});

test('I — valid 30-day extension succeeds and is preserved', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () =>
    saleFixture({ created_at: new Date(Date.now() - 20 * MS_PER_DAY) })
  );
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Return, 'create', async (docs: unknown) => {
    created = firstDoc(docs);
    return [{ _id: { toString: () => RETURN_ID }, ...created, toObject: () => created }];
  });
  mock.method(POSSale, 'findOneAndUpdate', async () => ({ _id: SALE_ID }));
  mock.method(Product, 'findOneAndUpdate', async () => ({ _id: PRODUCT_ID }));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));

  const res = await postReturn(baseBody({ return_window_days: 30 }));

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.return_window_days, 30);
  assert.equal(created?.window_extended, true);
  assert.ok(created?.return_deadline);
  assert.equal(created?.window_extended_by, '07d10e-isolated-admin');
});

test('J — invalid extension values are rejected', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct();
  let sessions = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run');
  });

  const res = await postReturn(baseBody({ return_window_days: 20 }));

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /15, 30, or 45/i);
  assert.equal(sessions, 0);
});

test('K — idempotent retry replays the committed Return without repeating writes', async () => {
  assertNoMongoConnection();
  stubProduct();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();

  const committed = {
    _id: RETURN_ID,
    return_number: 'RET-ORIGINAL',
    idempotency_key: KEY,
    total_refund: 270,
    toObject: () => ({
      _id: RETURN_ID,
      return_number: 'RET-ORIGINAL',
      idempotency_key: KEY,
      total_refund: 270,
    }),
  };

  let lookups = 0;
  mock.method(Return, 'findOne', async () => {
    lookups += 1;
    return committed;
  });

  let sessions = 0;
  let returnCreates = 0;
  let claims = 0;
  let stockUpdates = 0;
  let movements = 0;
  let spentUpdates = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run for a committed replay');
  });
  mock.method(Return, 'create', async () => {
    returnCreates += 1;
    throw new Error('Return.create must not run');
  });
  mock.method(POSSale, 'findOneAndUpdate', async () => {
    claims += 1;
    return {};
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    stockUpdates += 1;
    return {};
  });
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    return [{}];
  });
  mock.method(User, 'findByIdAndUpdate', async () => {
    spentUpdates += 1;
    return {};
  });

  const res = await postReturn(baseBody({ idempotency_key: KEY }));

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.return.id, RETURN_ID);
  assert.equal(res.body.return.return_number, 'RET-ORIGINAL');
  assert.equal(lookups, 1);
  assert.equal(sessions, 0);
  assert.equal(returnCreates, 0);
  assert.equal(claims, 0);
  assert.equal(stockUpdates, 0);
  assert.equal(movements, 0);
  assert.equal(spentUpdates, 0);
});

test('L — duplicate-key loser replays the committed Return and does not write again', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let lookups = 0;
  mock.method(Return, 'findOne', async () => {
    lookups += 1;
    if (lookups === 1) return null;
    return {
      _id: RETURN_ID,
      return_number: 'RET-WINNER',
      idempotency_key: KEY,
      toObject: () => ({ _id: RETURN_ID, return_number: 'RET-WINNER', idempotency_key: KEY }),
    };
  });

  let returnCreates = 0;
  mock.method(Return, 'create', async () => {
    returnCreates += 1;
    throw Object.assign(new Error('E11000 duplicate key error index: idempotency_key_1'), {
      code: 11000,
      keyPattern: { idempotency_key: 1 },
    });
  });

  let claims = 0;
  let stockUpdates = 0;
  let movements = 0;
  let spentUpdates = 0;
  mock.method(POSSale, 'findOneAndUpdate', async () => {
    claims += 1;
    return {};
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    stockUpdates += 1;
    return {};
  });
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    return [{}];
  });
  mock.method(User, 'findByIdAndUpdate', async () => {
    spentUpdates += 1;
    return {};
  });

  const res = await postReturn(baseBody({ idempotency_key: KEY }));

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.return.id, RETURN_ID);
  assert.equal(returnCreates, 1);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(claims, 0);
  assert.equal(stockUpdates, 0);
  assert.equal(movements, 0);
  assert.equal(spentUpdates, 0);
});

test('M — later transactional failure aborts and does not commit', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  let spentUpdates = 0;
  mock.method(StockMovement, 'create', async () => {
    throw new Error('simulated StockMovement.create failure');
  });
  mock.method(User, 'findByIdAndUpdate', async () => {
    spentUpdates += 1;
    return {};
  });

  const res = await postReturn(baseBody());

  assertNoMongoConnection();
  assert.equal(res.status, 500);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(session.endSession.mock.callCount(), 1);
  assert.equal(spentUpdates, 0);
});

test('N — walk-in sale return does not create or update a customer', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () =>
    saleFixture({ customer_id: undefined, pos_customer_id: undefined })
  );
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  let userCreates = 0;
  let userUpdates = 0;
  let customerUpdates = 0;
  mock.method(User, 'create', async () => {
    userCreates += 1;
    throw new Error('User.create must not run for a walk-in return');
  });
  mock.method(User, 'findByIdAndUpdate', async () => {
    userUpdates += 1;
    return {};
  });
  mock.method(Customer, 'findByIdAndUpdate', async () => {
    customerUpdates += 1;
    return {};
  });

  const res = await postReturn(baseBody());

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(userCreates, 0);
  assert.equal(userUpdates, 0);
  assert.equal(customerUpdates, 0);
});

test('O — customer POS sale reverses User.total_spent by the merchandise refund', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  let userArgs: unknown[] | undefined;
  mock.method(User, 'findByIdAndUpdate', async (...args: unknown[]) => {
    userArgs = args;
    return {};
  });

  const res = await postReturn(
    baseBody({
      items: [{ product_id: PRODUCT_ID, quantity: 1, inventory_disposition: 'resalable' }],
    })
  );

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.ok(userArgs);
  assert.equal(String(userArgs[0]), USER_ID);
  assert.deepEqual(userArgs[1], { $inc: { total_spent: -90 } });
  assert.equal((userArgs[2] as { session?: unknown }).session, session);
});

test('P — wholesale AR, Receipt, and Payment are not written', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  let customerUpdates = 0;
  let receipts = 0;
  let payments = 0;
  mock.method(Customer, 'findByIdAndUpdate', async () => {
    customerUpdates += 1;
    throw new Error('Customer.outstanding_balance must not be touched');
  });
  mock.method(Receipt, 'create', async () => {
    receipts += 1;
    throw new Error('Receipt.create must not run');
  });
  mock.method(Payment, 'create', async () => {
    payments += 1;
    throw new Error('Payment.create must not run');
  });

  const res = await postReturn(baseBody());

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(customerUpdates, 0);
  assert.equal(receipts, 0);
  assert.equal(payments, 0);
});

test('Q — current catalog price is ignored; refund uses original POSSale economics', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct({ price: 999 });
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Return, 'create', async (docs: unknown) => {
    created = firstDoc(docs);
    return [{ _id: { toString: () => RETURN_ID }, ...created, toObject: () => created }];
  });
  mock.method(POSSale, 'findOneAndUpdate', async () => ({ _id: SALE_ID }));
  mock.method(Product, 'findOneAndUpdate', async () => ({ _id: PRODUCT_ID }));
  mock.method(StockMovement, 'create', async () => [{}]);
  mock.method(User, 'findByIdAndUpdate', async () => ({}));

  const res = await postReturn(
    baseBody({
      items: [{ product_id: PRODUCT_ID, quantity: 1, inventory_disposition: 'resalable' }],
      total_refund: 999,
      original_unit_price: 999,
    })
  );

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.total_refund, 90);
  assert.equal((created?.items as any[])[0].original_unit_price, 100);
  assert.equal((created?.items as any[])[0].refundable_unit_amount, 90);
});

test('concurrent claim miss aborts instead of creating a completed return', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  mock.method(POSSale, 'findOneAndUpdate', async () => null);
  let movements = 0;
  let spentUpdates = 0;
  mock.method(StockMovement, 'create', async () => {
    movements += 1;
    return [{}];
  });
  mock.method(User, 'findByIdAndUpdate', async () => {
    spentUpdates += 1;
    return {};
  });

  const res = await postReturn(baseBody());

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /Remaining returnable quantity/i);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(movements, 0);
  assert.equal(spentUpdates, 0);
});

test('sale not found is 404 and starts no transaction', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => null);
  let sessions = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run');
  });

  const res = await postReturn(baseBody());

  assertNoMongoConnection();
  assert.equal(res.status, 404);
  assert.match(String(res.body.error), /Sale not found/i);
  assert.equal(sessions, 0);
});

test('quantity claim update touches only returned_quantities', async () => {
  assertNoMongoConnection();
  mock.method(POSSale, 'findById', async () => saleFixture());
  stubExistingReturns();
  stubProduct();
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);

  let claimUpdate: Record<string, unknown> | undefined;
  mock.method(POSSale, 'findOneAndUpdate', async (...args: unknown[]) => {
    claimUpdate = args[1] as Record<string, unknown>;
    return { _id: SALE_ID };
  });

  const res = await postReturn(
    baseBody({
      items: [{ product_id: PRODUCT_ID, quantity: 1, inventory_disposition: 'resalable' }],
    })
  );

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.ok(claimUpdate);
  const inc = claimUpdate.$inc as Record<string, number>;
  assert.equal(inc[`returned_quantities.${PRODUCT_ID}`], 1);
  assert.equal(Object.keys(inc).every((key) => key.startsWith('returned_quantities.')), true);
  assert.equal(Object.prototype.hasOwnProperty.call(claimUpdate, 'total_amount'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(claimUpdate, '$set'), false);
});
