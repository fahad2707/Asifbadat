/**
 * Phase B4.3 — POST /api/packages/labels/pdf
 *
 * ShipmentPackage.find is stubbed. PDF generation uses real bwip-js + PDFKit
 * unless specifically mocked. Not a live Mongo concurrency proof.
 *
 * Run: npx tsx --test src/modules/shipping/routes/packageLabelsPdf.test.ts
 */
import '../../../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../../server';
import ShipmentPackage from '../models/ShipmentPackage';
import Shipment from '../models/Shipment';
import Product from '../../../models/Product';
const PKG_A = '64b0000000000000000f0101';
const PKG_B = '64b0000000000000000f0102';
const CODE_A = 'PKG-AAAA1111BBBB2222';
const CODE_B = 'PKG-CCCC3333DDDD4444';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'B4.3 tests must not open Mongo');
}

function adminToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET required');
  return jwt.sign({ adminId: 'b43-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function userToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET required');
  return jwt.sign({ userId: '64b0000000000000000a0001', phone: '5550100' }, secret, { expiresIn: '8h' });
}

function mockPackages(docs: Record<string, unknown>[]) {
  mock.method(ShipmentPackage, 'find', () => ({
    select: () => ({
      lean: async () => docs,
    }),
  }));
}

test('B4.3 route: unauthenticated and non-admin rejected', async () => {
  assertNoMongoConnection();
  const app = createApp();
  const noAuth = await request(app)
    .post('/api/packages/labels/pdf')
    .send({ items: [{ package_id: PKG_A, quantity: 1 }] });
  assert.equal(noAuth.status, 401);

  const user = await request(app)
    .post('/api/packages/labels/pdf')
    .set('Authorization', `Bearer ${userToken()}`)
    .send({ items: [{ package_id: PKG_A, quantity: 1 }] });
  assert.ok(user.status === 401 || user.status === 403);
  assertNoMongoConnection();
});

test('B4.3 route: valid request returns PDF with stored package_code text', async () => {
  assertNoMongoConnection();
  mockPackages([
    {
      _id: { toString: () => PKG_A },
      package_code: CODE_A,
      shipment_number: 'SH-LBL',
    },
    {
      _id: { toString: () => PKG_B },
      package_code: CODE_B,
      shipment_number: 'SH-LBL',
    },
  ]);

  mock.method(ShipmentPackage, 'create', async () => {
    throw new Error('Printing must not create packages');
  });
  mock.method(Shipment, 'findByIdAndUpdate', async () => {
    throw new Error('Printing must not mutate shipments');
  });
  mock.method(Product, 'findOneAndUpdate', async () => {
    throw new Error('Printing must not update products');
  });

  const res = await request(createApp())
    .post('/api/packages/labels/pdf')
    .set('Authorization', `Bearer ${adminToken()}`)
    .buffer(true)
    .parse((incoming, cb) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
      incoming.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .send({
      items: [
        { package_id: PKG_A, quantity: 2 },
        { package_id: PKG_B, quantity: 1 },
      ],
    });

  assert.equal(res.status, 200);
  assert.match(String(res.headers['content-type'] || ''), /pdf/i);
  assert.match(String(res.headers['content-disposition'] || ''), /package-labels-3\.pdf/i);
  const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
  assert.equal(buf.subarray(0, 4).toString('utf8'), '%PDF');
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  assert.equal(pages, 3);
  // Exact barcode payload / human-readable code equality is covered in packageLabelPdf.test.ts
  // (encodedPayloads === stored package_code). PDFKit may compress page text streams.
  assertNoMongoConnection();
});

test('B4.3 route: unknown and malformed package ids rejected', async () => {
  assertNoMongoConnection();
  const badId = await request(createApp())
    .post('/api/packages/labels/pdf')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ items: [{ package_id: 'not-an-id', quantity: 1 }] });
  assert.equal(badId.status, 400);

  mockPackages([]);
  const missing = await request(createApp())
    .post('/api/packages/labels/pdf')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ items: [{ package_id: PKG_A, quantity: 1 }] });
  assert.equal(missing.status, 404);
  assert.equal(typeof missing.body.stack, 'undefined');
  assertNoMongoConnection();
});

test('B4.3 route: duplicate ids and invalid quantities rejected (no package lookup)', async () => {
  assertNoMongoConnection();
  let findCalls = 0;
  mock.method(ShipmentPackage, 'find', () => {
    findCalls += 1;
    return {
      select: () => ({
        lean: async () => {
          throw new Error('lookup must not run after validation failure');
        },
      }),
    };
  });

  const dup = await request(createApp())
    .post('/api/packages/labels/pdf')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({
      items: [
        { package_id: PKG_A, quantity: 1 },
        { package_id: PKG_A, quantity: 1 },
      ],
    });
  assert.equal(dup.status, 400);
  assert.match(String(dup.body.error || ''), /Duplicate/i);

  for (const quantity of [0, -1, 1.5, 51]) {
    const res = await request(createApp())
      .post('/api/packages/labels/pdf')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ items: [{ package_id: PKG_A, quantity }] });
    assert.equal(res.status, 400, `quantity ${quantity}`);
  }

  const overTotal = await request(createApp())
    .post('/api/packages/labels/pdf')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({
      items: [
        { package_id: PKG_A, quantity: 50 },
        { package_id: PKG_B, quantity: 50 },
        { package_id: '64b0000000000000000f0103', quantity: 50 },
        { package_id: '64b0000000000000000f0104', quantity: 50 },
        { package_id: '64b0000000000000000f0105', quantity: 1 },
      ],
    });
  assert.equal(overTotal.status, 400);
  assert.match(String(overTotal.body.error || ''), /Total labels/i);
  assert.equal(findCalls, 0, 'validation must fail before ShipmentPackage.find');
  assertNoMongoConnection();
});

test('B4.3 route: failed lookup does not return partial PDF', async () => {
  assertNoMongoConnection();
  mock.method(ShipmentPackage, 'find', () => ({
    select: () => ({
      lean: async () => {
        throw new Error('db down');
      },
    }),
  }));

  const res = await request(createApp())
    .post('/api/packages/labels/pdf')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ items: [{ package_id: PKG_A, quantity: 1 }] });

  assert.equal(res.status, 500);
  assert.equal(res.headers['content-type']?.includes('pdf'), false);
  assert.equal(typeof res.body.error, 'string');
  assertNoMongoConnection();
});
