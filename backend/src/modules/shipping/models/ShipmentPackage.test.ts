/**
 * Phase B4.1 — ShipmentPackage schema and indexes.
 *
 * Isolated: no Mongo connection. Validation uses validateSync().
 *
 * Run: npx tsx --test src/modules/shipping/models/ShipmentPackage.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import ShipmentPackage from './ShipmentPackage';
import { PACKAGE_CODE_MAX_LENGTH, generatePackageCode } from '../utils/packageCodes';

const SHIPMENT_ID = new mongoose.Types.ObjectId('64b0000000000000000b0b0b');
const ADMIN_ID = new mongoose.Types.ObjectId('64b0000000000000000c0c0c');

function validPackage(overrides: Record<string, unknown> = {}) {
  return new ShipmentPackage({
    package_code: generatePackageCode(),
    shipment_id: SHIPMENT_ID,
    shipment_number: 'SH-TEST1',
    notes: 'carton 1',
    created_by: ADMIN_ID,
    ...overrides,
  });
}

test('required fields: package_code and shipment_id', () => {
  const missingCode = new ShipmentPackage({ shipment_id: SHIPMENT_ID });
  assert.ok(missingCode.validateSync()?.errors.package_code);

  const missingShipment = new ShipmentPackage({ package_code: generatePackageCode() });
  assert.ok(missingShipment.validateSync()?.errors.shipment_id);

  assert.equal(validPackage().validateSync(), undefined);
});

test('package_code is normalized and bounded', () => {
  const doc = validPackage({ package_code: '  pkg-abcd1234ef567890  ' });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.package_code, 'PKG-ABCD1234EF567890');

  const tooLong = validPackage({ package_code: 'PKG-' + 'A'.repeat(PACKAGE_CODE_MAX_LENGTH) });
  assert.ok(tooLong.validateSync()?.errors.package_code);
});

test('optional notes, shipment_number, created_by; notes maxlength enforced', () => {
  const minimal = new ShipmentPackage({
    package_code: generatePackageCode(),
    shipment_id: SHIPMENT_ID,
  });
  assert.equal(minimal.validateSync(), undefined);

  const longNotes = validPackage({ notes: 'x'.repeat(501) });
  assert.ok(longNotes.validateSync()?.errors.notes);
});

test('package_code unique index and shipment_id+created_at list index', () => {
  const path = ShipmentPackage.schema.path('package_code') as {
    options?: { unique?: boolean; required?: boolean; maxlength?: number };
  };
  assert.equal(path.options?.unique, true);
  assert.equal(path.options?.required, true);
  assert.equal(path.options?.maxlength, PACKAGE_CODE_MAX_LENGTH);

  const indexes = ShipmentPackage.schema.indexes();

  const byCode = indexes.find((entry) => (entry[0] as { package_code?: number }).package_code === 1);
  // Field-level unique: true registers uniqueness; compound index below is explicit.
  // Some Mongoose versions surface unique via path options only — assert path above.
  if (byCode) {
    assert.equal((byCode[1] as { unique?: boolean }).unique, true);
  }

  const byShipmentCreated = indexes.find((entry) => {
    const fields = entry[0] as { shipment_id?: number; created_at?: number };
    return fields.shipment_id === 1 && fields.created_at === -1;
  });
  assert.ok(byShipmentCreated, 'shipment_id + created_at index');
  assert.notEqual((byShipmentCreated?.[1] as { unique?: boolean }).unique, true);

  const sequenceUnique = indexes.find((entry) => {
    const fields = entry[0] as { shipment_id?: number; sequence?: number };
    return fields.shipment_id === 1 && fields.sequence === 1;
  });
  assert.equal(sequenceUnique, undefined);
});

test('timestamps use created_at / updated_at', () => {
  const opts = ShipmentPackage.schema.get('timestamps') as
    | boolean
    | { createdAt?: string; updatedAt?: string }
    | undefined;
  assert.ok(opts && typeof opts === 'object');
  assert.equal(opts.createdAt, 'created_at');
  assert.equal(opts.updatedAt, 'updated_at');
});
