/**
 * Task 07D-10E-02 — POST /api/returns/:returnId/settle
 *
 * Isolated harness: no Mongo connection. These tests prove settlement
 * amount source, method rules, claim/idempotency, and AR isolation.
 * They do NOT prove live MongoDB replica-set rollback.
 *
 * Run with:
 *     npx tsx --test src/routes/posReturnSettlement.test.ts
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
import Return from '../models/Return';
import POSSale from '../models/POSSale';
import PosReturnSettlement from '../models/PosReturnSettlement';
import PosCustomerCredit from '../models/PosCustomerCredit';
import User from '../models/User';
import Customer from '../models/Customer';
import Receipt from '../models/Receipt';
import Payment from '../models/Payment';
import Invoice from '../models/Invoice';
import CreditMemo from '../modules/credit-memo/models/CreditMemo';

const RETURN_ID = '64b0000000000000000f0606';
const SALE_ID = '64b0000000000000000a0a0a';
const USER_ID = '64b0000000000000000e0505';
const SETTLEMENT_ID = '64b0000000000000000c0c0c';

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07d10e02-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'POS settlement tests must not open a MongoDB connection');
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

function returnFixture(overrides: Record<string, unknown> = {}) {
  return {
    _id: RETURN_ID,
    return_number: 'RET-1',
    sale_id: SALE_ID,
    sale_number: 'POS-1',
    customer_id: USER_ID,
    total_refund: 90,
    refund_method: 'cash',
    status: 'completed',
    settlement_status: 'unsettled',
    toObject() {
      return { ...this };
    },
    ...overrides,
  };
}

function settlementFixture(overrides: Record<string, unknown> = {}) {
  const doc = {
    _id: SETTLEMENT_ID,
    return_id: RETURN_ID,
    return_number: 'RET-1',
    amount: 90,
    refund_method: 'cash',
    settled_at: new Date('2026-02-01'),
    ...overrides,
  };
  return {
    ...doc,
    toObject() {
      return { ...doc };
    },
  };
}

function stubSuccessfulWrites(session: ReturnType<typeof createFakeSession>) {
  mock.method(Return, 'findOneAndUpdate', async () => returnFixture({ settlement_status: 'settled' }));
  mock.method(PosReturnSettlement, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => SETTLEMENT_ID }, ...doc, toObject: () => doc }];
  });
  mock.method(PosCustomerCredit, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    return [{}];
  });
  mock.method(Return, 'findByIdAndUpdate', async () =>
    returnFixture({ settlement_status: 'settled', settlement_id: SETTLEMENT_ID })
  );
}

async function postSettle(body: Record<string, unknown>, returnId = RETURN_ID) {
  return request(createApp())
    .post(`/api/returns/${returnId}/settle`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send(body);
}

test('settle route uses Return.total_refund and excludes wholesale AR models', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/returns.ts'), 'utf8');
  assert.match(src, /:returnId\/settle/);
  assert.match(src, /posReturnSettlementClaimFilter/);
  assert.match(src, /PosReturnSettlement\.create/);
  assert.match(src, /PosCustomerCredit\.create/);
  assert.match(src, /existing\.total_refund/);
  assert.equal(src.includes('Receipt.create'), false);
  assert.equal(src.includes('Payment.create'), false);
  assert.equal(src.includes('CreditMemo'), false);
  assert.equal(src.includes('outstanding_balance'), false);
  assert.equal(src.includes('applyPaymentToInvoice'), false);
  assert.equal(src.includes('POSSale.findByIdAndUpdate'), false);
});

test('A — cash settlement uses exact Return.total_refund', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture({ total_refund: 90 }));
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Return, 'findOneAndUpdate', async () => returnFixture({ settlement_status: 'settled' }));
  mock.method(PosReturnSettlement, 'create', async (docs: unknown) => {
    created = firstDoc(docs);
    return [{ _id: { toString: () => SETTLEMENT_ID }, ...created, toObject: () => created }];
  });
  mock.method(PosCustomerCredit, 'create', async () => {
    throw new Error('cash must not write customer credit');
  });
  mock.method(Return, 'findByIdAndUpdate', async () =>
    returnFixture({ settlement_status: 'settled', settlement_id: SETTLEMENT_ID })
  );

  const res = await postSettle({ refund_method: 'cash' });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.amount, 90);
  assert.equal(created?.refund_method, 'cash');
  assert.equal(res.body.settlement.amount, 90);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
});

test('B — cheque settlement requires cheque_reference', async () => {
  assertNoMongoConnection();
  let sessions = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run');
  });

  const res = await postSettle({ refund_method: 'cheque' });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /cheque_reference/i);
  assert.equal(sessions, 0);
});

test('C — cheque stores the reference on the settlement', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture());
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Return, 'findOneAndUpdate', async () => returnFixture({ settlement_status: 'settled' }));
  mock.method(PosReturnSettlement, 'create', async (docs: unknown) => {
    created = firstDoc(docs);
    return [{ _id: { toString: () => SETTLEMENT_ID }, ...created, toObject: () => created }];
  });
  mock.method(Return, 'findByIdAndUpdate', async () =>
    returnFixture({ settlement_status: 'settled', settlement_id: SETTLEMENT_ID })
  );

  const res = await postSettle({ refund_method: 'cheque', cheque_reference: 'CHK-12345' });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.refund_method, 'cheque');
  assert.equal(created?.cheque_reference, 'CHK-12345');
  assert.equal(res.body.settlement.cheque_reference, 'CHK-12345');
});

test('D — customer credit requires an eligible customer', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture({ customer_id: undefined }));
  let sessions = 0;
  let credits = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run');
  });
  mock.method(PosCustomerCredit, 'create', async () => {
    credits += 1;
    throw new Error('credit must not be created');
  });

  const res = await postSettle({ refund_method: 'credit' });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /eligible customer/i);
  assert.equal(sessions, 0);
  assert.equal(credits, 0);
});

test('E — walk-in cash succeeds', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture({ customer_id: undefined }));
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);
  mock.method(PosCustomerCredit, 'create', async () => {
    throw new Error('walk-in cash must not create credit');
  });
  mock.method(User, 'create', async () => {
    throw new Error('User.create must not run');
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('Customer.create must not run');
  });

  const res = await postSettle({ refund_method: 'cash' });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(res.body.settlement.amount, 90);
});

test('F — walk-in cheque succeeds', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture({ customer_id: undefined }));
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);
  mock.method(PosCustomerCredit, 'create', async () => {
    throw new Error('walk-in cheque must not create credit');
  });

  const res = await postSettle({ refund_method: 'cheque', cheque_reference: 'CHK-WALK' });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(res.body.settlement.refund_method, 'cheque');
});

test('G — walk-in credit is rejected', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture({ customer_id: undefined, pos_customer_id: undefined }));
  let userCreates = 0;
  let customerCreates = 0;
  mock.method(User, 'create', async () => {
    userCreates += 1;
    throw new Error('User.create must not run');
  });
  mock.method(Customer, 'create', async () => {
    customerCreates += 1;
    throw new Error('Customer.create must not run');
  });
  mock.method(mongoose, 'startSession', async () => {
    throw new Error('startSession must not run');
  });

  const res = await postSettle({ refund_method: 'credit' });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.equal(userCreates, 0);
  assert.equal(customerCreates, 0);
});

test('H — tax is not included because settlement uses Return.total_refund', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture({ total_refund: 270 }));
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Return, 'findOneAndUpdate', async () => returnFixture({ settlement_status: 'settled' }));
  mock.method(PosReturnSettlement, 'create', async (docs: unknown) => {
    created = firstDoc(docs);
    return [{ _id: { toString: () => SETTLEMENT_ID }, ...created, toObject: () => created }];
  });
  mock.method(Return, 'findByIdAndUpdate', async () =>
    returnFixture({ settlement_status: 'settled', total_refund: 270 })
  );

  const res = await postSettle({ refund_method: 'cash', tax_refund: 24.3 });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.amount, 270);
  assert.equal(Object.prototype.hasOwnProperty.call(created ?? {}, 'tax_refund'), false);
});

test('I — client-supplied refund amount cannot override Return.total_refund', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture({ total_refund: 90 }));
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);

  let created: Record<string, unknown> | undefined;
  mock.method(Return, 'findOneAndUpdate', async () => returnFixture({ settlement_status: 'settled' }));
  mock.method(PosReturnSettlement, 'create', async (docs: unknown) => {
    created = firstDoc(docs);
    return [{ _id: { toString: () => SETTLEMENT_ID }, ...created, toObject: () => created }];
  });
  mock.method(Return, 'findByIdAndUpdate', async () => returnFixture({ settlement_status: 'settled' }));

  const res = await postSettle({ refund_method: 'cash', amount: 999, total_refund: 999 });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(created?.amount, 90);
  assert.equal(res.body.settlement.amount, 90);
});

test('J / Q — already-settled retry replays without duplicate money or credit', async () => {
  assertNoMongoConnection();
  const settled = returnFixture({ settlement_status: 'settled', settlement_id: SETTLEMENT_ID });
  mock.method(Return, 'findById', async () => settled);
  mock.method(PosReturnSettlement, 'findOne', async () => settlementFixture());

  let sessions = 0;
  let settlementCreates = 0;
  let creditCreates = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run for replay');
  });
  mock.method(PosReturnSettlement, 'create', async () => {
    settlementCreates += 1;
    throw new Error('settlement must not be created twice');
  });
  mock.method(PosCustomerCredit, 'create', async () => {
    creditCreates += 1;
    throw new Error('credit must not be created twice');
  });

  const res = await postSettle({ refund_method: 'cash' });

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.settlement.id, SETTLEMENT_ID);
  assert.equal(res.body.settlement.amount, 90);
  assert.equal(sessions, 0);
  assert.equal(settlementCreates, 0);
  assert.equal(creditCreates, 0);
});

test('K — concurrent claim miss replays the committed settlement', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture());
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Return, 'findOneAndUpdate', async () => null);
  mock.method(PosReturnSettlement, 'findOne', async () => settlementFixture());

  let settlementCreates = 0;
  let creditCreates = 0;
  mock.method(PosReturnSettlement, 'create', async () => {
    settlementCreates += 1;
    throw new Error('loser must not create settlement');
  });
  mock.method(PosCustomerCredit, 'create', async () => {
    creditCreates += 1;
    throw new Error('loser must not create credit');
  });

  const res = await postSettle({ refund_method: 'cash' });

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.settlement.id, SETTLEMENT_ID);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(settlementCreates, 0);
  assert.equal(creditCreates, 0);
});

test('L — later transactional failure aborts settlement state', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture());
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Return, 'findOneAndUpdate', async () => returnFixture({ settlement_status: 'settled' }));
  mock.method(PosReturnSettlement, 'create', async (docs: unknown, options?: { session?: unknown }) => {
    assert.equal(options?.session, session);
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => SETTLEMENT_ID }, ...doc, toObject: () => doc }];
  });
  let creditCreates = 0;
  mock.method(Return, 'findByIdAndUpdate', async () => {
    throw new Error('simulated Return.findByIdAndUpdate failure');
  });
  mock.method(PosCustomerCredit, 'create', async () => {
    creditCreates += 1;
    return [{}];
  });

  const res = await postSettle({ refund_method: 'cash' });

  assertNoMongoConnection();
  assert.equal(res.status, 500);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.equal(creditCreates, 0);
});

test('M — customer credit creates exactly one auditable credit entry', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture({ customer_id: USER_ID, total_refund: 90 }));
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Return, 'findOneAndUpdate', async () => returnFixture({ settlement_status: 'settled' }));
  mock.method(PosReturnSettlement, 'create', async (docs: unknown) => {
    const doc = firstDoc(docs);
    return [{ _id: { toString: () => SETTLEMENT_ID }, ...doc, toObject: () => doc }];
  });

  let creditArgs: unknown[] | undefined;
  mock.method(PosCustomerCredit, 'create', async (...args: unknown[]) => {
    creditArgs = args;
    return [{}];
  });
  mock.method(Return, 'findByIdAndUpdate', async () => returnFixture({ settlement_status: 'settled' }));

  const res = await postSettle({ refund_method: 'credit' });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.ok(creditArgs);
  const credit = firstDoc(creditArgs[0]);
  assert.equal(String(credit.customer_id), USER_ID);
  assert.equal(String(credit.return_id), RETURN_ID);
  assert.equal(credit.amount, 90);
  assert.equal(credit.type, 'pos_return_credit');
  assert.equal(credit.direction, 'credit');
  assert.equal((creditArgs[1] as { session?: unknown }).session, session);
});

test('N / O — wholesale AR, Receipt, Payment, CreditMemo, and Customer balance stay untouched', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture());
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);
  mock.method(PosCustomerCredit, 'create', async () => {
    throw new Error('cash must not write credit');
  });

  let customerUpdates = 0;
  let receipts = 0;
  let payments = 0;
  let invoices = 0;
  let memos = 0;
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
  mock.method(Invoice, 'create', async () => {
    invoices += 1;
    throw new Error('Invoice.create must not run');
  });
  mock.method(CreditMemo, 'create', async () => {
    memos += 1;
    throw new Error('CreditMemo.create must not run');
  });

  const res = await postSettle({ refund_method: 'cash' });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(customerUpdates, 0);
  assert.equal(receipts, 0);
  assert.equal(payments, 0);
  assert.equal(invoices, 0);
  assert.equal(memos, 0);
});

test('P — original POSSale financial fields are not written', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture());
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  stubSuccessfulWrites(session);
  mock.method(PosCustomerCredit, 'create', async () => {
    throw new Error('cash must not write credit');
  });

  let saleUpdates = 0;
  mock.method(POSSale, 'findByIdAndUpdate', async () => {
    saleUpdates += 1;
    throw new Error('POSSale must remain immutable');
  });
  mock.method(POSSale, 'findOneAndUpdate', async () => {
    saleUpdates += 1;
    throw new Error('POSSale must remain immutable');
  });

  const res = await postSettle({ refund_method: 'cash' });

  assertNoMongoConnection();
  assert.equal(res.status, 201);
  assert.equal(saleUpdates, 0);
});

test('R — invalid refund method is rejected', async () => {
  assertNoMongoConnection();
  let sessions = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run');
  });

  const res = await postSettle({ refund_method: 'card' });

  assertNoMongoConnection();
  assert.equal(res.status, 400);
  assert.equal(sessions, 0);
});

test('unauthenticated settle follows existing auth', async () => {
  assertNoMongoConnection();
  const res = await request(createApp()).post(`/api/returns/${RETURN_ID}/settle`).send({ refund_method: 'cash' });
  assert.equal(res.status, 401);
});

test('missing return is 404', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => null);
  let sessions = 0;
  mock.method(mongoose, 'startSession', async () => {
    sessions += 1;
    throw new Error('startSession must not run');
  });

  const res = await postSettle({ refund_method: 'cash' });

  assertNoMongoConnection();
  assert.equal(res.status, 404);
  assert.equal(sessions, 0);
});

test('duplicate return_id insert is treated as an idempotent replay', async () => {
  assertNoMongoConnection();
  mock.method(Return, 'findById', async () => returnFixture());
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Return, 'findOneAndUpdate', async () => returnFixture({ settlement_status: 'settled' }));
  mock.method(PosReturnSettlement, 'create', async () => {
    throw Object.assign(new Error('E11000 duplicate key error index: return_id_1'), {
      code: 11000,
      keyPattern: { return_id: 1 },
    });
  });
  mock.method(PosReturnSettlement, 'findOne', async () => settlementFixture());

  const res = await postSettle({ refund_method: 'cash' });

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.equal(res.body.settlement.id, SETTLEMENT_ID);
  assert.equal(session.abortTransaction.mock.callCount(), 1);
  assert.equal(session.commitTransaction.mock.callCount(), 0);
});
