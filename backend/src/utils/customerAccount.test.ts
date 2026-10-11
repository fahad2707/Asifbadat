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
  ACCOUNT_STATUS_REJECTED,
  accountStatusFromDocument,
  didConditionalCustomerLinkSucceed,
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
  assert.deepEqual(path.options?.enum, ['pending', 'approved', 'rejected']);

  const doc = new Customer({ name: 'Legacy Co', phone: '5550100' });
  assert.equal(doc.account_status, undefined);
  assert.equal(isApprovedAccountStatus(doc.account_status), false);
});

test('11 — missing account_status is not approved', () => {
  assert.equal(isApprovedAccountStatus(undefined), false);
  assert.equal(isApprovedAccountStatus(null), false);
  assert.equal(isApprovedAccountStatus('pending'), false);
  assert.equal(isApprovedAccountStatus('rejected'), false);
  assert.equal(isApprovedAccountStatus('approved'), true);
  assert.equal(accountStatusFromDocument(undefined), null);
  assert.equal(accountStatusFromDocument('pending'), 'pending');
  assert.equal(accountStatusFromDocument('rejected'), 'rejected');
  assert.equal(accountStatusFromDocument('approved'), 'approved');
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

test('14b — rejected User → false', async () => {
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
    lean: async () => ({ account_status: ACCOUNT_STATUS_REJECTED }),
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
  assert.deepEqual(result.matchedCustomerIds, []);
  assert.equal(result.matchKind, 'none');
  assert.equal(created?.account_status, ACCOUNT_STATUS_PENDING);
  assert.equal(created?.website_signup, true);
  assert.equal(String(created?.user_id), USER_ID);
  assert.equal(created?.email, 'dealer@example.com');
  assert.notEqual(created?.account_status, ACCOUNT_STATUS_APPROVED);
});

test('F1 — exact one unlinked non-approved CRM match stays unlinked with match hints', async () => {
  assertNoMongoConnection();
  const existing = {
    _id: new mongoose.Types.ObjectId(CUSTOMER_ID),
    phone: '5550100',
    account_status: ACCOUNT_STATUS_PENDING,
    user_id: undefined as undefined,
  };
  mock.method(Customer, 'find', () => ({
    lean: async () => [existing],
  }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not auto-link a non-approved CRM Customer');
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('must not create a duplicate Customer for a CRM match');
  });

  const result = await linkOrCreateCustomerForNewUser({
    userId: new mongoose.Types.ObjectId(USER_ID),
    phone: '5550100',
  });

  assert.equal(result.action, 'unlinked');
  assert.equal(result.customerId, null);
  assert.deepEqual(result.matchedCustomerIds, [CUSTOMER_ID]);
  assert.equal(result.matchKind, 'non_approved_crm');
  assert.equal(existing.account_status, ACCOUNT_STATUS_PENDING);
  assert.equal(existing.user_id, undefined);
});

test('10b — matching approved CRM Customer does not link or change status', async () => {
  assertNoMongoConnection();
  const approved = {
    _id: new mongoose.Types.ObjectId(CUSTOMER_ID),
    phone: '5550100',
    email: 'approved@example.com',
    account_status: ACCOUNT_STATUS_APPROVED,
  };
  mock.method(Customer, 'find', () => ({
    lean: async () => [approved],
  }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not link an approved CRM Customer on signup');
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('must not create a duplicate Customer for an approved CRM match');
  });

  const result = await linkOrCreateCustomerForNewUser({
    userId: new mongoose.Types.ObjectId(USER_ID),
    email: 'approved@example.com',
    phone: '5550100',
  });

  assert.equal(result.action, 'unlinked');
  assert.equal(result.customerId, null);
  assert.deepEqual(result.matchedCustomerIds, [CUSTOMER_ID]);
  assert.equal(result.matchKind, 'approved_crm');
  assert.equal(approved.account_status, ACCOUNT_STATUS_APPROVED);
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
  assert.equal(result.matchedCustomerIds.length, 2);
  assert.ok(result.matchedCustomerIds.includes(CUSTOMER_ID));
  assert.ok(result.matchedCustomerIds.includes(OTHER_CUSTOMER_ID));
  assert.equal(result.matchKind, 'ambiguous');
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
  assert.equal(result.customerId, null);
  assert.deepEqual(result.matchedCustomerIds, [CUSTOMER_ID]);
  assert.equal(result.matchKind, 'already_linked');
});

test('didConditionalCustomerLinkSucceed — matchedCount / modifiedCount semantics', () => {
  assert.equal(didConditionalCustomerLinkSucceed({ matchedCount: 1, modifiedCount: 1 }), true);
  assert.equal(didConditionalCustomerLinkSucceed({ matchedCount: 1, modifiedCount: 0 }), true);
  assert.equal(didConditionalCustomerLinkSucceed({ matchedCount: 0, modifiedCount: 0 }), false);
  assert.equal(didConditionalCustomerLinkSucceed({ modifiedCount: 1 }), true);
  assert.equal(didConditionalCustomerLinkSucceed({ modifiedCount: 0 }), false);
  assert.equal(didConditionalCustomerLinkSucceed({}), false);
});

test('already bound to the same User reports linked without requiring a write', async () => {
  assertNoMongoConnection();
  mock.method(Customer, 'find', () => ({
    lean: async () => [
      {
        _id: new mongoose.Types.ObjectId(CUSTOMER_ID),
        phone: '5550100',
        account_status: ACCOUNT_STATUS_PENDING,
        user_id: new mongoose.Types.ObjectId(USER_ID),
      },
    ],
  }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not update when already bound to the same User');
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('must not create when already bound');
  });

  const result = await linkOrCreateCustomerForNewUser({
    userId: new mongoose.Types.ObjectId(USER_ID),
    phone: '5550100',
  });

  assert.equal(result.action, 'linked');
  assert.equal(result.customerId, CUSTOMER_ID);
  assert.equal(result.matchKind, 'non_approved_crm');
});

test('F1 — rejected CRM match stays unlinked and unchanged', async () => {
  assertNoMongoConnection();
  const existing = {
    _id: new mongoose.Types.ObjectId(CUSTOMER_ID),
    email: 'rejected@example.com',
    account_status: ACCOUNT_STATUS_REJECTED,
  };
  mock.method(Customer, 'find', () => ({ lean: async () => [existing] }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not auto-link a rejected CRM Customer');
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('must not duplicate rejected CRM');
  });

  const result = await linkOrCreateCustomerForNewUser({
    userId: new mongoose.Types.ObjectId(USER_ID),
    email: 'rejected@example.com',
  });

  assert.equal(result.action, 'unlinked');
  assert.equal(result.matchKind, 'non_approved_crm');
  assert.deepEqual(result.matchedCustomerIds, [CUSTOMER_ID]);
  assert.equal(existing.account_status, ACCOUNT_STATUS_REJECTED);
});

test('F1 — historical CRM with missing account_status stays unlinked', async () => {
  assertNoMongoConnection();
  mock.method(Customer, 'find', () => ({
    lean: async () => [{ _id: new mongoose.Types.ObjectId(CUSTOMER_ID), phone: '5550100' }],
  }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not auto-link historical CRM');
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('must not duplicate historical CRM');
  });

  const result = await linkOrCreateCustomerForNewUser({
    userId: new mongoose.Types.ObjectId(USER_ID),
    phone: '5550100',
  });

  assert.equal(result.action, 'unlinked');
  assert.equal(result.matchKind, 'non_approved_crm');
  assert.equal(result.customerId, null);
});
