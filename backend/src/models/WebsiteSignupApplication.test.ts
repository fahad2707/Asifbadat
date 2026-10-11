/**
 * WebsiteSignupApplication schema invariants.
 *
 * Run with:
 *     npx tsx --test src/models/WebsiteSignupApplication.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebsiteSignupApplication, {
  WEBSITE_SIGNUP_LINK_OUTCOMES,
  WEBSITE_SIGNUP_MATCH_KINDS,
  WEBSITE_SIGNUP_STATUSES,
  WEBSITE_SIGNUP_STATUS_PENDING,
} from './WebsiteSignupApplication';

test('schema enums and required fields', () => {
  const status = WebsiteSignupApplication.schema.path('status') as { options?: { enum?: unknown[]; default?: unknown } };
  const link = WebsiteSignupApplication.schema.path('link_outcome') as { options?: { enum?: unknown[] }; isRequired?: boolean };
  const match = WebsiteSignupApplication.schema.path('match_kind') as { options?: { enum?: unknown[] } };
  const userId = WebsiteSignupApplication.schema.path('user_id') as { isRequired?: boolean };

  assert.deepEqual(status.options?.enum, [...WEBSITE_SIGNUP_STATUSES]);
  assert.equal(status.options?.default, WEBSITE_SIGNUP_STATUS_PENDING);
  assert.deepEqual(link.options?.enum, [...WEBSITE_SIGNUP_LINK_OUTCOMES]);
  assert.equal(Boolean(link.isRequired), true);
  assert.deepEqual(match.options?.enum, [...WEBSITE_SIGNUP_MATCH_KINDS]);
  assert.equal(Boolean(userId.isRequired), true);
});

test('unique user_id index and status queue index exist', () => {
  const indexes = WebsiteSignupApplication.schema.indexes();
  const hasUserUnique = indexes.some(
    ([fields, opts]) =>
      (fields as Record<string, number>).user_id === 1 && Boolean((opts as { unique?: boolean })?.unique)
  );
  const hasStatusCreated = indexes.some(
    ([fields]) =>
      (fields as Record<string, number>).status === 1 &&
      (fields as Record<string, number>).created_at === -1
  );
  assert.equal(hasUserUnique, true);
  assert.equal(hasStatusCreated, true);
});
