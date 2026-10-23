/**
 * Phase B4.2 / B4.2-R1 — shipment package service (create/list/lookup helpers).
 *
 * Isolated harness: Mongo session + model methods are stubbed.
 * Concurrent package-cap and transaction-abort behavior are simulated via
 * mocks only — these tests do NOT prove live MongoDB replica-set semantics.
 *
 * Run: npx tsx --test src/modules/shipping/services/shipmentPackageService.test.ts
 */
import '../../../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import mongoose from 'mongoose';
import Shipment from '../models/Shipment';
import ShipmentPackage from '../models/ShipmentPackage';
import Product from '../../../models/Product';
import {
  MAX_PACKAGES_PER_SHIPMENT,
  PACKAGE_CODE_TXN_RESTARTS,
  PackageServiceError,
  createPackagesForShipment,
  getPackageByCode,
  listPackagesForShipment,
  resolvePackageCreateSpecs,
} from './shipmentPackageService';

const SHIPMENT_ID = '64b0000000000000000d0202';
const ADMIN_ID = '64b0000000000000000a0001';
const OTHER_SHIPMENT = '64b0000000000000000d0303';

afterEach(() => {
  mock.restoreAll();
});

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'B4.2 service tests must not open Mongo');
}

function createFakeSession() {
  return {
    startTransaction: mock.fn(),
    commitTransaction: mock.fn(async () => {}),
    abortTransaction: mock.fn(async () => {}),
    endSession: mock.fn(),
  };
}

function mockSession() {
  const session = createFakeSession();
  mock.method(mongoose, 'startSession', async () => session);
  return session;
}

function packageDoc(overrides: Record<string, unknown> = {}) {
  const id = new mongoose.Types.ObjectId();
  return {
    _id: id,
    package_code: 'PKG-ABCD1234EF567890',
    shipment_id: new mongoose.Types.ObjectId(SHIPMENT_ID),
    shipment_number: 'SH-PKG1',
    notes: undefined,
    created_by: new mongoose.Types.ObjectId(ADMIN_ID),
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

test('resolvePackageCreateSpecs accepts count or packages, rejects empty/invalid', () => {
  assert.equal(resolvePackageCreateSpecs({ count: 2 }).length, 2);
  assert.deepEqual(resolvePackageCreateSpecs({ packages: [{ notes: ' fragile ' }] }), [
    { notes: 'fragile' },
  ]);
  assert.throws(() => resolvePackageCreateSpecs({}), /count or packages/);
  assert.throws(() => resolvePackageCreateSpecs({ count: 0 }), /count must be/);
  assert.throws(() => resolvePackageCreateSpecs({ count: 101 }), /count must be/);
  assert.throws(() => resolvePackageCreateSpecs({ packages: [] }), /non-empty/);
  assert.throws(
    () => resolvePackageCreateSpecs({ count: 1, packages: [{}] }),
    /either count or packages/
  );
});

test('createPackagesForShipment succeeds and returns PKG codes (mock session)', async () => {
  assertNoMongoConnection();
  const session = mockSession();
  mock.method(Shipment, 'findOneAndUpdate', async () => ({
    _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
    shipment_number: 'SH-PKG1',
  }));
  mock.method(ShipmentPackage, 'countDocuments', () => ({
    session: async () => 0,
  }));
  let createCalls = 0;
  mock.method(ShipmentPackage, 'create', async (docs: unknown[]) => {
    createCalls += 1;
    const d = (docs as Array<Record<string, unknown>>)[0];
    assert.equal(String(d.shipment_id), SHIPMENT_ID);
    assert.match(String(d.package_code), /^PKG-[0-9A-F]{16}$/);
    return [packageDoc({ package_code: d.package_code, notes: d.notes })];
  });
  mock.method(Product, 'findOne', async () => {
    throw new Error('Product must not be queried');
  });

  const result = await createPackagesForShipment(SHIPMENT_ID, { count: 2 }, ADMIN_ID);
  assert.equal(result.packages.length, 2);
  assert.equal(result.total_for_shipment, 2);
  for (const p of result.packages) {
    assert.match(p.package_code, /^PKG-[0-9A-F]{16}$/);
    assert.equal(p.shipment_id, SHIPMENT_ID);
  }
  assert.equal(createCalls, 2);
  assert.equal(session.commitTransaction.mock.callCount(), 1);
  assertNoMongoConnection();
});

test('createPackagesForShipment: malformed and nonexistent shipment ids', async () => {
  assertNoMongoConnection();
  await assert.rejects(
    () => createPackagesForShipment('not-an-id', { count: 1 }),
    (e: unknown) => e instanceof PackageServiceError && e.status === 400
  );

  mockSession();
  mock.method(Shipment, 'findOneAndUpdate', async () => null);
  await assert.rejects(
    () => createPackagesForShipment(SHIPMENT_ID, { count: 1 }),
    (e: unknown) => e instanceof PackageServiceError && e.status === 404
  );
  assertNoMongoConnection();
});

test('createPackagesForShipment: per-shipment cap (mock count — not live concurrency)', async () => {
  assertNoMongoConnection();
  mockSession();
  mock.method(Shipment, 'findOneAndUpdate', async () => ({
    _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
    shipment_number: 'SH-FULL',
  }));
  mock.method(ShipmentPackage, 'countDocuments', () => ({
    session: async () => MAX_PACKAGES_PER_SHIPMENT,
  }));
  let createCalls = 0;
  mock.method(ShipmentPackage, 'create', async () => {
    createCalls += 1;
    return [packageDoc()];
  });

  await assert.rejects(
    () => createPackagesForShipment(SHIPMENT_ID, { count: 1 }),
    (e: unknown) =>
      e instanceof PackageServiceError &&
      e.status === 400 &&
      /at most 100 packages/i.test(e.message)
  );
  assert.equal(createCalls, 0);
  assertNoMongoConnection();
});

test('createPackagesForShipment: concurrent-style cap race (mock-only, not live Mongo)', async () => {
  assertNoMongoConnection();
  // Simulates two creators after serialize: first sees 99 and inserts; second sees 100.
  let wave = 0;
  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(Shipment, 'findOneAndUpdate', async () => ({
    _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
    shipment_number: 'SH-RACE',
  }));
  mock.method(ShipmentPackage, 'countDocuments', () => ({
    session: async () => {
      wave += 1;
      return wave === 1 ? MAX_PACKAGES_PER_SHIPMENT - 1 : MAX_PACKAGES_PER_SHIPMENT;
    },
  }));
  mock.method(ShipmentPackage, 'create', async (docs: unknown[]) => {
    const d = (docs as Array<Record<string, unknown>>)[0];
    return [packageDoc({ package_code: d.package_code })];
  });

  const first = await createPackagesForShipment(SHIPMENT_ID, { count: 1 }, ADMIN_ID);
  assert.equal(first.packages.length, 1);
  await assert.rejects(
    () => createPackagesForShipment(SHIPMENT_ID, { count: 1 }, ADMIN_ID),
    (e: unknown) => e instanceof PackageServiceError && e.status === 400
  );
  assertNoMongoConnection();
});

test('B4.2-R1: package_code 11000 aborts txn and restarts whole transaction (mock-only)', async () => {
  assertNoMongoConnection();
  // Does NOT prove live MongoDB abort semantics — verifies our control flow only.
  const sessions: Array<ReturnType<typeof createFakeSession>> = [];
  mock.method(mongoose, 'startSession', async () => {
    const s = createFakeSession();
    sessions.push(s);
    return s;
  });

  let shipmentWrites = 0;
  let countCalls = 0;
  mock.method(Shipment, 'findOneAndUpdate', async () => {
    shipmentWrites += 1;
    return {
      _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
      shipment_number: 'SH-DUP',
    };
  });
  mock.method(ShipmentPackage, 'countDocuments', () => ({
    session: async () => {
      countCalls += 1;
      return 0;
    },
  }));

  let createCalls = 0;
  mock.method(ShipmentPackage, 'create', async (docs: unknown[]) => {
    createCalls += 1;
    if (createCalls === 1) {
      throw Object.assign(new Error('E11000 duplicate key error index: package_code_1'), {
        code: 11000,
        keyPattern: { package_code: 1 },
      });
    }
    const d = (docs as Array<Record<string, unknown>>)[0];
    return [packageDoc({ package_code: d.package_code })];
  });

  const result = await createPackagesForShipment(SHIPMENT_ID, { packages: [{}] }, ADMIN_ID);
  assert.equal(result.packages.length, 1);
  assert.equal(createCalls, 2);
  assert.equal(sessions.length, 2, 'collision must start a new session');
  assert.equal(sessions[0].abortTransaction.mock.callCount(), 1, 'failed txn must abort before retry');
  assert.equal(sessions[0].endSession.mock.callCount(), 1, 'failed session must end before retry');
  assert.equal(sessions[0].commitTransaction.mock.callCount(), 0);
  assert.equal(sessions[1].commitTransaction.mock.callCount(), 1);
  assert.equal(sessions[1].endSession.mock.callCount(), 1);
  assert.equal(shipmentWrites, 2, 'restart must repeat Shipment serialize write');
  assert.equal(countCalls, 2, 'restart must repeat package count');
  assertNoMongoConnection();
});

test('B4.2-R1: multi-package collision does not commit partial batch (mock-only)', async () => {
  assertNoMongoConnection();
  const sessions: Array<ReturnType<typeof createFakeSession>> = [];
  mock.method(mongoose, 'startSession', async () => {
    const s = createFakeSession();
    sessions.push(s);
    return s;
  });
  mock.method(Shipment, 'findOneAndUpdate', async () => ({
    _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
    shipment_number: 'SH-BATCH',
  }));
  mock.method(ShipmentPackage, 'countDocuments', () => ({
    session: async () => 0,
  }));

  let createCalls = 0;
  mock.method(ShipmentPackage, 'create', async (docs: unknown[]) => {
    createCalls += 1;
    // First txn: first insert ok, second hits package_code collision → whole batch discarded.
    if (createCalls === 2) {
      throw Object.assign(new Error('E11000 duplicate key error index: package_code_1'), {
        code: 11000,
        keyPattern: { package_code: 1 },
      });
    }
    const d = (docs as Array<Record<string, unknown>>)[0];
    return [packageDoc({ package_code: d.package_code })];
  });

  const result = await createPackagesForShipment(SHIPMENT_ID, { count: 2 }, ADMIN_ID);
  assert.equal(result.packages.length, 2);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].commitTransaction.mock.callCount(), 0);
  assert.equal(sessions[0].abortTransaction.mock.callCount(), 1);
  assert.equal(sessions[1].commitTransaction.mock.callCount(), 1);
  // First txn: 2 creates (2nd fails); second txn: 2 creates → 4 total
  assert.equal(createCalls, 4);
  assertNoMongoConnection();
});

test('B4.2-R1: package_code 11000 exhaustion returns 503 after aborting each attempt (mock-only)', async () => {
  assertNoMongoConnection();
  const sessions: Array<ReturnType<typeof createFakeSession>> = [];
  mock.method(mongoose, 'startSession', async () => {
    const s = createFakeSession();
    sessions.push(s);
    return s;
  });
  mock.method(Shipment, 'findOneAndUpdate', async () => ({
    _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
    shipment_number: 'SH-EXH',
  }));
  mock.method(ShipmentPackage, 'countDocuments', () => ({
    session: async () => 0,
  }));
  let attempts = 0;
  mock.method(ShipmentPackage, 'create', async () => {
    attempts += 1;
    throw Object.assign(new Error('E11000 duplicate key error index: package_code_1'), {
      code: 11000,
      keyPattern: { package_code: 1 },
    });
  });

  await assert.rejects(
    () => createPackagesForShipment(SHIPMENT_ID, { count: 1 }),
    (e: unknown) =>
      e instanceof PackageServiceError &&
      e.status === 503 &&
      /unique package code/i.test(e.message)
  );
  assert.equal(attempts, PACKAGE_CODE_TXN_RESTARTS);
  assert.equal(sessions.length, PACKAGE_CODE_TXN_RESTARTS);
  for (const s of sessions) {
    assert.equal(s.commitTransaction.mock.callCount(), 0);
    assert.equal(s.abortTransaction.mock.callCount(), 1);
    assert.equal(s.endSession.mock.callCount(), 1);
  }
  assertNoMongoConnection();
});

test('createPackagesForShipment: non-code 11000 is not retried as code collision', async () => {
  assertNoMongoConnection();
  const sessions: Array<ReturnType<typeof createFakeSession>> = [];
  mock.method(mongoose, 'startSession', async () => {
    const s = createFakeSession();
    sessions.push(s);
    return s;
  });
  mock.method(Shipment, 'findOneAndUpdate', async () => ({
    _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
    shipment_number: 'SH-OTHER',
  }));
  mock.method(ShipmentPackage, 'countDocuments', () => ({
    session: async () => 0,
  }));
  let attempts = 0;
  mock.method(ShipmentPackage, 'create', async () => {
    attempts += 1;
    throw Object.assign(new Error('E11000 duplicate key error index: shipment_number_1'), {
      code: 11000,
      keyPattern: { shipment_number: 1 },
    });
  });

  await assert.rejects(() => createPackagesForShipment(SHIPMENT_ID, { count: 1 }), (e: unknown) => {
    const err = e as { code?: number };
    return err.code === 11000;
  });
  assert.equal(attempts, 1);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].abortTransaction.mock.callCount(), 1);
  assert.equal(sessions[0].endSession.mock.callCount(), 1);
  assert.equal(sessions[0].commitTransaction.mock.callCount(), 0);
  assertNoMongoConnection();
});

test('createPackagesForShipment: TransientTransactionError restarts whole txn (mock-only)', async () => {
  assertNoMongoConnection();
  const sessions: Array<ReturnType<typeof createFakeSession>> = [];
  mock.method(mongoose, 'startSession', async () => {
    const s = createFakeSession();
    sessions.push(s);
    return s;
  });
  let shipmentWrites = 0;
  mock.method(Shipment, 'findOneAndUpdate', async () => {
    shipmentWrites += 1;
    if (shipmentWrites === 1) {
      throw Object.assign(new Error('WriteConflict'), {
        code: 112,
        codeName: 'WriteConflict',
        errorLabels: ['TransientTransactionError'],
      });
    }
    return {
      _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
      shipment_number: 'SH-WC',
    };
  });
  mock.method(ShipmentPackage, 'countDocuments', () => ({
    session: async () => 0,
  }));
  mock.method(ShipmentPackage, 'create', async (docs: unknown[]) => {
    const d = (docs as Array<Record<string, unknown>>)[0];
    return [packageDoc({ package_code: d.package_code })];
  });

  const result = await createPackagesForShipment(SHIPMENT_ID, { count: 1 }, ADMIN_ID);
  assert.equal(result.packages.length, 1);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].abortTransaction.mock.callCount(), 1);
  assert.equal(sessions[0].endSession.mock.callCount(), 1);
  assert.equal(sessions[1].commitTransaction.mock.callCount(), 1);
  assert.equal(shipmentWrites, 2);
  assertNoMongoConnection();
});

test('createPackagesForShipment: multi-create aborts with no partial commit on mid failure', async () => {
  assertNoMongoConnection();
  const session = mockSession();
  mock.method(Shipment, 'findOneAndUpdate', async () => ({
    _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
    shipment_number: 'SH-PARTIAL',
  }));
  mock.method(ShipmentPackage, 'countDocuments', () => ({
    session: async () => 0,
  }));
  let attempts = 0;
  mock.method(ShipmentPackage, 'create', async (docs: unknown[]) => {
    attempts += 1;
    if (attempts === 2) {
      throw new Error('simulated insert failure');
    }
    const d = (docs as Array<Record<string, unknown>>)[0];
    return [packageDoc({ package_code: d.package_code })];
  });

  await assert.rejects(() => createPackagesForShipment(SHIPMENT_ID, { count: 2 }));
  assert.equal(session.commitTransaction.mock.callCount(), 0);
  assert.ok(session.abortTransaction.mock.callCount() >= 1);
  assertNoMongoConnection();
});

test('listPackagesForShipment returns only that shipment; ownership not reassigned', async () => {
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
    assert.notEqual(String(filter.shipment_id), OTHER_SHIPMENT);
    return {
      sort: () => ({
        lean: async () => [
          packageDoc({ package_code: 'PKG-1111111111111111' }),
          packageDoc({ package_code: 'PKG-2222222222222222' }),
        ],
      }),
    };
  });

  const result = await listPackagesForShipment(SHIPMENT_ID);
  assert.equal(result.packages.length, 2);
  for (const p of result.packages) {
    assert.equal(p.shipment_id, SHIPMENT_ID);
  }
  assertNoMongoConnection();
});

test('getPackageByCode: success, invalid code, unknown code, missing shipment', async () => {
  assertNoMongoConnection();

  await assert.rejects(
    () => getPackageByCode('EDI-48217'),
    (e: unknown) => e instanceof PackageServiceError && e.status === 400
  );

  mock.method(ShipmentPackage, 'findOne', () => ({
    lean: async () => null,
  }));
  await assert.rejects(
    () => getPackageByCode('PKG-ABCD1234EF567890'),
    (e: unknown) => e instanceof PackageServiceError && e.status === 404
  );

  mock.restoreAll();
  mock.method(ShipmentPackage, 'findOne', () => ({
    lean: async () => packageDoc(),
  }));
  mock.method(Shipment, 'findById', () => ({
    select: () => ({
      lean: async () => null,
    }),
  }));
  await assert.rejects(
    () => getPackageByCode('PKG-ABCD1234EF567890'),
    (e: unknown) => e instanceof PackageServiceError && e.status === 404
  );

  mock.restoreAll();
  mock.method(ShipmentPackage, 'findOne', () => ({
    lean: async () => packageDoc(),
  }));
  mock.method(Shipment, 'findById', () => ({
    select: () => ({
      lean: async () => ({
        _id: new mongoose.Types.ObjectId(SHIPMENT_ID),
        shipment_number: 'SH-OK',
        status: 'PACKED',
      }),
    }),
  }));
  mock.method(Product, 'findOne', async () => {
    throw new Error('Product must not be queried from package lookup');
  });

  const found = await getPackageByCode('  pkg-abcd1234ef567890  ');
  assert.equal(found.package_code, 'PKG-ABCD1234EF567890');
  assert.equal(found.shipment.status, 'PACKED');
  assert.equal(found.shipment_id, SHIPMENT_ID);
  assertNoMongoConnection();
});
