/**
 * Phase 2G.1-A — admin approval API, registration link, and write protections.
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/customerApproval.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import nodemailer from 'nodemailer';
import { createApp } from '../server';
import Customer from '../models/Customer';
import User from '../models/User';
import { ACCOUNT_STATUS_APPROVED, ACCOUNT_STATUS_PENDING } from '../utils/customerAccount';

const CUSTOMER_ID = '64b0000000000000000c0001';
const USER_ID = '64b0000000000000000a0001';

const originalSmtpUser = process.env.SMTP_USER;
const originalSmtpPass = process.env.SMTP_PASS;

afterEach(() => {
  mock.restoreAll();
  if (originalSmtpUser === undefined) delete process.env.SMTP_USER;
  else process.env.SMTP_USER = originalSmtpUser;
  if (originalSmtpPass === undefined) delete process.env.SMTP_PASS;
  else process.env.SMTP_PASS = originalSmtpPass;
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'approval tests must not open a MongoDB connection');
}

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '2g1a-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function userTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real user JWT');
  return jwt.sign({ userId: USER_ID, phone: '5550100' }, secret, { expiresIn: '8h' });
}

test('1 — admin POST customer starts pending and ignores body.account_status', async () => {
  assertNoMongoConnection();
  mock.method(Customer, 'findOne', async () => null);
  let created: Record<string, unknown> | undefined;
  mock.method(Customer, 'create', async (doc: Record<string, unknown>) => {
    created = doc;
    return {
      _id: { toString: () => CUSTOMER_ID },
      ...doc,
      toObject: () => ({ _id: CUSTOMER_ID, ...doc }),
    };
  });

  const res = await request(createApp())
    .post('/api/customers')
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({
      name: 'New CRM Co',
      phone: '5550101',
      account_status: 'approved',
    });

  assert.equal(res.status, 201);
  assert.equal(created?.account_status, ACCOUNT_STATUS_PENDING);
});

test('2 — admin can approve', async () => {
  assertNoMongoConnection();
  const customer = {
    _id: { toString: () => CUSTOMER_ID },
    account_status: ACCOUNT_STATUS_PENDING,
    is_active: true,
    save: async function save() {
      return this;
    },
  };
  mock.method(Customer, 'findById', async () => customer);

  const res = await request(createApp())
    .put(`/api/customers/${CUSTOMER_ID}/account-status`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ account_status: ACCOUNT_STATUS_APPROVED });

  assert.equal(res.status, 200);
  assert.equal(res.body.account_status, ACCOUNT_STATUS_APPROVED);
  assert.equal(customer.account_status, ACCOUNT_STATUS_APPROVED);
  assert.equal(customer.is_active, true);
});

test('3 — admin can revoke to pending', async () => {
  assertNoMongoConnection();
  const customer = {
    _id: { toString: () => CUSTOMER_ID },
    account_status: ACCOUNT_STATUS_APPROVED,
    is_active: true,
    save: async function save() {
      return this;
    },
  };
  mock.method(Customer, 'findById', async () => customer);

  const res = await request(createApp())
    .put(`/api/customers/${CUSTOMER_ID}/account-status`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ account_status: ACCOUNT_STATUS_PENDING });

  assert.equal(res.status, 200);
  assert.equal(res.body.account_status, ACCOUNT_STATUS_PENDING);
});

test('4 — normal user cannot change approval', async () => {
  assertNoMongoConnection();
  mock.method(Customer, 'findById', async () => {
    throw new Error('must not load Customer for a non-admin');
  });

  const res = await request(createApp())
    .put(`/api/customers/${CUSTOMER_ID}/account-status`)
    .set('Authorization', `Bearer ${userTestToken()}`)
    .send({ account_status: ACCOUNT_STATUS_APPROVED });

  assert.equal(res.status, 403);
});

test('5 — guest cannot change approval', async () => {
  assertNoMongoConnection();
  mock.method(Customer, 'findById', async () => {
    throw new Error('must not load Customer for a guest');
  });

  const res = await request(createApp())
    .put(`/api/customers/${CUSTOMER_ID}/account-status`)
    .send({ account_status: ACCOUNT_STATUS_APPROVED });

  assert.equal(res.status, 401);
});

test('6 — is_active remains independent of approval', async () => {
  assertNoMongoConnection();
  let updated: Record<string, unknown> | undefined;
  mock.method(Customer, 'findByIdAndUpdate', async (_id: string, data: Record<string, unknown>) => {
    updated = data;
    return {
      _id: { toString: () => CUSTOMER_ID },
      is_active: false,
      account_status: ACCOUNT_STATUS_APPROVED,
      toObject: () => ({ is_active: false, account_status: ACCOUNT_STATUS_APPROVED }),
    };
  });

  const res = await request(createApp())
    .put(`/api/customers/${CUSTOMER_ID}`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ is_active: false, account_status: 'pending' });

  assert.equal(res.status, 200);
  assert.equal(updated?.is_active, false);
  assert.equal('account_status' in (updated || {}), false);
  assert.equal(res.body.account_status, ACCOUNT_STATUS_APPROVED);
});

test('11 — GET existing customer with no account_status is not approved', async () => {
  assertNoMongoConnection();
  mock.method(Customer, 'findById', () => ({
    lean: async () => ({
      _id: { toString: () => CUSTOMER_ID },
      name: 'Historical Co',
      phone: '5550100',
      is_active: true,
    }),
  }));

  const res = await request(createApp())
    .get(`/api/customers/${CUSTOMER_ID}`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.account_status, null);
  assert.equal(res.body.is_active, true);
});

test('7/8/9 — registration creates pending Customer linked to User', async () => {
  assertNoMongoConnection();
  mock.method(User, 'findOne', async () => null);
  mock.method(User, 'create', async (doc: Record<string, unknown>) => ({
    _id: new mongoose.Types.ObjectId(USER_ID),
    ...doc,
  }));
  mock.method(Customer, 'find', () => ({ lean: async () => [] }));
  let createdCustomer: Record<string, unknown> | undefined;
  mock.method(Customer, 'create', async (doc: Record<string, unknown>) => {
    createdCustomer = doc;
    return { _id: { toString: () => CUSTOMER_ID }, ...doc };
  });

  const res = await request(createApp())
    .post('/api/auth/register')
    .send({
      name: 'Storefront User',
      email: `approval-${Date.now()}@example.com`,
      phone: '5550188',
      password: 'password12',
    });

  assert.equal(res.status, 201);
  if (res.body.token) {
    assert.equal(res.body.user.id, USER_ID);
  }
  assert.equal(createdCustomer?.account_status, ACCOUNT_STATUS_PENDING);
  assert.equal(String(createdCustomer?.user_id), USER_ID);
  assert.notEqual(createdCustomer?.account_status, ACCOUNT_STATUS_APPROVED);
});

const OTHER_CUSTOMER_ID = '64b0000000000000000c0002';

function stubRegisterUserCreate() {
  mock.method(User, 'findOne', async () => null);
  mock.method(User, 'create', async (doc: Record<string, unknown>) => ({
    _id: new mongoose.Types.ObjectId(USER_ID),
    ...doc,
  }));
}

function stubVerificationEmailFailure() {
  process.env.SMTP_USER = 'smtp-test@example.com';
  process.env.SMTP_PASS = 'smtp-test-pass';
  mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async () => {
      throw new Error('smtp down');
    },
  }));
}

test('email failure after linked CRM Customer unsets user_id and does not delete Customer', async () => {
  assertNoMongoConnection();
  stubVerificationEmailFailure();
  stubRegisterUserCreate();

  const existing = {
    _id: new mongoose.Types.ObjectId(CUSTOMER_ID),
    phone: '5550177',
    email: 'linked-crm@example.com',
    account_status: ACCOUNT_STATUS_APPROVED,
    is_active: true,
    deleted: false,
  };
  mock.method(Customer, 'find', () => ({
    lean: async () => [{ _id: existing._id, phone: existing.phone, email: existing.email }],
  }));
  mock.method(Customer, 'create', async () => {
    throw new Error('must not create a Customer when linking existing CRM');
  });

  const updateOnes: Array<{ filter: unknown; update: unknown }> = [];
  mock.method(Customer, 'updateOne', async (filter: unknown, update: unknown) => {
    updateOnes.push({ filter, update });
    return { modifiedCount: 1 };
  });
  mock.method(Customer, 'deleteOne', async () => {
    existing.deleted = true;
    throw new Error('must not delete an existing CRM Customer');
  });

  let userDeleted = false;
  mock.method(User, 'findByIdAndDelete', async () => {
    userDeleted = true;
    return { _id: USER_ID };
  });

  const res = await request(createApp())
    .post('/api/auth/register')
    .send({
      name: 'Linked User',
      email: 'linked-crm@example.com',
      phone: '5550177',
      password: 'password12',
    });

  assert.equal(res.status, 500);
  assert.match(String(res.body.error), /verification email/i);
  assert.equal(userDeleted, true);
  assert.equal(existing.deleted, false);
  assert.equal(existing.account_status, ACCOUNT_STATUS_APPROVED);
  assert.equal(existing.is_active, true);

  const unsetCall = updateOnes.find((c) => {
    const upd = c.update as { $unset?: { user_id?: number } };
    return upd.$unset?.user_id === 1;
  });
  assert.ok(unsetCall, 'email failure after link must $unset user_id');
  assert.equal(JSON.stringify(unsetCall?.update).includes('account_status'), false);
  assert.equal(JSON.stringify(unsetCall?.update).includes('is_active'), false);
});

test('email failure after created Customer deletes that Customer and the User', async () => {
  assertNoMongoConnection();
  stubVerificationEmailFailure();
  stubRegisterUserCreate();
  mock.method(Customer, 'find', () => ({ lean: async () => [] }));
  mock.method(Customer, 'create', async (doc: Record<string, unknown>) => ({
    _id: { toString: () => CUSTOMER_ID },
    ...doc,
  }));

  let deletedCustomerFilter: unknown;
  mock.method(Customer, 'deleteOne', async (filter: unknown) => {
    deletedCustomerFilter = filter;
    return { deletedCount: 1 };
  });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not $unset on a Customer created by this registration');
  });

  let userDeleted = false;
  mock.method(User, 'findByIdAndDelete', async () => {
    userDeleted = true;
    return { _id: USER_ID };
  });

  const res = await request(createApp())
    .post('/api/auth/register')
    .send({
      name: 'New User',
      email: 'created-crm@example.com',
      phone: '5550178',
      password: 'password12',
    });

  assert.equal(res.status, 500);
  assert.match(String(res.body.error), /verification email/i);
  assert.equal(userDeleted, true);
  assert.equal(String((deletedCustomerFilter as { user_id?: { toString(): string } }).user_id), USER_ID);
});

test('email failure after unlinked match deletes User and does not modify Customer', async () => {
  assertNoMongoConnection();
  stubVerificationEmailFailure();
  stubRegisterUserCreate();
  mock.method(Customer, 'find', (q: { email?: unknown; phone?: unknown }) => ({
    lean: async () => {
      if (q.email) {
        return [{ _id: new mongoose.Types.ObjectId(CUSTOMER_ID), email: 'a@x.com' }];
      }
      return [{ _id: new mongoose.Types.ObjectId(OTHER_CUSTOMER_ID), phone: '5550179' }];
    },
  }));
  mock.method(Customer, 'create', async () => {
    throw new Error('must not create when matching is ambiguous');
  });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not modify Customer when unlinked');
  });
  mock.method(Customer, 'deleteOne', async () => {
    throw new Error('must not delete Customer when unlinked');
  });

  let userDeleted = false;
  mock.method(User, 'findByIdAndDelete', async () => {
    userDeleted = true;
    return { _id: USER_ID };
  });

  const res = await request(createApp())
    .post('/api/auth/register')
    .send({
      name: 'Ambiguous User',
      email: 'a@x.com',
      phone: '5550179',
      password: 'password12',
    });

  assert.equal(res.status, 500);
  assert.match(String(res.body.error), /verification email/i);
  assert.equal(userDeleted, true);
});
