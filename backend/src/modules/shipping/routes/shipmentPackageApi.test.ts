/**
 * Phase B4.2 — package HTTP APIs (admin create/list/lookup).
 *
 * Isolated harness: service layer is exercised via model stubs / route stack.
 * No live Mongo. Concurrent-cap guarantees are covered in the service suite
 * with mocked counts — not a live replica-set race proof.
 *
 * Run: npx tsx --test src/modules/shipping/routes/shipmentPackageApi.test.ts
 */
import '../../../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../../server';
import Shipment from '../models/Shipment';
import ShipmentPackage from '../models/ShipmentPackage';
import Product from '../../../models/Product';
import {
  MAX_PACKAGES_PER_SHIPMENT,
  createPackagesForShipment,
  getPackageByCode,
  listPackagesForShipment,
} from '../services/shipmentPackageService';

const SHIPMENT_ID = '64b0000000000000000d0404';
const ADMIN_ID = '64b0000000000000000a0001';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'B4.2 API tests must not open Mongo');
}

function adminToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET required');
  return jwt.sign({ adminId: ADMIN_ID, role: 'admin' }, secret, { expiresIn: '8h' });
}

function userToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET required');
  return jwt.sign({ userId: ADMIN_ID, phone: '5550100' }, secret, { expiresIn: '8h' });
}

test('POST /api/shipments/:id/packages requires admin auth', async () => {
  assertNoMongoConnection();
  const app = createApp();
  const noAuth = await request(app).post(`/api/shipments/${SHIPMENT_ID}/packages`).send({ count: 1 });
  assert.equal(noAuth.status, 401);

  const user = await request(app)
    .post(`/api/shipments/${SHIPMENT_ID}/packages`)
    .set('Authorization', `Bearer ${userToken()}`)
    .send({ count: 1 });
  assert.ok(user.status === 401 || user.status === 403);
  assertNoMongoConnection();
});

test('POST /api/shipments/:id/packages creates packages', async () => {
  assertNoMongoConnection();
  const session = {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Shipment, 'findOneAndUpdate', async () => ({
    _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
    shipment_number: 'SH-API',
  }));
  mock.method(ShipmentPackage, 'countDocuments', () => ({
    session: async () => 0,
  }));
  mock.method(ShipmentPackage, 'create', async (docs: unknown[]) => {
    const d = (docs as Array<Record<string, unknown>>)[0];
    return [
      {
        _id: new mongoose.Types.ObjectId(),
        package_code: d.package_code,
        shipment_id: d.shipment_id,
        shipment_number: d.shipment_number,
        notes: d.notes,
        created_by: d.created_by,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];
  });
  mock.method(Product, 'findById', async () => {
    throw new Error('Product must not be used');
  });
  mock.method(Product, 'findOne', async () => {
    throw new Error('Product must not be queried');
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    throw new Error('Product must not be updated');
  });

  const res = await request(createApp())
    .post(`/api/shipments/${SHIPMENT_ID}/packages`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ count: 2 });

  assert.equal(res.status, 201);
  assert.equal(res.body.packages.length, 2);
  assert.match(res.body.packages[0].package_code, /^PKG-[0-9A-F]{16}$/);
  assert.equal(res.body.packages[0].shipment_id, SHIPMENT_ID);
  assertNoMongoConnection();
});

test('POST rejects malformed id, bad body, and over-cap request size', async () => {
  assertNoMongoConnection();
  const app = createApp();
  const badId = await request(app)
    .post('/api/shipments/not-valid/packages')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ count: 1 });
  assert.equal(badId.status, 400);

  const empty = await request(app)
    .post(`/api/shipments/${SHIPMENT_ID}/packages`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({});
  assert.equal(empty.status, 400);

  const tooMany = await request(app)
    .post(`/api/shipments/${SHIPMENT_ID}/packages`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ count: MAX_PACKAGES_PER_SHIPMENT + 1 });
  assert.equal(tooMany.status, 400);
  assertNoMongoConnection();
});

test('GET /api/shipments/:id/packages lists packages for shipment only', async () => {
  assertNoMongoConnection();
  mock.method(Shipment, 'findById', () => ({
    select: () => ({
      lean: async () => ({
        _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
        shipment_number: 'SH-LIST',
      }),
    }),
  }));
  mock.method(ShipmentPackage, 'find', (filter: { shipment_id: mongoose.Types.ObjectId }) => {
    assert.equal(String(filter.shipment_id), SHIPMENT_ID);
    return {
      sort: () => ({
        lean: async () => [
          {
            _id: new mongoose.Types.ObjectId(),
            package_code: 'PKG-CCCCCCCCCCCCCCCC',
            shipment_id: new mongoose.Types.ObjectId(SHIPMENT_ID),
            shipment_number: 'SH-LIST',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      }),
    };
  });

  const res = await request(createApp())
    .get(`/api/shipments/${SHIPMENT_ID}/packages`)
    .set('Authorization', `Bearer ${adminToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.packages.length, 1);
  assert.equal(res.body.packages[0].shipment_id, SHIPMENT_ID);
  assertNoMongoConnection();
});

test('GET /api/packages/by-code/:code lookup + auth + unknown', async () => {
  assertNoMongoConnection();
  const app = createApp();

  const unauth = await request(app).get('/api/packages/by-code/PKG-ABCD1234EF567890');
  assert.equal(unauth.status, 401);

  mock.method(ShipmentPackage, 'findOne', () => ({
    lean: async () => null,
  }));
  const missing = await request(app)
    .get('/api/packages/by-code/PKG-ABCD1234EF567890')
    .set('Authorization', `Bearer ${adminToken()}`);
  assert.equal(missing.status, 404);
  assert.equal(typeof missing.body.stack, 'undefined');

  mock.restoreAll();
  mock.method(ShipmentPackage, 'findOne', () => ({
    lean: async () => ({
      _id: new mongoose.Types.ObjectId(),
      package_code: 'PKG-ABCD1234EF567890',
      shipment_id: new mongoose.Types.ObjectId(SHIPMENT_ID),
      shipment_number: 'SH-LOOK',
      notes: 'box',
      created_at: new Date(),
      updated_at: new Date(),
    }),
  }));
  mock.method(Shipment, 'findById', () => ({
    select: () => ({
      lean: async () => ({
        _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
        shipment_number: 'SH-LOOK',
        status: 'DISPATCHED',
      }),
    }),
  }));
  mock.method(Product, 'findOne', async () => {
    throw new Error('Product barcode fallback must not run');
  });

  const ok = await request(app)
    .get('/api/packages/by-code/pkg-abcd1234ef567890')
    .set('Authorization', `Bearer ${adminToken()}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.package_code, 'PKG-ABCD1234EF567890');
  assert.equal(ok.body.shipment.status, 'DISPATCHED');
  assertNoMongoConnection();
});

test('APIs do not expose package reassignment (no shipment_id mutation path)', async () => {
  assertNoMongoConnection();
  // Ownership is set only at create; there is no PATCH/PUT for packages.
  const app = createApp();
  const patch = await request(app)
    .patch(`/api/shipments/${SHIPMENT_ID}/packages`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ shipment_id: '64b0000000000000000d9999' });
  assert.ok(patch.status === 404 || patch.status === 405);

  const put = await request(app)
    .put(`/api/packages/by-code/PKG-ABCD1234EF567890`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ shipment_id: '64b0000000000000000d9999' });
  assert.ok(put.status === 404 || put.status === 405);

  // Touch exported helpers so unused-import lint stays quiet in this intentional contract test.
  assert.equal(typeof createPackagesForShipment, 'function');
  assert.equal(typeof listPackagesForShipment, 'function');
  assert.equal(typeof getPackageByCode, 'function');
  assertNoMongoConnection();
});
