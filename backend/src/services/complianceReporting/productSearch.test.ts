/**
 * Product search clauses. No database.
 *
 * Run with:
 *     npx tsx --test src/services/complianceReporting/productSearch.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tobaccoProductSearch } from './productSearch';

function pattern(search: ReturnType<typeof tobaccoProductSearch>): string {
  assert.equal(search.searchRequired, false);
  if (search.searchRequired) return '';
  const clause = search.clause.$or as Array<{ sku: { $regex: string; $options: string } }>;
  return clause[1].sku.$regex;
}

test('an empty product search does not build a catalogue query', () => {
  assert.deepEqual(tobaccoProductSearch(''), { searchRequired: true });
  assert.deepEqual(tobaccoProductSearch('   '), { searchRequired: true });
});

test('partial and full identifiers share one escaped case-insensitive pattern', () => {
  const partial = tobaccoProductSearch('qa-unk');
  assert.equal(partial.searchRequired, false);
  if (!partial.searchRequired) {
    const fields = (partial.clause.$or as Array<Record<string, { $regex: string; $options: string }>>).map((item) => Object.keys(item)[0]);
    assert.deepEqual(fields, ['name', 'sku', 'barcode', 'product_id']);
    for (const item of partial.clause.$or as Array<Record<string, { $regex: string; $options: string }>>) {
      const value = Object.values(item)[0];
      assert.equal(value.$regex, 'qa-unk');
      assert.equal(value.$options, 'i');
    }
  }
  assert.equal(pattern(tobaccoProductSearch('QA-UNK-001')), 'QA-UNK-001');
  assert.equal(pattern(tobaccoProductSearch('qa.unk')), 'qa\\.unk');
  assert.equal(tobaccoProductSearch('a'.repeat(120)).searchRequired, false);
  assert.equal(pattern(tobaccoProductSearch('a'.repeat(120))).length, 80);
});
