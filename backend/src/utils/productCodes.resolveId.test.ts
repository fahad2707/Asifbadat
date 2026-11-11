import '../load-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import Product from '../models/Product';
import { resolveCreateProductId } from './productCodes';

afterEach(() => {
  mock.restoreAll();
});

test('keeps a generated preview ID when it is still unused', async () => {
  mock.method(Product, 'findOne', () => ({
    select() {
      return this;
    },
    lean: async () => null,
  }));
  const id = await resolveCreateProductId('68900');
  assert.equal(id, '68900');
});

test('rejects a preview ID that is already assigned', async () => {
  mock.method(Product, 'findOne', () => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: 'x' }),
  }));
  await assert.rejects(() => resolveCreateProductId('68900'), /already in use/i);
});
