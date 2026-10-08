/**
 * Phase 2G.1-A — customer approval helper and User↔Customer linking.
 *
 * Isolated harness: no Mongo connection, no backfill.
 *
 * Run with:
 *     npx tsx --test src/utils/customerAccount.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import Customer from '../models/Customer';
import User from '../models/User';
import {
  ACCOUNT_STATUS_APPROVED,
  ACCOUNT_STATUS_PENDING,
  accountStatusFromDocument,
  isApprovedAccountStatus,
  isUserLinkedToApprovedCustomer,
  linkOrCreateCustomerForNewUser,
} from './customerAccount';

const USER_ID = '64b0000000000000000a0001';
const CUSTOMER_ID = '64b0000000000000000c0001';
const OTHER_USER_ID = '64b0000000000000000a0002';
const OTHER_CUSTOMER_ID = '64b0000000000000000c0002';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'customer-account tests must not open a MongoDB connection');
}

function oid(id: string) {
  return { toString: () => id, _id: id };
}

test('schema: account_status has no default and is not required', () => {
  const path = Customer.schema.path('account_status') as mongoose.SchemaType & {
    options?: { default?: unknown; required?: unknown; enum?: unknown };
    isRequired?: boolean;
  };
  assert.ok(path);
  assert.equal(path.options?.default, undefined);
  assert.equal(Boolean(path.isRequired), false);
  assert.deepEqual(path.options?.enum, ['pending', 'approved']);

  const doc = new Customer({ name: 'Legacy Co', phone: '5550100' });
  assert.equal(doc.account_status, undefined);
  assert.equal(isApprovedAccountStatus(doc.account_status), false);
});

test('11 — missing account_status is not approved', () => {
  assert.equal(isApprovedAccountStatus(undefined), false);
  assert.equal(isApprovedAccountStatus(null), false);
  assert.equal(isApprovedAccountStatus('pending'), false);
  assert.equal(isApprovedAccountStatus('approved'), true);
  assert.equal(accountStatusFromDocument(undefined), null);
  assert.equal(accountStatusFromDocument('pending'), 'pending');
});

test('12 — no migration / updateMany of account_status in this phase', () => {
  const files = [
    join(__dirname, 'customerAccount.ts'),
    join(__dirname, '../routes/customers.ts'),
    join(__dirname, '../routes/auth.ts'),
    join(__dirname, '../models/Customer.ts'),
  ];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    assert.equal(
      /updateMany\s*\([\s\S]{0,200}account_status|account_status[\s\S]{0,200}updateMany/.test(src),
      false,
      `${file} must not backfill account_status`
    );
  }
});

test('13 — approved User → true', async () => {
  assertNoMongoConnection();
  mock.method(User, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: oid(USER_ID) }),
  }));
  mock.method(Customer, 'findOne', () => ({
    select() {
      return this;
    },
    lean: async () => ({ account_status: ACCOUNT_STATUS_APPROVED }),
  }));
  assert.equal(await isUserLinkedToApprovedCustomer(USER_ID), true);
});

test('14 — pending User → false', async () => {
  assertNoMongoConnection();
  mock.method(User, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: oid(USER_ID) }),
  }));
  mock.method(Customer, 'findOne', () => ({
    select() {
      return this;
    },
    lean: async () => ({ account_status: ACCOUNT_STATUS_PENDING }),
  }));
  assert.equal(await isUserLinkedToApprovedCustomer(USER_ID), false);
});

test('15 — missing Customer link → false', async () => {
  assertNoMongoConnection();
  mock.method(User, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: oid(USER_ID) }),
  }));
  mock.method(Customer, 'findOne', () => ({
    select() {
      return this;
    },
    lean: async () => null,
  }));
  assert.equal(await isUserLinkedToApprovedCustomer(USER_ID), false);
});

test('16 — missing User → false', async () => {
  assertNoMongoConnection();
  mock.method(User, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => null,
  }));
  mock.method(Customer, 'findOne', async () => {
    throw new Error('must not query Customer when User is missing');
  });
  assert.equal(await isUserLinkedToApprovedCustomer(USER_ID), false);
  assert.equal(await isUserLinkedToApprovedCustomer(undefined), false);
  assert.equal(await isUserLinkedToApprovedCustomer('not-an-id'), false);
});

test('helper — historical Customer with no account_status is not approved', async () => {
  assertNoMongoConnection();
  mock.method(User, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: oid(USER_ID) }),
  }));
  mock.method(Customer, 'findOne', () => ({
    select() {
      return this;
    },
    lean: async () => ({ phone: '5550100' }),
  }));
  assert.equal(await isUserLinkedToApprovedCustomer(USER_ID), false);
});

test('7/8/9 — no match creates pending Customer with user_id', async () => {
  assertNoMongoConnection();
  mock.method(Customer, 'find', () => ({ lean: async () => [] }));
  let created: Record<string, unknown> | undefined;
  mock.method(Customer, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return { _id: oid(CUSTOMER_ID), ...doc };
  });

  const result = await linkOrCreateCustomerForNewUser({
    userId: new mongoose.Types.ObjectId(USER_ID),
    name: 'New Dealer',
    email: 'dealer@example.com',
    phone: '5550199',
  });

  assert.equal(result.action, 'created');
  assert.equal(result.customerId, CUSTOMER_ID);
  assert.equal(created?.account_status, ACCOUNT_STATUS_PENDING);
  assert.equal(String(created?.user_id), USER_ID);
  assert.equal(created?.email, 'dealer@example.com');
  assert.notEqual(created?.account_status, ACCOUNT_STATUS_APPROVED);
});

test('10 — exact one unlinked CRM match is linked without changing account_status', async () => {
  assertNoMongoConnection();
  mock.method(Customer, 'find', () => ({
    lean: async () => [
      { _id: new mongoose.Types.ObjectId(CUSTOMER_ID), phone: '5550100', account_status: undefined },
    ],
  }));
  let update: { filter?: unknown; update?: unknown } = {};
  mock.method(Customer, 'updateOne', async (filter: unknown, upd: unknown) => {
    update = { filter, update: upd };
    return { modifiedCount: 1 };
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('must not create a duplicate Customer');
  });

  const result = await linkOrCreateCustomerForNewUser({
    userId: new mongoose.Types.ObjectId(USER_ID),
    phone: '5550100',
  });

  assert.equal(result.action, 'linked');
  assert.equal(result.customerId, CUSTOMER_ID);
  const set = (update.update as { $set?: { user_id?: mongoose.Types.ObjectId } })?.$set;
  assert.equal(String(set?.user_id), USER_ID);
  assert.equal(
    JSON.stringify(update.update).includes('account_status'),
    false,
    'linking must not change account_status'
  );
});

test('10 — email and phone matching different customers stays unlinked', async () => {
  assertNoMongoConnection();
  mock.method(Customer, 'find', (q: { email?: unknown; phone?: unknown }) => ({
    lean: async () => {
      if (q.email) {
        return [{ _id: new mongoose.Types.ObjectId(CUSTOMER_ID), email: 'a@x.com' }];
      }
      return [{ _id: new mongoose.Types.ObjectId(OTHER_CUSTOMER_ID), phone: '5550100' }];
    },
  }));
  mock.method(Customer, 'create', async () => {
    throw new Error('must not create when matching is ambiguous');
  });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not link when matching is ambiguous');
  });

  const result = await linkOrCreateCustomerForNewUser({
    userId: new mongoose.Types.ObjectId(USER_ID),
    email: 'a@x.com',
    phone: '5550100',
  });
  assert.equal(result.action, 'unlinked');
  assert.equal(result.customerId, null);
});

test('10 — already-linked CRM row is not stolen', async () => {
  assertNoMongoConnection();
  mock.method(Customer, 'find', () => ({
    lean: async () => [
      {
        _id: new mongoose.Types.ObjectId(CUSTOMER_ID),
        email: 'taken@x.com',
        user_id: new mongoose.Types.ObjectId(OTHER_USER_ID),
      },
    ],
  }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not overwrite another user_id');
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('must not duplicate an already-linked Customer');
  });

  const result = await linkOrCreateCustomerForNewUser({
    userId: new mongoose.Types.ObjectId(USER_ID),
    email: 'taken@x.com',
  });
  assert.equal(result.action, 'unlinked');
});
