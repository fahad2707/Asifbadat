/**
 * Task 07C-02 — GET /api/customers/balances uses derived unpaid AR.
 *
 * No Mongo connection. Invoice.aggregate is stubbed so the route's real
 * pipeline is applied to in-memory fixtures.
 *
 * Run with:
 *     npx tsx --test src/routes/customerBalances.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import Invoice from '../models/Invoice';
import { DOCUMENT_TYPE_INVOICE, DOCUMENT_TYPE_QUOTATION } from '../utils/documentType';
import { derivedUnpaidReceivableMatch } from '../utils/invoiceFinancialState';

type Fixture = {
  customer_id?: string | null;
  invoice_type: string;
  total_amount: number;
  amount_paid: number;
  payment_status: string;
};

const customerA = 'cust-a';
const customerB = 'cust-b';

const fixtures: Fixture[] = [
  {
    customer_id: customerA,
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 0,
    payment_status: 'unpaid',
  },
  {
    customer_id: customerA,
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 40,
    payment_status: 'unpaid',
  },
  {
    customer_id: customerA,
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 100,
    payment_status: 'paid',
  },
  {
    customer_id: customerA,
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 0,
    payment_status: 'paid',
  },
  {
    customer_id: customerA,
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 100,
    amount_paid: 100,
    payment_status: 'unpaid',
  },
  {
    customer_id: customerA,
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    total_amount: 16.99,
    amount_paid: 0,
    payment_status: 'unpaid',
  },
  {
    customer_id: customerB,
    invoice_type: DOCUMENT_TYPE_INVOICE,
    total_amount: 80,
    amount_paid: 20,
    payment_status: 'unpaid',
  },
];

function evalMongoValue(doc: Record<string, unknown>, node: unknown): unknown {
  if (typeof node === 'string' && node.startsWith('$') && !node.startsWith('$$')) {
    return doc[node.slice(1)];
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return node;
  }
  const obj = node as Record<string, unknown>;
  if ('$ifNull' in obj) {
    const [valueNode, fallback] = obj.$ifNull as [unknown, unknown];
    const value = evalMongoValue(doc, valueNode);
    return value === null || value === undefined ? evalMongoValue(doc, fallback) : value;
  }
  if ('$round' in obj) {
    const [valueNode, placesNode] = obj.$round as [unknown, unknown];
    const value = Number(evalMongoValue(doc, valueNode));
    const places = Number(evalMongoValue(doc, placesNode));
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }
  if ('$lt' in obj) {
    const [left, right] = obj.$lt as [unknown, unknown];
    return Number(evalMongoValue(doc, left)) < Number(evalMongoValue(doc, right));
  }
  if ('$subtract' in obj) {
    const [left, right] = obj.$subtract as [unknown, unknown];
    return Number(evalMongoValue(doc, left)) - Number(evalMongoValue(doc, right));
  }
  if ('$sum' in obj) {
    return obj.$sum;
  }
  const unknownOp = Object.keys(obj).find((key) => key.startsWith('$'));
  if (unknownOp) {
    throw new Error(`customer balances harness cannot evaluate operator ${unknownOp}`);
  }
  return node;
}

function fieldMatches(docValue: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
    const obj = condition as Record<string, unknown>;
    if ('$exists' in obj || '$ne' in obj) {
      if (obj.$exists === true && docValue === undefined) return false;
      if (obj.$exists === false && docValue !== undefined) return false;
      if ('$ne' in obj && docValue === obj.$ne) return false;
      return true;
    }
    if ('$eq' in obj) return docValue === obj.$eq;
    throw new Error(`customer balances harness cannot evaluate field condition ${JSON.stringify(condition)}`);
  }
  return docValue === condition;
}

function applyMatch(docs: Fixture[], query: Record<string, unknown>): Fixture[] {
  return docs.filter((doc) => {
    const row = doc as unknown as Record<string, unknown>;
    for (const [key, condition] of Object.entries(query)) {
      if (key === '$expr') {
        if (evalMongoValue(row, condition) !== true) return false;
        continue;
      }
      if (!fieldMatches(row[key], condition)) return false;
    }
    return true;
  });
}

/** Apply the route's real aggregate pipeline. Do not bypass with helpers. */
function applyBalancesPipeline(docs: Fixture[], pipeline: Array<Record<string, unknown>>) {
  let rows: Array<Record<string, unknown>> = docs.map((doc) => ({ ...doc }));
  for (const stage of pipeline) {
    if (stage.$match) {
      rows = applyMatch(rows as Fixture[], stage.$match as Record<string, unknown>) as unknown as Array<Record<string, unknown>>;
      continue;
    }
    if (stage.$project) {
      const spec = stage.$project as Record<string, unknown>;
      rows = rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(spec)) {
          if (value === 1 || value === true) out[key] = row[key];
          else out[key] = evalMongoValue(row, value);
        }
        return out;
      });
      continue;
    }
    if (stage.$group) {
      const spec = stage.$group as Record<string, unknown>;
      const grouped = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        const id = String(evalMongoValue(row, spec._id));
        const current = grouped.get(id) ?? { _id: evalMongoValue(row, spec._id), open_balance: 0 };
        const sumSpec = spec.open_balance as { $sum?: unknown };
        current.open_balance = Number(current.open_balance) + Number(evalMongoValue(row, sumSpec.$sum));
        grouped.set(id, current);
      }
      rows = [...grouped.values()];
      continue;
    }
    throw new Error(`customer balances harness cannot evaluate stage ${JSON.stringify(stage)}`);
  }
  return rows;
}

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07c02-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    'customer balances tests must not open a MongoDB connection'
  );
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

afterEach(() => {
  mock.restoreAll();
});

test('GET /api/customers/balances uses derived unpaid amounts, not stored payment_status', async () => {
  assertNoMongoConnection();

  let capturedPipeline: Array<Record<string, unknown>> | undefined;
  mock.method(Invoice, 'aggregate', (pipeline: Array<Record<string, unknown>>) => {
    capturedPipeline = pipeline;
    return Promise.resolve(applyBalancesPipeline(fixtures, pipeline));
  });

  const res = await request(createApp())
    .get('/api/customers/balances')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.ok(capturedPipeline, 'Invoice.aggregate must receive the production pipeline');

  const match = capturedPipeline[0]?.$match as Record<string, unknown> | undefined;
  assert.ok(match, 'balances pipeline must start with $match');
  assert.equal(match.invoice_type, DOCUMENT_TYPE_INVOICE);
  assert.deepEqual(match.$expr, derivedUnpaidReceivableMatch.$expr);
  assert.equal(
    match.payment_status,
    undefined,
    'Customer AR must not filter solely by stored payment_status'
  );

  const balances = (res.body.balances as Array<{ customer_id: string; open_balance: number }>)
    .slice()
    .sort((a, b) => a.customer_id.localeCompare(b.customer_id));

  const byId = Object.fromEntries(balances.map((row) => [row.customer_id, row.open_balance]));
  assert.equal(byId[customerA], 260);
  assert.equal(byId[customerB], 60);
  assert.equal(Object.keys(byId).length, 2);
});

test('customer balances route source uses derivedUnpaidReceivableMatch', () => {
  const source = readFileSync(join(process.cwd(), 'src/routes/customers.ts'), 'utf8');
  const balancesAt = source.indexOf("router.get('/balances'");
  assert.ok(balancesAt >= 0);
  const matchAt = source.indexOf('derivedUnpaidReceivableMatch', balancesAt);
  assert.ok(matchAt > balancesAt);
  const routeSlice = source.slice(balancesAt, source.indexOf("router.get('/:id'", balancesAt));
  assert.equal(routeSlice.includes("payment_status: 'unpaid'"), false);
});
