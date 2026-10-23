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
import WebsiteSignupApplication, {
  WEBSITE_SIGNUP_STATUS_PENDING,
} from '../models/WebsiteSignupApplication';
import {
  ACCOUNT_STATUS_APPROVED,
  ACCOUNT_STATUS_PENDING,
  ACCOUNT_STATUS_REJECTED,
} from '../utils/customerAccount';

const CUSTOMER_ID = '64b0000000000000000c0001';
const USER_ID = '64b0000000000000000a0001';
const OTHER_USER_ID = '64b0000000000000000a0002';
const OTHER_CUSTOMER_ID = '64b0000000000000000c0002';
const APP_ID = '64b0000000000000000b0001';

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

test('2b — admin can reject and re-approve', async () => {
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

  const reject = await request(createApp())
    .put(`/api/customers/${CUSTOMER_ID}/account-status`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ account_status: ACCOUNT_STATUS_REJECTED });
  assert.equal(reject.status, 200);
  assert.equal(reject.body.account_status, ACCOUNT_STATUS_REJECTED);
  assert.equal(customer.account_status, ACCOUNT_STATUS_REJECTED);

  const approve = await request(createApp())
    .put(`/api/customers/${CUSTOMER_ID}/account-status`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ account_status: ACCOUNT_STATUS_APPROVED });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.account_status, ACCOUNT_STATUS_APPROVED);
});

test('2c — invalid account_status is rejected', async () => {
  assertNoMongoConnection();
  mock.method(Customer, 'findById', async () => {
    throw new Error('must not load customer for invalid status');
  });
  const res = await request(createApp())
    .put(`/api/customers/${CUSTOMER_ID}/account-status`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ account_status: 'active' });
  assert.equal(res.status, 400);
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

type AppStore = {
  created: Record<string, unknown>[];
  deletedUserIds: string[];
};

function stubWebsiteSignupApplication(opts?: {
  onCreate?: (doc: Record<string, unknown>) => Promise<unknown> | unknown;
}): AppStore {
  const store: AppStore = { created: [], deletedUserIds: [] };
  mock.method(WebsiteSignupApplication, 'create', async (doc: Record<string, unknown>) => {
    if (opts?.onCreate) return opts.onCreate(doc);
    store.created.push(doc);
    return { _id: { toString: () => APP_ID }, ...doc };
  });
  mock.method(WebsiteSignupApplication, 'deleteOne', async (filter: { user_id?: mongoose.Types.ObjectId }) => {
    store.deletedUserIds.push(String(filter.user_id));
    return { deletedCount: 1 };
  });
  return store;
}

function stubRegisterUserCreate() {
  mock.method(User, 'findOne', async () => null);
  mock.method(User, 'create', async (doc: Record<string, unknown>) => ({
    _id: new mongoose.Types.ObjectId(USER_ID),
    ...doc,
    save: async function save() {
      return this;
    },
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

test('7/8/9 — registration creates pending Customer and one pending application', async () => {
  assertNoMongoConnection();
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  stubRegisterUserCreate();
  const apps = stubWebsiteSignupApplication();
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
  assert.equal(createdCustomer?.website_signup, true);
  assert.equal(String(createdCustomer?.user_id), USER_ID);
  assert.notEqual(createdCustomer?.account_status, ACCOUNT_STATUS_APPROVED);
  assert.equal(apps.created.length, 1);
  assert.equal(apps.created[0].status, WEBSITE_SIGNUP_STATUS_PENDING);
  assert.equal(apps.created[0].link_outcome, 'created');
  assert.equal(apps.created[0].match_kind, 'none');
  assert.equal(String(apps.created[0].customer_id), CUSTOMER_ID);
  assert.equal(String(apps.created[0].user_id), USER_ID);
  assert.deepEqual(apps.created[0].matched_customer_ids, []);
});

test('register matching approved CRM creates application and leaves CRM unchanged', async () => {
  assertNoMongoConnection();
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  stubRegisterUserCreate();
  const apps = stubWebsiteSignupApplication();

  const existing = {
    _id: new mongoose.Types.ObjectId(CUSTOMER_ID),
    phone: '5550177',
    email: 'approved-crm@example.com',
    account_status: ACCOUNT_STATUS_APPROVED,
    user_id: undefined as mongoose.Types.ObjectId | undefined,
  };
  mock.method(Customer, 'find', () => ({
    lean: async () => [
      {
        _id: existing._id,
        phone: existing.phone,
        email: existing.email,
        account_status: existing.account_status,
      },
    ],
  }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not link approved CRM on website signup');
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('must not duplicate approved CRM Customer');
  });

  const res = await request(createApp())
    .post('/api/auth/register')
    .send({
      name: 'New Signup',
      email: 'approved-crm@example.com',
      phone: '5550177',
      password: 'password12',
    });

  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(existing.account_status, ACCOUNT_STATUS_APPROVED);
  assert.equal(existing.user_id, undefined);
  assert.equal(apps.created.length, 1);
  assert.equal(apps.created[0].status, WEBSITE_SIGNUP_STATUS_PENDING);
  assert.equal(apps.created[0].link_outcome, 'unlinked');
  assert.equal(apps.created[0].match_kind, 'approved_crm');
  assert.equal(apps.created[0].customer_id, undefined);
  assert.equal(String((apps.created[0].matched_customer_ids as mongoose.Types.ObjectId[])[0]), CUSTOMER_ID);
});

test('register matching already-linked CRM does not reassign and records application', async () => {
  assertNoMongoConnection();
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  stubRegisterUserCreate();
  const apps = stubWebsiteSignupApplication();

  mock.method(Customer, 'find', () => ({
    lean: async () => [
      {
        _id: new mongoose.Types.ObjectId(CUSTOMER_ID),
        email: 'taken@example.com',
        user_id: new mongoose.Types.ObjectId(OTHER_USER_ID),
        account_status: ACCOUNT_STATUS_APPROVED,
      },
    ],
  }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not overwrite another user_id');
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('must not duplicate an already-linked Customer');
  });

  const res = await request(createApp())
    .post('/api/auth/register')
    .send({
      name: 'Collision User',
      email: 'taken@example.com',
      phone: '5550180',
      password: 'password12',
    });

  assert.equal(res.status, 201);
  assert.equal(apps.created.length, 1);
  assert.equal(apps.created[0].link_outcome, 'unlinked');
  assert.equal(apps.created[0].match_kind, 'already_linked');
  assert.equal(String((apps.created[0].matched_customer_ids as mongoose.Types.ObjectId[])[0]), CUSTOMER_ID);
});

test('register with ambiguous CRM matches records all IDs and stays unlinked', async () => {
  assertNoMongoConnection();
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  stubRegisterUserCreate();
  const apps = stubWebsiteSignupApplication();

  mock.method(Customer, 'find', (q: { email?: unknown; phone?: unknown }) => ({
    lean: async () => {
      if (q.email) {
        return [{ _id: new mongoose.Types.ObjectId(CUSTOMER_ID), email: 'a@x.com' }];
      }
      return [{ _id: new mongoose.Types.ObjectId(OTHER_CUSTOMER_ID), phone: '5550181' }];
    },
  }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not link when matching is ambiguous');
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('must not create when matching is ambiguous');
  });

  const res = await request(createApp())
    .post('/api/auth/register')
    .send({
      name: 'Ambiguous Signup',
      email: 'a@x.com',
      phone: '5550181',
      password: 'password12',
    });

  assert.equal(res.status, 201);
  assert.equal(apps.created.length, 1);
  assert.equal(apps.created[0].link_outcome, 'unlinked');
  assert.equal(apps.created[0].match_kind, 'ambiguous');
  const ids = (apps.created[0].matched_customer_ids as mongoose.Types.ObjectId[]).map(String);
  assert.equal(ids.length, 2);
  assert.ok(ids.includes(CUSTOMER_ID));
  assert.ok(ids.includes(OTHER_CUSTOMER_ID));
});

test('register matching non-approved unlinked CRM stays unlinked and records application hints', async () => {
  assertNoMongoConnection();
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  stubRegisterUserCreate();
  const apps = stubWebsiteSignupApplication();

  const existing = {
    _id: new mongoose.Types.ObjectId(CUSTOMER_ID),
    phone: '5550182',
    account_status: ACCOUNT_STATUS_PENDING,
    user_id: undefined as undefined,
  };
  mock.method(Customer, 'find', () => ({
    lean: async () => [
      {
        _id: existing._id,
        phone: existing.phone,
        account_status: existing.account_status,
      },
    ],
  }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not auto-link non-approved CRM on website signup');
  });
  mock.method(Customer, 'create', async () => {
    throw new Error('must not create a duplicate Customer for a CRM match');
  });

  const res = await request(createApp())
    .post('/api/auth/register')
    .send({
      name: 'Pending CRM Claim',
      email: 'pending-crm@example.com',
      phone: '5550182',
      password: 'password12',
    });

  assert.equal(res.status, 201);
  assert.equal(existing.account_status, ACCOUNT_STATUS_PENDING);
  assert.equal(existing.user_id, undefined);
  assert.equal(apps.created.length, 1);
  assert.equal(apps.created[0].link_outcome, 'unlinked');
  assert.equal(apps.created[0].match_kind, 'non_approved_crm');
  assert.equal(apps.created[0].customer_id, undefined);
  assert.equal(String((apps.created[0].matched_customer_ids as mongoose.Types.ObjectId[])[0]), CUSTOMER_ID);
});

test('email failure after unlinked non-approved CRM match still completes registration', async () => {
  assertNoMongoConnection();
  stubVerificationEmailFailure();
  stubRegisterUserCreate();
  const apps = stubWebsiteSignupApplication();

  const existing = {
    _id: new mongoose.Types.ObjectId(CUSTOMER_ID),
    phone: '5550177',
    email: 'linked-crm@example.com',
    account_status: ACCOUNT_STATUS_PENDING,
    is_active: true,
    deleted: false,
  };
  mock.method(Customer, 'find', () => ({
    lean: async () => [
      {
        _id: existing._id,
        phone: existing.phone,
        email: existing.email,
        account_status: existing.account_status,
      },
    ],
  }));
  mock.method(Customer, 'create', async () => {
    throw new Error('must not create a Customer for non-approved CRM match');
  });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not modify CRM when registration left User unlinked');
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
      name: 'Unlinked Match User',
      email: 'linked-crm@example.com',
      phone: '5550177',
      password: 'password12',
    });

  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(userDeleted, false);
  assert.equal(existing.deleted, false);
  assert.equal(existing.account_status, ACCOUNT_STATUS_PENDING);
  assert.equal(existing.is_active, true);
  assert.equal(apps.created.length, 1);
  assert.equal(apps.created[0].link_outcome, 'unlinked');
  assert.equal(apps.created[0].match_kind, 'non_approved_crm');
  assert.deepEqual(apps.deletedUserIds, []);
});

test('email failure after created Customer still completes registration', async () => {
  assertNoMongoConnection();
  stubVerificationEmailFailure();
  stubRegisterUserCreate();
  const apps = stubWebsiteSignupApplication();
  mock.method(Customer, 'find', () => ({ lean: async () => [] }));
  mock.method(Customer, 'create', async (doc: Record<string, unknown>) => ({
    _id: { toString: () => CUSTOMER_ID },
    ...doc,
  }));

  mock.method(Customer, 'deleteOne', async () => {
    throw new Error('must not roll back Customer after SMTP failure');
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

  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(userDeleted, false);
  assert.equal(apps.created.length, 1);
  assert.deepEqual(apps.deletedUserIds, []);
});

test('email failure after unlinked match still completes registration', async () => {
  assertNoMongoConnection();
  stubVerificationEmailFailure();
  stubRegisterUserCreate();
  const apps = stubWebsiteSignupApplication();
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

  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(userDeleted, false);
  assert.equal(apps.created.length, 1);
  assert.deepEqual(apps.deletedUserIds, []);
});

test('application insert failure rolls back User/Customer and does not succeed', async () => {
  assertNoMongoConnection();
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  stubRegisterUserCreate();
  stubWebsiteSignupApplication({
    onCreate: async () => {
      throw new Error('application insert failed');
    },
  });
  mock.method(Customer, 'find', () => ({ lean: async () => [] }));
  mock.method(Customer, 'create', async (doc: Record<string, unknown>) => ({
    _id: { toString: () => CUSTOMER_ID },
    ...doc,
  }));

  let deletedCustomer = false;
  mock.method(Customer, 'deleteOne', async () => {
    deletedCustomer = true;
    return { deletedCount: 1 };
  });
  let userDeleted = false;
  mock.method(User, 'findByIdAndDelete', async () => {
    userDeleted = true;
    return { _id: USER_ID };
  });

  const res = await request(createApp())
    .post('/api/auth/register')
    .send({
      name: 'App Fail',
      email: 'app-fail@example.com',
      phone: '5550183',
      password: 'password12',
    });

  assert.equal(res.status, 500);
  assert.equal(userDeleted, true);
  assert.equal(deletedCustomer, true);
  assert.equal(res.body.token, undefined);
});

test('duplicate application for same User fails registration safely', async () => {
  assertNoMongoConnection();
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  stubRegisterUserCreate();
  stubWebsiteSignupApplication({
    onCreate: async () => {
      throw Object.assign(new Error('E11000 duplicate key error index: user_id_1'), {
        code: 11000,
        keyPattern: { user_id: 1 },
      });
    },
  });
  mock.method(Customer, 'find', () => ({ lean: async () => [] }));
  mock.method(Customer, 'create', async (doc: Record<string, unknown>) => ({
    _id: { toString: () => CUSTOMER_ID },
    ...doc,
  }));
  mock.method(Customer, 'deleteOne', async () => ({ deletedCount: 1 }));
  let userDeleted = false;
  mock.method(User, 'findByIdAndDelete', async () => {
    userDeleted = true;
    return { _id: USER_ID };
  });

  const res = await request(createApp())
    .post('/api/auth/register')
    .send({
      name: 'Dup App',
      email: 'dup-app@example.com',
      phone: '5550184',
      password: 'password12',
    });

  assert.equal(res.status, 500);
  assert.equal(userDeleted, true);
  assert.equal(res.body.token, undefined);
});

test('website-signups queue lists only website_signup Customers', async () => {
  assertNoMongoConnection();
  let findQuery: Record<string, unknown> | undefined;
  mock.method(Customer, 'find', (q: Record<string, unknown>) => {
    findQuery = q;
    return {
      sort() {
        return this;
      },
      skip() {
        return this;
      },
      limit() {
        return this;
      },
      lean: async () => [
        {
          _id: { toString: () => CUSTOMER_ID },
          name: 'Web Signup',
          phone: '5550190',
          email: 'web@example.com',
          user_id: new mongoose.Types.ObjectId(USER_ID),
          account_status: ACCOUNT_STATUS_PENDING,
          website_signup: true,
          created_at: new Date(),
        },
      ],
    };
  });
  mock.method(Customer, 'countDocuments', async () => 1);
  mock.method(User, 'find', () => ({
    select() {
      return this;
    },
    lean: async () => [
      {
        _id: new mongoose.Types.ObjectId(USER_ID),
        name: 'Web User',
        email: 'web@example.com',
        phone: '5550190',
        email_verified: true,
      },
    ],
  }));

  const res = await request(createApp())
    .get('/api/customers/website-signups')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(findQuery?.website_signup, true);
  assert.equal(res.body.signups.length, 1);
  assert.equal(res.body.signups[0].website_signup, true);
  assert.equal(res.body.signups[0].account_status, ACCOUNT_STATUS_PENDING);
  assert.equal(res.body.signups[0].user?.email, 'web@example.com');
});

test('website-signups queue requires admin auth', async () => {
  assertNoMongoConnection();
  const res = await request(createApp()).get('/api/customers/website-signups');
  assert.equal(res.status, 401);
});

test('admin-created CRM customers are not website_signup', async () => {
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
    .send({ name: 'CRM Only', phone: '5550191' });

  assert.equal(res.status, 201);
  assert.equal(created?.account_status, ACCOUNT_STATUS_PENDING);
  assert.notEqual(created?.website_signup, true);
});
