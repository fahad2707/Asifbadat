/**
 * Explicit migration for the active exemption unique index.
 *
 * Application startup does not create indexes. `npm run migrate` is not used,
 * because that command creates a default administrator and is not an index
 * migration. This module only reads exemption identities and, when asked,
 * creates `active_customer_certificate`. It does not drop indexes, delete
 * documents, or change exemption records.
 *
 * The index matches ACTIVE_CUSTOMER_CERTIFICATE_INDEX. A conflict is two or
 * more active rows with the same customer and the same stored certificate_key.
 * Rejected, revoked, and expired rows are outside the partial filter.
 *
 * Two legacy shapes do not block index creation and are not rewritten:
 * a row with no string certificate_key, and active rows whose stored keys
 * differ but normalize to the same certificate number. They are reported as
 * warnings. The index compares the stored key exactly, so it does not cover them.
 */

import type { Collection, IndexDescription } from 'mongodb';
import { ACTIVE_CUSTOMER_CERTIFICATE_INDEX } from '../../models/SalesTaxExemption';
import { ACTIVE_EXEMPTION_STATUSES, certificateKey } from './exemptionDraft';

export type ActiveCertificateConflict = {
  customerId: string;
  certificateKey: string;
  ids: string[];
};

export type MissingCertificateKeyWarning = {
  count: number;
  activeCount: number;
  sampleIds: string[];
};

export type CaseVariantCertificateWarning = {
  customerId: string;
  normalizedKey: string;
  storedKeys: string[];
  ids: string[];
};

export type ExemptionIndexWarnings = {
  missingCertificateKey: MissingCertificateKeyWarning;
  caseVariantGroups: CaseVariantCertificateWarning[];
};

export function emptyExemptionIndexWarnings(): ExemptionIndexWarnings {
  return {
    missingCertificateKey: { count: 0, activeCount: 0, sampleIds: [] },
    caseVariantGroups: [],
  };
}

export function formatExemptionIndexWarnings(warnings: ExemptionIndexWarnings): string[] {
  const lines: string[] = [];
  if (warnings.missingCertificateKey.count > 0) {
    lines.push(
      `WARNING: ${warnings.missingCertificateKey.count} exemption row(s) have no certificate_key (${warnings.missingCertificateKey.activeCount} active). The unique index does not cover them. No record was modified.`
    );
  }
  if (warnings.caseVariantGroups.length > 0) {
    lines.push(
      `WARNING: ${warnings.caseVariantGroups.length} active certificate group(s) normalize to the same certificate number but are stored with different keys. The unique index compares the stored key exactly. No record was modified.`
    );
  }
  return lines;
}

export class ExemptionIndexConflictError extends Error {
  readonly conflicts: ActiveCertificateConflict[];
  readonly warnings: ExemptionIndexWarnings;

  constructor(conflicts: ActiveCertificateConflict[], warnings: ExemptionIndexWarnings = emptyExemptionIndexWarnings()) {
    const shown = conflicts.slice(0, 20).map((conflict) => (
      `customer ${conflict.customerId}, certificate ${conflict.certificateKey}: ${conflict.ids.join(', ')}`
    ));
    const remaining = conflicts.length > shown.length ? `\n${conflicts.length - shown.length} more conflict(s) not listed.` : '';
    const warningText = formatExemptionIndexWarnings(warnings);
    super(
      `Active exemption index was not created. ${conflicts.length} active certificate conflict(s) were found. No exemption was modified or deleted. Resolve these records manually, then rerun the migration.\n${shown.join('\n')}${remaining}${warningText.length ? `\n${warningText.join('\n')}` : ''}`
    );
    this.name = 'ExemptionIndexConflictError';
    this.conflicts = conflicts;
    this.warnings = warnings;
  }
}

export class ExemptionIndexMismatchError extends Error {
  constructor() {
    super(
      'An index named active_customer_certificate already exists with a different definition. It was not dropped or changed. No exemption was modified.'
    );
    this.name = 'ExemptionIndexMismatchError';
  }
}

export type EnsureActiveExemptionIndexResult = {
  outcome: 'created' | 'already_present' | 'preflight_only';
  conflictCount: number;
  activeRowCount: number;
  warnings: ExemptionIndexWarnings;
};

type GroupedIdentity = {
  _id?: { customer_id?: unknown; certificate_key?: unknown };
  ids?: unknown[];
  count?: number;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${key}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function activeCertificateIndexMatches(existing: IndexDescription): boolean {
  return existing.name === ACTIVE_CUSTOMER_CERTIFICATE_INDEX.options.name
    && existing.unique === true
    && stable(existing.key) === stable(ACTIVE_CUSTOMER_CERTIFICATE_INDEX.fields)
    && stable(existing.partialFilterExpression) === stable(ACTIVE_CUSTOMER_CERTIFICATE_INDEX.options.partialFilterExpression);
}

const ACTIVE_STATUS = new Set<string>(ACTIVE_EXEMPTION_STATUSES);

export function exemptionIndexWarnings(rows: Array<{
  id: string;
  customerId: string;
  status: string;
  certificateKey: unknown;
}>): ExemptionIndexWarnings {
  const sampleIds: string[] = [];
  let count = 0;
  let activeCount = 0;
  const buckets = new Map<string, { customerId: string; normalizedKey: string; stored: Map<string, string[]> }>();
  for (const row of rows) {
    const active = ACTIVE_STATUS.has(row.status);
    if (typeof row.certificateKey !== 'string') {
      count += 1;
      if (active) activeCount += 1;
      if (sampleIds.length < 20) sampleIds.push(row.id);
      continue;
    }
    if (!active) continue;
    const normalized = certificateKey(row.certificateKey);
    if (!normalized) continue;
    const bucketKey = `${row.customerId}\0${normalized}`;
    const bucket = buckets.get(bucketKey) ?? {
      customerId: row.customerId,
      normalizedKey: normalized,
      stored: new Map<string, string[]>(),
    };
    const ids = bucket.stored.get(row.certificateKey) ?? [];
    ids.push(row.id);
    bucket.stored.set(row.certificateKey, ids);
    buckets.set(bucketKey, bucket);
  }
  return {
    missingCertificateKey: { count, activeCount, sampleIds },
    caseVariantGroups: [...buckets.values()]
      .filter((bucket) => bucket.stored.size > 1)
      .map((bucket) => ({
        customerId: bucket.customerId,
        normalizedKey: bucket.normalizedKey,
        storedKeys: [...bucket.stored.keys()].sort(),
        ids: [...bucket.stored.values()].flat(),
      })),
  };
}

export function conflictsFromGroups(groups: GroupedIdentity[]): ActiveCertificateConflict[] {
  return groups
    .filter((group) => Number(group.count) > 1)
    .map((group) => ({
      customerId: String(group._id?.customer_id ?? ''),
      certificateKey: String(group._id?.certificate_key ?? ''),
      ids: (group.ids ?? []).map((id) => String(id)),
    }));
}

async function listedIndexes(collection: Collection): Promise<IndexDescription[]> {
  try {
    return await collection.indexes();
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
    if (code === 26) return [];
    throw error;
  }
}

async function activeGroups(collection: Collection): Promise<GroupedIdentity[]> {
  try {
    return await collection.aggregate<GroupedIdentity>([
      {
        $match: {
          status: { $in: [...ACTIVE_EXEMPTION_STATUSES] },
          certificate_key: { $type: 'string' },
        },
      },
      {
        $group: {
          _id: { customer_id: '$customer_id', certificate_key: '$certificate_key' },
          ids: { $push: { $toString: '$_id' } },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
    if (code === 26) return [];
    throw error;
  }
}

async function readExemptionIdentities(collection: Collection): Promise<Array<{
  id: string;
  customerId: string;
  status: string;
  certificateKey: unknown;
}>> {
  try {
    const rows = await collection.find(
      {},
      { projection: { customer_id: 1, status: 1, certificate_key: 1 } }
    ).toArray();
    return rows.map((row) => ({
      id: String(row._id),
      customerId: String(row.customer_id ?? ''),
      status: typeof row.status === 'string' ? row.status : '',
      certificateKey: row.certificate_key,
    }));
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
    if (code === 26) return [];
    throw error;
  }
}

export async function countActiveCertificateRows(collection: Collection): Promise<number> {
  try {
    return await collection.countDocuments({
      status: { $in: [...ACTIVE_EXEMPTION_STATUSES] },
      certificate_key: { $type: 'string' },
    });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
    if (code === 26) return 0;
    throw error;
  }
}

/**
 * Read-only unless `apply` is true and the preflight is clean.
 * A second successful call does not recreate or drop the index.
 */
export async function ensureActiveExemptionIndex(
  collection: Collection,
  options: { apply: boolean }
): Promise<EnsureActiveExemptionIndexResult> {
  const indexes = await listedIndexes(collection);
  const named = indexes.find((index) => index.name === ACTIVE_CUSTOMER_CERTIFICATE_INDEX.options.name);
  if (named && !activeCertificateIndexMatches(named)) throw new ExemptionIndexMismatchError();
  const conflicts = conflictsFromGroups(await activeGroups(collection));
  const warnings = exemptionIndexWarnings(await readExemptionIdentities(collection));
  const activeRowCount = await countActiveCertificateRows(collection);
  if (conflicts.length > 0) throw new ExemptionIndexConflictError(conflicts, warnings);
  const result = { conflictCount: 0, activeRowCount, warnings };
  if (named) return { outcome: 'already_present', ...result };
  if (!options.apply) return { outcome: 'preflight_only', ...result };
  await collection.createIndex(
    { ...ACTIVE_CUSTOMER_CERTIFICATE_INDEX.fields },
    ACTIVE_CUSTOMER_CERTIFICATE_INDEX.options
  );
  return { outcome: 'created', ...result };
}
