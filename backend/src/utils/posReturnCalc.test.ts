/**
 * Task 07D-10D — POS return calculation (no writes).
 *
 * Run with:
 *     npx tsx --test src/utils/posReturnCalc.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculatePosReturnRefund, PosReturnCalcError } from './posReturnCalc';

const A = '64b0000000000000000d0404';
const B = '64b0000000000000000d0505';
const MISSING = '64b0000000000000000d9999';

function sale3x100(opts?: { discount_amount?: number; tax_amount?: number; line_discount?: number }) {
  return {
    discount_amount: opts?.discount_amount ?? 0,
    tax_amount: opts?.tax_amount ?? 0,
    items: [
      {
        product_id: A,
        product_name: 'Item A',
        quantity: 3,
        price: 100,
        discount: opts?.line_discount ?? 0,
        tax: opts?.tax_amount ?? 0,
        subtotal: 300,
      },
    ],
  };
}

test('A — 3 × $100, no discount, return 1 is $100', () => {
  const result = calculatePosReturnRefund(sale3x100(), [{ product_id: A, quantity: 1 }]);
  assert.equal(result.total_refund, 100);
  assert.equal(result.lines[0].refundable_unit_amount, 100);
  assert.equal(result.lines[0].refundable_amount, 100);
});

test('B — $30 bill discount: return 1/2/3 is $90/$180/$270', () => {
  const sale = sale3x100({ discount_amount: 30 });
  assert.equal(calculatePosReturnRefund(sale, [{ product_id: A, quantity: 1 }]).total_refund, 90);
  assert.equal(calculatePosReturnRefund(sale, [{ product_id: A, quantity: 2 }]).total_refund, 180);
  assert.equal(calculatePosReturnRefund(sale, [{ product_id: A, quantity: 3 }]).total_refund, 270);
});

test('C — tax present does not change merchandise refund', () => {
  const result = calculatePosReturnRefund(sale3x100({ discount_amount: 30, tax_amount: 27 }), [
    { product_id: A, quantity: 1 },
  ]);
  assert.equal(result.total_refund, 90);
  assert.equal(result.lines[0].refundable_amount, 90);
});

test('D — bill discount is allocated by total units, not line count', () => {
  const sale = {
    discount_amount: 30,
    items: [
      { product_id: A, product_name: 'A', quantity: 2, price: 100, discount: 0 },
      { product_id: B, product_name: 'B', quantity: 1, price: 50, discount: 0 },
    ],
  };
  const a = calculatePosReturnRefund(sale, [{ product_id: A, quantity: 1 }]);
  const b = calculatePosReturnRefund(sale, [{ product_id: B, quantity: 1 }]);
  assert.equal(a.lines[0].allocated_discount_per_unit, 10);
  assert.equal(a.lines[0].refundable_unit_amount, 90);
  assert.equal(b.lines[0].allocated_discount_per_unit, 10);
  assert.equal(b.lines[0].refundable_unit_amount, 40);
});

test('E — product not in sale is rejected', () => {
  assert.throws(
    () => calculatePosReturnRefund(sale3x100(), [{ product_id: MISSING, quantity: 1 }]),
    (err: unknown) => {
      assert.ok(err instanceof PosReturnCalcError);
      assert.match(err.message, /was not part of the original sale/i);
      return true;
    }
  );
});

test('F — remaining qty after a completed partial return allows the next request', () => {
  const existing = [{ status: 'completed', items: [{ product_id: A, quantity: 2 }] }];
  const sale = {
    discount_amount: 0,
    items: [{ product_id: A, product_name: 'A', quantity: 5, price: 100, discount: 0 }],
  };
  const result = calculatePosReturnRefund(sale, [{ product_id: A, quantity: 2 }], existing);
  assert.equal(result.lines[0].already_returned_quantity, 2);
  assert.equal(result.lines[0].remaining_quantity, 3);
  assert.equal(result.total_refund, 200);
});

test('G — over-return is rejected', () => {
  const existing = [{ status: 'completed', items: [{ product_id: A, quantity: 4 }] }];
  const sale = {
    items: [{ product_id: A, product_name: 'A', quantity: 5, price: 100, discount: 0 }],
  };
  assert.throws(
    () => calculatePosReturnRefund(sale, [{ product_id: A, quantity: 2 }], existing),
    (err: unknown) => {
      assert.ok(err instanceof PosReturnCalcError);
      assert.match(err.message, /Remaining returnable quantity: 1/);
      return true;
    }
  );
});

test('H — fully returned sale rejects further returns', () => {
  const existing = [{ status: 'completed', items: [{ product_id: A, quantity: 2 }] }];
  const sale = {
    items: [{ product_id: A, product_name: 'A', quantity: 2, price: 100, discount: 0 }],
  };
  assert.throws(
    () => calculatePosReturnRefund(sale, [{ product_id: A, quantity: 1 }], existing),
    (err: unknown) => {
      assert.ok(err instanceof PosReturnCalcError);
      assert.match(err.message, /Remaining returnable quantity: 0/);
      return true;
    }
  );
});

test('I — only completed returns reduce remaining quantity', () => {
  const existing = [
    { status: 'pending', items: [{ product_id: A, quantity: 2 }] },
    { status: 'cancelled', items: [{ product_id: A, quantity: 2 }] },
  ];
  const result = calculatePosReturnRefund(sale3x100(), [{ product_id: A, quantity: 2 }], existing);
  assert.equal(result.lines[0].already_returned_quantity, 0);
  assert.equal(result.total_refund, 200);
});

test('J — current catalog price is ignored; sale price is used', () => {
  const catalogPrice = 999;
  const sale = {
    items: [{ product_id: A, product_name: 'A', quantity: 2, price: 100, discount: 0 }],
  };
  const result = calculatePosReturnRefund(sale, [{ product_id: A, quantity: 1 }]);
  assert.equal(result.lines[0].original_unit_price, 100);
  assert.notEqual(result.lines[0].original_unit_price, catalogPrice);
  assert.equal(result.total_refund, 100);
});

test('K — refund result has no tax field and does not add tax', () => {
  const result = calculatePosReturnRefund(sale3x100({ discount_amount: 30, tax_amount: 27 }), [
    { product_id: A, quantity: 1 },
  ]);
  assert.equal(result.total_refund, 90);
  assert.equal('tax_refund' in result, false);
  assert.equal('tax' in result.lines[0], false);
});

test('L — line-level discount is a line total allocated across that line\'s units', () => {
  // 3 × $100, line discount $15 (POS stores a line total; FE uses price - discount/qty).
  const sale = sale3x100({ line_discount: 15 });
  const result = calculatePosReturnRefund(sale, [{ product_id: A, quantity: 1 }]);
  assert.equal(result.lines[0].allocated_discount_per_unit, 5);
  assert.equal(result.lines[0].refundable_unit_amount, 95);
  assert.equal(result.total_refund, 95);
});

test('multi-product request after a partial return on one product', () => {
  const sale = {
    discount_amount: 0,
    items: [
      { product_id: A, product_name: 'A', quantity: 2, price: 100, discount: 0 },
      { product_id: B, product_name: 'B', quantity: 3, price: 20, discount: 0 },
    ],
  };
  const existing = [{ status: 'completed', items: [{ product_id: A, quantity: 1 }] }];
  const result = calculatePosReturnRefund(
    sale,
    [
      { product_id: A, quantity: 1 },
      { product_id: B, quantity: 2 },
    ],
    existing
  );
  assert.equal(result.lines[0].refundable_amount, 100);
  assert.equal(result.lines[1].refundable_amount, 40);
  assert.equal(result.total_refund, 140);
});

test('duplicate product_id in one request is rejected', () => {
  assert.throws(
    () =>
      calculatePosReturnRefund(sale3x100(), [
        { product_id: A, quantity: 1 },
        { product_id: A, quantity: 1 },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof PosReturnCalcError);
      assert.match(err.message, /Duplicate product/i);
      return true;
    }
  );
});

test('helper does not write Return, stock, or money', () => {
  const src = readFileSync(join(process.cwd(), 'src/utils/posReturnCalc.ts'), 'utf8');
  assert.equal(src.includes('.create('), false);
  assert.equal(src.includes('findByIdAndUpdate'), false);
  assert.equal(src.includes('startSession'), false);
});
