/**
 * Admin approve/reject: POST /api/admin/website-signup-applications/:id/{approve|reject}
 *
 * Isolated harness: no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/routes/websiteSignupApplicationReview.test.ts
 */
import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import WebsiteSignupApplication from '../models/WebsiteSignupApplication';
import Customer from '../models/Customer';
import User from '../models/User';
import AuditLog from '../models/AuditLog';
import {
  ACCOUNT_STATUS_APPROVED,
  ACCOUNT_STATUS_PENDING,
  ACCOUNT_STATUS_REJECTED,
} from '../utils/customerAccount';

const USER_ID = '64b0000000000000000a0001';
const OTHER_USER_ID = '64b0000000000000000a0002';
const CUSTOMER_ID = '64b0000000000000000c0001';
const APP_ID = '64b0000000000000000b0001';
const ADMIN_ID = '64b0000000000000000d0001';
const OTHER_ADMIN_ID = '64b0000000000000000d0002';
const AUDIT_ID = '64b0000000000000000e0001';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    'website-signup review tests must not open a MongoDB connection'
  );
}

function adminTestToken(adminId = ADMIN_ID): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available');
  return jwt.sign({ adminId, role: 'admin' }, secret, { expiresIn: '8h' });
}

function userTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available');
  return jwt.sign({ userId: USER_ID, phone: '5550100' }, secret, { expiresIn: '8h' });
}

function pendingCreatedApp(overrides: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(APP_ID),
    user_id: new mongoose.Types.ObjectId(USER_ID),
    submitted_name: 'Dealer',
    submitted_email: 'dealer@example.com',
    submitted_phone: '5550199',
    status: 'pending',
    link_outcome: 'created',
    customer_id: new mongoose.Types.ObjectId(CUSTOMER_ID),
    matched_customer_ids: [],
    match_kind: 'none',
    created_at: new Date('2026-10-01T12:00:00.000Z'),
    updated_at: new Date('2026-10-01T12:00:00.000Z'),
    ...overrides,
  };
}

function stubSafeLiveRecords(opts?: {
  customerUserId?: string;
  accountStatus?: string;
  userMissing?: boolean;
  customerMissing?: boolean;
}) {
  mock.method(User, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => (opts?.userMissing ? null : { _id: new mongoose.Types.ObjectId(USER_ID) }),
  }));
  mock.method(Customer, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () =>
      opts?.customerMissing
        ? null
        : {
            _id: new mongoose.Types.ObjectId(CUSTOMER_ID),
            user_id: new mongoose.Types.ObjectId(opts?.customerUserId || USER_ID),
            account_status: opts?.accountStatus ?? ACCOUNT_STATUS_PENDING,
          },
  }));
}

function stubAuditLog(opts?: {
  existing?: boolean;
  createThrows?: boolean;
  createReturnsEmpty?: boolean;
}) {
  const created: Array<Record<string, unknown>> = [];
  const findFilters: Array<Record<string, unknown>> = [];
  mock.method(AuditLog, 'findOne', (filter: Record<string, unknown>) => {
    findFilters.push(filter);
    return {
      select() {
        return this;
      },
      lean: async () =>
        opts?.existing ? { _id: new mongoose.Types.ObjectId(AUDIT_ID) } : null,
    };
  });
  mock.method(AuditLog, 'create', async (doc: Record<string, unknown>) => {
    if (opts?.createThrows) throw new Error('audit write failed');
    if (opts?.createReturnsEmpty) return null;
    const row = { _id: new mongoose.Types.ObjectId(AUDIT_ID), ...doc };
    created.push(row);
    return row;
  });
  return { created, findFilters };
}

function stubAuditLogForbidden() {
  mock.method(AuditLog, 'create', async () => {
    throw new Error('must not write successful-decision audit event');
  });
  mock.method(AuditLog, 'findOne', () => ({
    select() {
      return this;
    },
    lean: async () => {
      throw new Error('must not look up audit for failed decision');
    },
  }));
}

test('unauthenticated approve is rejected', async () => {
  assertNoMongoConnection();
  const res = await request(createApp()).post(
    `/api/admin/website-signup-applications/${APP_ID}/approve`
  );
  assert.equal(res.status, 401);
});

test('storefront user cannot approve', async () => {
  assertNoMongoConnection();
  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${userTestToken()}`);
  assert.equal(res.status, 403);
});

test('safe pending created application can be approved', async () => {
  assertNoMongoConnection();
  const app = pendingCreatedApp();
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => app }));
  stubSafeLiveRecords();
  const audit = stubAuditLog();

  let customerFilter: Record<string, unknown> | undefined;
  let customerUpdate: Record<string, unknown> | undefined;
  mock.method(Customer, 'updateOne', async (filter: Record<string, unknown>, upd: Record<string, unknown>) => {
    customerFilter = filter;
    customerUpdate = upd;
    return { matchedCount: 1, modifiedCount: 1 };
  });

  const approvedDoc = {
    ...app,
    status: 'approved',
    reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
    reviewed_at: new Date('2026-10-11T00:00:00.000Z'),
    review_note: 'ok',
  };
  let appFilter: Record<string, unknown> | undefined;
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', (filter: Record<string, unknown>) => {
    appFilter = filter;
    return { lean: async () => approvedDoc };
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ review_note: 'ok' });

  assert.equal(res.status, 200);
  assert.equal(res.body.application.status, 'approved');
  assert.equal(res.body.application.user_id, USER_ID);
  assert.equal(res.body.application.customer_id, CUSTOMER_ID);
  assert.equal(res.body.application.reviewed_by, ADMIN_ID);
  assert.equal(String(customerFilter?._id), CUSTOMER_ID);
  assert.equal(String(customerFilter?.user_id), USER_ID);
  assert.equal(customerFilter?.account_status, ACCOUNT_STATUS_PENDING);
  assert.equal(
    (customerUpdate?.$set as { account_status?: string })?.account_status,
    ACCOUNT_STATUS_APPROVED
  );
  assert.equal(String(appFilter?._id), APP_ID);
  assert.equal(appFilter?.status, 'pending');
  assert.equal(audit.created.length, 1);
  assert.equal(audit.created[0].action, 'website_signup_approve');
  assert.equal(audit.created[0].entity_type, 'WebsiteSignupApplication');
  assert.equal(audit.created[0].entity_id, APP_ID);
  assert.equal(String(audit.created[0].admin_id), ADMIN_ID);
});

test('missing User fails safely without Customer approval write', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords({ userMissing: true });
  stubAuditLogForbidden();
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not approve Customer when User is missing');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 404);
});

test('missing Customer fails safely', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords({ customerMissing: true });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not approve missing Customer');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 404);
});

test('Customer linked to another User is never approved for this application', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords({ customerUserId: OTHER_USER_ID });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not approve Customer linked to another User');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /not linked/i);
});

test('unlinked approved_crm match is not auto-approved or bound', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () =>
      pendingCreatedApp({
        link_outcome: 'unlinked',
        match_kind: 'approved_crm',
        customer_id: undefined,
        matched_customer_ids: [new mongoose.Types.ObjectId(CUSTOMER_ID)],
      }),
  }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not bind/approve CRM on approved_crm path');
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', async () => {
    throw new Error('must not transition application for CRM match');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /manual identity resolution/i);
});

test('ambiguous match is not auto-approved', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () =>
      pendingCreatedApp({
        link_outcome: 'unlinked',
        match_kind: 'ambiguous',
        customer_id: undefined,
        matched_customer_ids: [
          new mongoose.Types.ObjectId(CUSTOMER_ID),
          new mongoose.Types.ObjectId('64b0000000000000000c0002'),
        ],
      }),
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
});

test('already_linked match is not auto-approved', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () =>
      pendingCreatedApp({
        link_outcome: 'unlinked',
        match_kind: 'already_linked',
        customer_id: undefined,
        matched_customer_ids: [new mongoose.Types.ObjectId(CUSTOMER_ID)],
      }),
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
});

test('legacy non_approved_crm application is not automatically approved', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () =>
      pendingCreatedApp({
        link_outcome: 'linked',
        match_kind: 'non_approved_crm',
        customer_id: new mongoose.Types.ObjectId(CUSTOMER_ID),
      }),
  }));
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not auto-approve legacy non_approved_crm');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /manual identity resolution/i);
});

test('CRM-collision rejection records reviewer without modifying Customer', async () => {
  assertNoMongoConnection();
  const app = pendingCreatedApp({
    link_outcome: 'unlinked',
    match_kind: 'approved_crm',
    customer_id: undefined,
  });
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => app }));
  const audit = stubAuditLog();

  mock.method(Customer, 'updateOne', async () => {
    throw new Error('CRM-collision reject must not modify Customer');
  });
  mock.method(Customer, 'findByIdAndUpdate', async () => {
    throw new Error('CRM-collision reject must not modify Customer');
  });

  const rejected = {
    ...app,
    status: 'rejected',
    reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
    reviewed_at: new Date('2026-10-11T01:00:00.000Z'),
    review_note: 'not this business',
  };
  let filter: Record<string, unknown> | undefined;
  let update: Record<string, unknown> | undefined;
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', (f: Record<string, unknown>, u: Record<string, unknown>) => {
    filter = f;
    update = u;
    return { lean: async () => rejected };
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/reject`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ review_note: 'not this business' });

  assert.equal(res.status, 200);
  assert.equal(res.body.application.status, 'rejected');
  assert.equal(res.body.application.reviewed_by, ADMIN_ID);
  assert.equal(res.body.application.review_note, 'not this business');
  assert.ok(res.body.application.reviewed_at);
  assert.equal(filter?.status, 'pending');
  assert.equal((update?.$set as { status?: string })?.status, 'rejected');
  assert.equal(String((update?.$set as { reviewed_by?: mongoose.Types.ObjectId })?.reviewed_by), ADMIN_ID);
  assert.equal(audit.created.length, 1);
  assert.equal(audit.created[0].action, 'website_signup_reject');
  assert.equal(String(audit.created[0].admin_id), ADMIN_ID);
});

test('safe created rejection marks linked Customer rejected for profile routing', async () => {
  assertNoMongoConnection();
  const app = pendingCreatedApp();
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => app }));
  stubSafeLiveRecords();
  const audit = stubAuditLog();

  const customerWrites: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> =
    [];
  mock.method(Customer, 'updateOne', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    customerWrites.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  });

  const rejected = {
    ...app,
    status: 'rejected',
    reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
    reviewed_at: new Date('2026-10-11T01:05:00.000Z'),
    review_note: 'incomplete',
  };
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => rejected,
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/reject`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ review_note: 'incomplete' });

  assert.equal(res.status, 200);
  assert.equal(res.body.application.status, 'rejected');
  assert.equal(customerWrites.length, 1);
  assert.equal(String(customerWrites[0].filter._id), CUSTOMER_ID);
  assert.equal(String(customerWrites[0].filter.user_id), USER_ID);
  assert.equal(customerWrites[0].filter.account_status, ACCOUNT_STATUS_PENDING);
  assert.equal(
    (customerWrites[0].update.$set as { account_status?: string })?.account_status,
    ACCOUNT_STATUS_REJECTED
  );
  assert.equal(audit.created.length, 1);
  assert.equal(audit.created[0].action, 'website_signup_reject');
});

test('concurrent approvals cannot both win the application transition', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords();
  stubAuditLogForbidden();

  const customerUpdates: Array<{ filter: unknown; update: unknown }> = [];
  mock.method(Customer, 'updateOne', async (filter: unknown, update: unknown) => {
    customerUpdates.push({ filter, update });
    // First call: approve Customer. Second call: compensation revert.
    if (customerUpdates.length === 1) {
      return { matchedCount: 1, modifiedCount: 1 };
    }
    return { matchedCount: 1, modifiedCount: 1 };
  });

  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => null, // concurrent reviewer already took pending→approved
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.equal(customerUpdates.length, 2);
  const compensate = customerUpdates[1].update as { $set?: { account_status?: string } };
  assert.equal(compensate.$set?.account_status, ACCOUNT_STATUS_PENDING);
});

test('concurrent reject loses when application is no longer pending', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords();
  stubAuditLogForbidden();
  const customerStatuses: string[] = [];
  mock.method(Customer, 'updateOne', async (_f: unknown, upd: { $set?: { account_status?: string } }) => {
    customerStatuses.push(String(upd.$set?.account_status));
    return { matchedCount: 1, modifiedCount: 1 };
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => null,
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/reject`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  // Customer pending→rejected then compensated rejected→pending.
  assert.deepEqual(customerStatuses, [ACCOUNT_STATUS_REJECTED, ACCOUNT_STATUS_PENDING]);
});

test('Customer-update failure does not leave application approved', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords();
  stubAuditLogForbidden();
  mock.method(Customer, 'updateOne', async () => ({ matchedCount: 0, modifiedCount: 0 }));
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', async () => {
    throw new Error('must not approve application when Customer update failed');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /Customer approval conflict/i);
});

test('application-transition no-match compensates Customer approval', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords();
  stubAuditLogForbidden();

  const customerWrites: Array<{ filter: Record<string, unknown>; status: string }> = [];
  mock.method(Customer, 'updateOne', async (filter: Record<string, unknown>, upd: { $set?: { account_status?: string } }) => {
    customerWrites.push({ filter, status: String(upd.$set?.account_status) });
    return { matchedCount: 1, modifiedCount: 1 };
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => null,
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /Application approval conflict/i);
  assert.deepEqual(
    customerWrites.map((w) => w.status),
    [ACCOUNT_STATUS_APPROVED, ACCOUNT_STATUS_PENDING]
  );
  assert.equal(String(customerWrites[1].filter._id), CUSTOMER_ID);
  assert.equal(String(customerWrites[1].filter.user_id), USER_ID);
  assert.equal(customerWrites[1].filter.account_status, ACCOUNT_STATUS_APPROVED);
});

test('application-transition throw compensates Customer approval', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords();
  stubAuditLogForbidden();

  const statuses: string[] = [];
  mock.method(Customer, 'updateOne', async (_f: unknown, upd: { $set?: { account_status?: string } }) => {
    statuses.push(String(upd.$set?.account_status));
    return { matchedCount: 1, modifiedCount: 1 };
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => {
      throw new Error('simulated application transition failure');
    },
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 500);
  assert.match(String(res.body.error), /Failed to approve website signup application/i);
  assert.doesNotMatch(String(res.body.error), /Mongo|E11000|simulated/i);
  assert.deepEqual(statuses, [ACCOUNT_STATUS_APPROVED, ACCOUNT_STATUS_PENDING]);
});

test('application no-match and compensation no-match returns recovery-needed error and logs', async () => {
  assertNoMongoConnection();
  const errorLogs: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errorLogs.push(args.map(String).join(' '));
  });

  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords();

  let updateCalls = 0;
  mock.method(Customer, 'updateOne', async () => {
    updateCalls += 1;
    if (updateCalls === 1) return { matchedCount: 1, modifiedCount: 1 };
    return { matchedCount: 0, modifiedCount: 0 };
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => null,
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 500);
  assert.match(String(res.body.error), /requires recovery/i);
  assert.equal(updateCalls, 2);
  const structured = errorLogs.find((line) => line.includes('[website-signup-approval]'));
  assert.ok(structured, 'expected structured approval issue log');
  assert.match(structured!, new RegExp(APP_ID));
  assert.match(structured!, new RegExp(CUSTOMER_ID));
  assert.match(structured!, /failed_no_match/);
  assert.match(structured!, /application_transition_conflict_compensation_failed/);
});

test('application no-match and compensation throw returns recovery-needed error and logs', async () => {
  assertNoMongoConnection();
  const errorLogs: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errorLogs.push(args.map(String).join(' '));
  });

  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords();

  let updateCalls = 0;
  mock.method(Customer, 'updateOne', async () => {
    updateCalls += 1;
    if (updateCalls === 1) return { matchedCount: 1, modifiedCount: 1 };
    throw new Error('simulated compensation failure');
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => null,
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 500);
  assert.match(String(res.body.error), /requires recovery/i);
  assert.doesNotMatch(String(res.body.error), /simulated compensation/i);
  const structured = errorLogs.find((line) => line.includes('[website-signup-approval]'));
  assert.ok(structured);
  assert.match(structured!, /failed_threw/);
  assert.match(structured!, new RegExp(APP_ID));
  assert.match(structured!, new RegExp(CUSTOMER_ID));
});

test('application throw and compensation no-match returns recovery-needed error and logs', async () => {
  assertNoMongoConnection();
  const errorLogs: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errorLogs.push(args.map(String).join(' '));
  });

  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords();

  let updateCalls = 0;
  mock.method(Customer, 'updateOne', async () => {
    updateCalls += 1;
    if (updateCalls === 1) return { matchedCount: 1, modifiedCount: 1 };
    return { matchedCount: 0, modifiedCount: 0 };
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => {
      throw new Error('simulated application transition failure');
    },
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 500);
  assert.match(String(res.body.error), /requires recovery/i);
  const structured = errorLogs.find((line) => line.includes('[website-signup-approval]'));
  assert.ok(structured);
  assert.match(structured!, /application_transition_threw_compensation_failed/);
  assert.match(structured!, /failed_no_match/);
  assert.match(structured!, /simulated application transition failure/);
});

test('application throw and compensation throw returns recovery-needed error and logs', async () => {
  assertNoMongoConnection();
  const errorLogs: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errorLogs.push(args.map(String).join(' '));
  });

  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords();

  let updateCalls = 0;
  mock.method(Customer, 'updateOne', async () => {
    updateCalls += 1;
    if (updateCalls === 1) return { matchedCount: 1, modifiedCount: 1 };
    throw new Error('simulated compensation failure');
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => {
      throw new Error('simulated application transition failure');
    },
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 500);
  assert.match(String(res.body.error), /requires recovery/i);
  const structured = errorLogs.find((line) => line.includes('[website-signup-approval]'));
  assert.ok(structured);
  assert.match(structured!, /application_transition_threw_compensation_failed/);
  assert.match(structured!, /failed_threw/);
});

test('retry after partial approval completes application-only recovery', async () => {
  assertNoMongoConnection();
  const app = pendingCreatedApp();
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => app }));
  stubSafeLiveRecords({ accountStatus: ACCOUNT_STATUS_APPROVED });
  const audit = stubAuditLog();

  mock.method(Customer, 'updateOne', async () => {
    throw new Error('recovery must not modify Customer');
  });

  const approvedDoc = {
    ...app,
    status: 'approved',
    reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
    reviewed_at: new Date('2026-10-11T02:00:00.000Z'),
  };
  let appFilter: Record<string, unknown> | undefined;
  let appUpdate: Record<string, unknown> | undefined;
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', (filter: Record<string, unknown>, upd: Record<string, unknown>) => {
    appFilter = filter;
    appUpdate = upd;
    return { lean: async () => approvedDoc };
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.application.status, 'approved');
  assert.equal(String(appFilter?._id), APP_ID);
  assert.equal(appFilter?.status, 'pending');
  assert.equal((appUpdate?.$set as { status?: string })?.status, 'approved');
  assert.equal(String((appUpdate?.$set as { reviewed_by?: mongoose.Types.ObjectId })?.reviewed_by), ADMIN_ID);
  assert.equal(audit.created.length, 1);
  assert.equal(audit.created[0].action, 'website_signup_approve');
  assert.equal(audit.created[0].entity_id, APP_ID);
});

test('recovery does not approve a differently linked Customer', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords({
    accountStatus: ACCOUNT_STATUS_APPROVED,
    customerUserId: OTHER_USER_ID,
  });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not write Customer on differently-linked recovery attempt');
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', async () => {
    throw new Error('must not transition application when Customer binding differs');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /not linked/i);
});

test('recovery does not approve an unapproved Customer via application-only path', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords({ accountStatus: 'rejected' });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not approve rejected Customer');
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', async () => {
    throw new Error('must not application-only approve when Customer is not approved');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /not in a pending state/i);
});

test('recovery rejects CRM-match identity-resolution cases', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () =>
      pendingCreatedApp({
        link_outcome: 'unlinked',
        match_kind: 'approved_crm',
        customer_id: undefined,
        matched_customer_ids: [new mongoose.Types.ObjectId(CUSTOMER_ID)],
      }),
  }));
  stubSafeLiveRecords({ accountStatus: ACCOUNT_STATUS_APPROVED });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('must not bind CRM on recovery');
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', async () => {
    throw new Error('must not recover CRM-match applications');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /manual identity resolution/i);
});

test('concurrent recovery attempts cannot both win', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords({ accountStatus: ACCOUNT_STATUS_APPROVED });
  stubAuditLogForbidden();

  mock.method(Customer, 'updateOne', async () => {
    throw new Error('recovery path must not modify Customer');
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => null,
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /Application approval conflict/i);
});

test('idempotent re-approve succeeds when application and Customer are already approved', async () => {
  assertNoMongoConnection();
  const app = pendingCreatedApp({
    status: 'approved',
    reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
    reviewed_at: new Date('2026-10-10T00:00:00.000Z'),
  });
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => app }));
  stubSafeLiveRecords({ accountStatus: ACCOUNT_STATUS_APPROVED });
  const audit = stubAuditLog({ existing: true });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('idempotent approve must not rewrite Customer');
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', async () => {
    throw new Error('idempotent approve must not rewrite application');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.application.status, 'approved');
  assert.equal(res.body.application.customer_id, CUSTOMER_ID);
  assert.equal(audit.created.length, 0);
  assert.equal(audit.findFilters.length, 1);
  assert.equal(audit.findFilters[0].action, 'website_signup_approve');
  assert.equal(audit.findFilters[0].entity_id, APP_ID);
});

test('idempotent path conflicts when application approved but Customer is not', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp({ status: 'approved' }),
  }));
  stubSafeLiveRecords({ accountStatus: ACCOUNT_STATUS_PENDING });
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('broken idempotent state must not rewrite Customer');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.match(String(res.body.error), /Customer is not in an approved state/i);
});

test('approve of missing application returns 404', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => null }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 404);
});

test('reject of approved application conflicts', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp({ status: 'approved' }),
  }));
  stubAuditLogForbidden();

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/reject`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
});

test('successful approval audit uses authenticated admin and transition snapshots', async () => {
  assertNoMongoConnection();
  const app = pendingCreatedApp();
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => app }));
  stubSafeLiveRecords();
  const audit = stubAuditLog();
  mock.method(Customer, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 }));
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => ({
      ...app,
      status: 'approved',
      reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
      reviewed_at: new Date('2026-10-11T03:00:00.000Z'),
    }),
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken(OTHER_ADMIN_ID)}`)
    .send({ review_note: 'dealer ok' });

  assert.equal(res.status, 200);
  assert.equal(audit.created.length, 1);
  const event = audit.created[0];
  assert.equal(String(event.admin_id), OTHER_ADMIN_ID);
  assert.equal(event.action, 'website_signup_approve');
  assert.equal(event.entity_type, 'WebsiteSignupApplication');
  assert.equal(event.entity_id, APP_ID);
  assert.equal((event.old_value as { status?: string })?.status, 'pending');
  assert.equal((event.new_value as { status?: string })?.status, 'approved');
  assert.equal((event.new_value as { customer_id?: string })?.customer_id, CUSTOMER_ID);
  assert.equal((event.new_value as { reviewed_by?: string })?.reviewed_by, OTHER_ADMIN_ID);
  assert.match(String(event.details), /dealer ok/);
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'submitted_email'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'submitted_phone'), false);
});

test('successful rejection writes expected audit event', async () => {
  assertNoMongoConnection();
  const app = pendingCreatedApp();
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => app }));
  stubSafeLiveRecords();
  const audit = stubAuditLog();
  mock.method(Customer, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 }));
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => ({
      ...app,
      status: 'rejected',
      reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
      reviewed_at: new Date('2026-10-11T03:30:00.000Z'),
      review_note: 'incomplete paperwork',
    }),
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/reject`)
    .set('Authorization', `Bearer ${adminTestToken()}`)
    .send({ review_note: 'incomplete paperwork' });

  assert.equal(res.status, 200);
  assert.equal(audit.created.length, 1);
  assert.equal(audit.created[0].action, 'website_signup_reject');
  assert.equal(audit.created[0].entity_id, APP_ID);
  assert.equal(String(audit.created[0].admin_id), ADMIN_ID);
  assert.equal((audit.created[0].old_value as { status?: string })?.status, 'pending');
  assert.equal((audit.created[0].new_value as { status?: string })?.status, 'rejected');
  assert.equal((audit.created[0].new_value as { customer_id?: string })?.customer_id, CUSTOMER_ID);
  assert.match(String(audit.created[0].details), /incomplete paperwork/);
});

test('failed application transition does not create successful-decision audit', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () => pendingCreatedApp(),
  }));
  stubSafeLiveRecords();
  const audit = stubAuditLog();
  mock.method(Customer, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 }));
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => null,
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 409);
  assert.equal(audit.created.length, 0);
});

test('idempotent rejection does not duplicate audit event', async () => {
  assertNoMongoConnection();
  mock.method(WebsiteSignupApplication, 'findById', () => ({
    lean: async () =>
      pendingCreatedApp({
        status: 'rejected',
        reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
        reviewed_at: new Date('2026-10-10T00:00:00.000Z'),
        review_note: 'no',
      }),
  }));
  stubSafeLiveRecords({ accountStatus: ACCOUNT_STATUS_REJECTED });
  const audit = stubAuditLog({ existing: true });
  // Repair may attempt pending→rejected; already-rejected Customer yields no match.
  mock.method(Customer, 'updateOne', async () => ({ matchedCount: 0, modifiedCount: 0 }));
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', async () => {
    throw new Error('idempotent reject must not rewrite application');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/reject`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.application.status, 'rejected');
  assert.equal(audit.created.length, 0);
  assert.equal(audit.findFilters[0].action, 'website_signup_reject');
  assert.equal(audit.findFilters[0].entity_id, APP_ID);
});

test('audit insert failure after approval is surfaced without claiming full success', async () => {
  assertNoMongoConnection();
  const errorLogs: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errorLogs.push(args.map(String).join(' '));
  });
  const app = pendingCreatedApp();
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => app }));
  stubSafeLiveRecords();
  stubAuditLog({ createThrows: true });
  mock.method(Customer, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 }));
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => ({
      ...app,
      status: 'approved',
      reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
      reviewed_at: new Date('2026-10-11T04:00:00.000Z'),
    }),
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 500);
  assert.match(String(res.body.error), /approved but audit logging failed/i);
  const structured = errorLogs.find((line) => line.includes('[website-signup-approval]'));
  assert.ok(structured);
  assert.match(structured!, /audit_write_failed_after_approve/);
  assert.match(structured!, new RegExp(APP_ID));
});

test('audit insert unexpected empty result is treated as failure', async () => {
  assertNoMongoConnection();
  const app = pendingCreatedApp();
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => app }));
  stubSafeLiveRecords();
  stubAuditLog({ createReturnsEmpty: true });
  mock.method(Customer, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 }));
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => ({
      ...app,
      status: 'approved',
      reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
      reviewed_at: new Date('2026-10-11T04:10:00.000Z'),
    }),
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 500);
  assert.match(String(res.body.error), /audit logging failed/i);
});

test('retry after audit-write failure repairs missing approve audit without duplicating when present', async () => {
  assertNoMongoConnection();
  const app = pendingCreatedApp({
    status: 'approved',
    reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
    reviewed_at: new Date('2026-10-10T00:00:00.000Z'),
    review_note: 'ok',
  });
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => app }));
  stubSafeLiveRecords({ accountStatus: ACCOUNT_STATUS_APPROVED });
  const audit = stubAuditLog(); // missing → repair create
  mock.method(Customer, 'updateOne', async () => {
    throw new Error('repair must not rewrite Customer');
  });
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', async () => {
    throw new Error('repair must not rewrite application');
  });

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/approve`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 200);
  assert.equal(audit.findFilters.length, 1);
  assert.equal(audit.created.length, 1);
  assert.equal(audit.created[0].action, 'website_signup_approve');
  assert.equal(audit.created[0].entity_id, APP_ID);
  assert.equal(String(audit.created[0].admin_id), ADMIN_ID);
});

test('audit insert failure after rejection is surfaced', async () => {
  assertNoMongoConnection();
  const app = pendingCreatedApp();
  mock.method(WebsiteSignupApplication, 'findById', () => ({ lean: async () => app }));
  stubSafeLiveRecords();
  stubAuditLog({ createThrows: true });
  mock.method(Customer, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 }));
  mock.method(WebsiteSignupApplication, 'findOneAndUpdate', () => ({
    lean: async () => ({
      ...app,
      status: 'rejected',
      reviewed_by: new mongoose.Types.ObjectId(ADMIN_ID),
      reviewed_at: new Date('2026-10-11T04:20:00.000Z'),
    }),
  }));

  const res = await request(createApp())
    .post(`/api/admin/website-signup-applications/${APP_ID}/reject`)
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assert.equal(res.status, 500);
  assert.match(String(res.body.error), /rejected but audit logging failed/i);
});
