/**
 * Task 07B-H — isolated GET /api/invoices?unpaid_only=true harness.
 *
 * No Mongo connection, no express_distributors_dev, no admin login.
 * Invoice.find / countDocuments are stubbed so the route's real query
 * is applied to in-memory fixtures.
 *
 * Run with:
 *     npx tsx --test src/routes/invoiceRouteHarness.test.ts
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server';
import Invoice from '../models/Invoice';
import { DOCUMENT_TYPE_INVOICE, DOCUMENT_TYPE_QUOTATION } from '../utils/documentType';

type Fixture = {
  _id: { toString(): string };
  invoice_number: string;
  invoice_type: string;
  customer_name: string;
  total_amount: number;
  amount_paid: number;
  payment_status: string;
  tax_amount: number;
};

const fixtures: Fixture[] = [
  {
    _id: { toString: () => 'fix-a' },
    invoice_number: 'INV#A',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    customer_name: 'Fixture A',
    total_amount: 100,
    amount_paid: 0,
    payment_status: 'unpaid',
    tax_amount: 0,
  },
  {
    _id: { toString: () => 'fix-b' },
    invoice_number: 'INV#B',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    customer_name: 'Fixture B',
    total_amount: 100,
    amount_paid: 40,
    payment_status: 'unpaid',
    tax_amount: 0,
  },
  {
    _id: { toString: () => 'fix-c' },
    invoice_number: 'INV#C',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    customer_name: 'Fixture C',
    total_amount: 100,
    amount_paid: 100,
    payment_status: 'paid',
    tax_amount: 0,
  },
  {
    _id: { toString: () => 'fix-d' },
    invoice_number: 'INV#D',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    customer_name: 'Fixture D drift paid/0',
    total_amount: 100,
    amount_paid: 0,
    payment_status: 'paid',
    tax_amount: 0,
  },
  {
    _id: { toString: () => 'fix-e' },
    invoice_number: 'INV#E',
    invoice_type: DOCUMENT_TYPE_INVOICE,
    customer_name: 'Fixture E reverse drift',
    total_amount: 100,
    amount_paid: 100,
    payment_status: 'unpaid',
    tax_amount: 0,
  },
  {
    _id: { toString: () => 'fix-f' },
    invoice_number: 'QTN#F',
    invoice_type: DOCUMENT_TYPE_QUOTATION,
    customer_name: 'Fixture F quotation',
    total_amount: 16.99,
    amount_paid: 0,
    payment_status: 'unpaid',
    tax_amount: 0,
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
  const unknownOp = Object.keys(obj).find((key) => key.startsWith('$'));
  if (unknownOp) {
    throw new Error(`invoice harness cannot evaluate operator ${unknownOp}`);
  }
  return node;
}

function fieldMatches(docValue: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
    const obj = condition as Record<string, unknown>;
    if ('$ne' in obj) return docValue !== obj.$ne;
    if ('$eq' in obj) return docValue === obj.$eq;
    throw new Error(`invoice harness cannot evaluate field condition ${JSON.stringify(condition)}`);
  }
  return docValue === condition;
}

/** Apply the route's real find() query to fixtures. Do not bypass with helpers. */
function applyInvoiceFindQuery(docs: Fixture[], query: Record<string, unknown>): Fixture[] {
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

function chainableFindResult(docs: Fixture[]) {
  const result = {
    sort() {
      return result;
    },
    skip() {
      return result;
    },
    limit() {
      return result;
    },
    lean() {
      return Promise.resolve(docs);
    },
  };
  return result;
}

function adminTestToken(): string {
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, 'JWT_SECRET must be available so the test signs a real admin JWT');
  return jwt.sign({ adminId: '07bh-isolated-admin', role: 'admin' }, secret, { expiresIn: '8h' });
}

function assertNoMongoConnection() {
  assert.equal(
    mongoose.connection.readyState,
    0,
    'invoice route harness must not open a MongoDB connection'
  );
  assert.notEqual(mongoose.connection.name, 'express_distributors_dev');
}

afterEach(() => {
  mock.restoreAll();
});

test('GET /api/invoices?unpaid_only=true uses the route query on isolated fixtures', async () => {
  assertNoMongoConnection();

  let capturedQuery: Record<string, unknown> | undefined;
  mock.method(Invoice, 'find', (query: Record<string, unknown>) => {
    capturedQuery = query;
    return chainableFindResult(applyInvoiceFindQuery(fixtures, query));
  });
  mock.method(Invoice, 'countDocuments', (query: Record<string, unknown>) => {
    return Promise.resolve(applyInvoiceFindQuery(fixtures, query).length);
  });

  const res = await request(createApp())
    .get('/api/invoices?unpaid_only=true')
    .set('Authorization', `Bearer ${adminTestToken()}`);

  assertNoMongoConnection();
  assert.equal(res.status, 200);
  assert.ok(capturedQuery, 'Invoice.find must receive the production query');
  assert.equal(capturedQuery.invoice_type, DOCUMENT_TYPE_INVOICE);
  assert.ok(capturedQuery.$expr, 'unpaid_only must use a derived $expr, not stored payment_status alone');
  assert.equal(
    capturedQuery.payment_status,
    undefined,
    'unpaid_only must not filter solely by stored payment_status'
  );

  const rows = res.body as Array<{ id: string; payment_status: string; invoice_number: string }>;
  const ids = rows.map((row) => row.id).sort();
  assert.deepEqual(ids, ['fix-a', 'fix-b', 'fix-d']);

  const drift = rows.find((row) => row.id === 'fix-d');
  assert.ok(drift, 'stored paid + amount_paid 0 must be treated as derived-unpaid');
  assert.equal(drift.payment_status, 'unpaid');

  assert.equal(rows.some((row) => row.id === 'fix-e'), false, 'fully paid stored-unpaid must be derived-paid');
  assert.equal(rows.some((row) => row.id === 'fix-f'), false, 'quotations must be excluded');
  assert.equal(rows.some((row) => row.id === 'fix-c'), false);
});
