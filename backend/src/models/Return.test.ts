/**
 * Task 07D-10C — POS Return schema and indexes.
 *
 * Isolated: no Mongo connection. Validation uses validateSync().
 *
 * Run with:
 *     npx tsx --test src/models/Return.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import Return, {
  POS_RETURN_DISPOSITIONS,
  POS_RETURN_REFUND_METHODS,
} from './Return';

const SALE_ID = new mongoose.Types.ObjectId('64b0000000000000000a0a0a');
const PRODUCT_ID = new mongoose.Types.ObjectId('64b0000000000000000d0404');

function validLine(overrides: Record<string, unknown> = {}) {
  return {
    product_id: PRODUCT_ID,
    product_name: 'Retail Item',
    quantity: 1,
    original_unit_price: 100,
    allocated_discount_per_unit: 10,
    refundable_unit_amount: 90,
    refundable_amount: 90,
    inventory_disposition: 'resalable',
    ...overrides,
  };
}

function validReturn(overrides: Record<string, unknown> = {}) {
  return new Return({
    return_number: `RET-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    sale_id: SALE_ID,
    sale_number: 'POS-1',
    items: [validLine()],
    total_refund: 90,
    refund_method: 'cash',
    ...overrides,
  });
}

test('required identity and sale reference are enforced', () => {
  const missingNumber = new Return({
    sale_id: SALE_ID,
    sale_number: 'POS-1',
    items: [validLine()],
    total_refund: 90,
    refund_method: 'cash',
  });
  assert.ok(missingNumber.validateSync()?.errors.return_number);

  const missingSale = new Return({
    return_number: 'RET-NO-SALE',
    sale_number: 'POS-1',
    items: [validLine()],
    total_refund: 90,
    refund_method: 'cash',
  });
  assert.ok(missingSale.validateSync()?.errors.sale_id);

  const missingSaleNumber = new Return({
    return_number: 'RET-NO-SALE-NUMBER',
    sale_id: SALE_ID,
    items: [validLine()],
    total_refund: 90,
    refund_method: 'cash',
  });
  assert.ok(missingSaleNumber.validateSync()?.errors.sale_number);

  assert.equal(validReturn().validateSync(), undefined);
});

test('supported refund methods are accepted and others are rejected', () => {
  for (const refund_method of POS_RETURN_REFUND_METHODS) {
    assert.equal(validReturn({ refund_method, return_number: `RET-${refund_method}` }).validateSync(), undefined);
  }
  const invalid = validReturn({ refund_method: 'card', return_number: 'RET-BAD-METHOD' });
  assert.ok(invalid.validateSync()?.errors.refund_method);
});

test('resalable and damaged dispositions are accepted; invalid disposition is rejected', () => {
  for (const inventory_disposition of POS_RETURN_DISPOSITIONS) {
    const doc = validReturn({
      return_number: `RET-${inventory_disposition}`,
      items: [validLine({ inventory_disposition })],
    });
    assert.equal(doc.validateSync(), undefined);
  }
  const invalid = validReturn({
    return_number: 'RET-BAD-DISP',
    items: [validLine({ inventory_disposition: 'destroyed' })],
  });
  assert.ok(invalid.validateSync()?.errors['items.0.inventory_disposition']);
});

test('return lines preserve original price, allocated discount, and refundable amounts', () => {
  const doc = validReturn({
    return_number: 'RET-LINE-ECON',
    items: [
      validLine({
        quantity: 2,
        original_unit_price: 100,
        allocated_discount_per_unit: 10,
        refundable_unit_amount: 90,
        refundable_amount: 180,
        inventory_disposition: 'damaged',
      }),
    ],
    total_refund: 180,
  });
  assert.equal(doc.validateSync(), undefined);
  const line = doc.items[0];
  assert.equal(line.original_unit_price, 100);
  assert.equal(line.allocated_discount_per_unit, 10);
  assert.equal(line.refundable_unit_amount, 90);
  assert.equal(line.refundable_amount, 180);
  assert.equal(line.inventory_disposition, 'damaged');
  assert.equal(doc.total_refund, 180);
});

test('idempotency_key is optional unique+sparse; sale_id is not unique', () => {
  const path = Return.schema.path('idempotency_key') as {
    options?: { unique?: boolean; sparse?: boolean; required?: boolean };
  };
  assert.equal(path.options?.unique, true);
  assert.equal(path.options?.sparse, true);
  assert.notEqual(path.options?.required, true);

  const indexes = Return.schema.indexes();
  const keyed = indexes.find((entry) => (entry[0] as { idempotency_key?: number }).idempotency_key === 1);
  assert.ok(keyed);
  assert.equal((keyed?.[1] as { unique?: boolean }).unique, true);
  assert.equal((keyed?.[1] as { sparse?: boolean }).sparse, true);

  const saleOnly = indexes.filter((entry) => {
    const fields = entry[0] as { sale_id?: number; status?: number };
    return fields.sale_id === 1 && fields.status === undefined;
  });
  assert.ok(saleOnly.length >= 1);
  assert.notEqual((saleOnly[0][1] as { unique?: boolean }).unique, true);

  const saleStatus = indexes.find((entry) => {
    const fields = entry[0] as { sale_id?: number; status?: number };
    return fields.sale_id === 1 && fields.status === 1;
  });
  assert.ok(saleStatus, 'sale_id + status lookup index');
  assert.notEqual((saleStatus?.[1] as { unique?: boolean }).unique, true);
});

test('invalid quantities and money values are rejected', () => {
  const zeroQty = validReturn({
    return_number: 'RET-ZERO-QTY',
    items: [validLine({ quantity: 0 })],
  });
  assert.ok(zeroQty.validateSync()?.errors['items.0.quantity']);

  const negMoney = validReturn({
    return_number: 'RET-NEG',
    items: [validLine({ original_unit_price: -1 })],
  });
  assert.ok(negMoney.validateSync()?.errors['items.0.original_unit_price']);

  const negRefund = validReturn({ return_number: 'RET-NEG-TOTAL', total_refund: -5 });
  assert.ok(negRefund.validateSync()?.errors.total_refund);
});

test('walk-in sale may omit customer_id; cheque_reference and window fields are optional', () => {
  const walkIn = validReturn({
    return_number: 'RET-WALKIN',
    customer_id: undefined,
    pos_customer_id: undefined,
    refund_method: 'cheque',
    cheque_reference: 'CHQ-1001',
    return_window_days: 30,
    window_extended: true,
  });
  assert.equal(walkIn.validateSync(), undefined);
  assert.equal(walkIn.customer_id, undefined);
  assert.equal(walkIn.return_window_days, 30);
});

test('POST /api/returns remains disabled', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/returns.ts'), 'utf8');
  assert.match(src, /status\(501\)/);
  assert.match(src, /not currently supported/i);
  assert.equal(src.includes('Return.create'), false);
});
