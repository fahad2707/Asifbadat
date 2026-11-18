import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Local progress files for the product-code migration.
 *
 * One JSON file per run, under backend/var/product-code-journals (or
 * PRODUCT_CODE_JOURNAL_DIR). The file records ids, the plan digest, and each
 * product's identifier values before the run and the values that were
 * proposed. It does not record a connection string, a credential, or a product
 * document, and it is never executed. A later lock owner marks a file left in
 * "running" as "interrupted" and then builds a new plan from the database.
 * A dry run does not change a journal. The file is not a write instruction,
 * and reading it does not mean the catalogue change happened exactly once.
 *
 * A crash in the gap between a product write and the next journal write can
 * leave that id under "not attempted" even though the write landed. The next
 * plan reads the product and will not fill an identifier that is already set.
 * That gap is accepted because a standalone local mongod cannot make the
 * product write and the journal write one transaction.
 */

export type MigrationJournalStatus = 'running' | 'completed' | 'partially_failed' | 'interrupted';

export type MigrationJournalFailure = {
  id: string;
  reason: string;
};

export type MigrationJournalEntry = {
  id: string;
  before: { product_id: string; sku: string };
  set: { product_id?: string; sku?: string };
};

export type IdentifierRecoveryClass = 'completed' | 'not_completed' | 'uncertain';

export type MigrationJournal = {
  runId: string;
  databaseName: string;
  connectionHost: string;
  planDigest: string;
  startedAt: string;
  completedAt: string | null;
  updatedIds: string[];
  failed: MigrationJournalFailure[];
  notAttempted: string[];
  entries: MigrationJournalEntry[];
  status: MigrationJournalStatus;
};

export type MigrationJournalBegin = {
  databaseName: string;
  connectionHost: string;
  planDigest: string;
  notAttempted: string[];
  entries?: MigrationJournalEntry[];
};

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set<MigrationJournalStatus>(['running', 'completed', 'partially_failed', 'interrupted']);

export function defaultJournalDirectory(): string {
  const override = process.env.PRODUCT_CODE_JOURNAL_DIR?.trim();
  if (override) return override;
  return path.join(__dirname, '../../var/product-code-journals');
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value;
}

function codeText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function entryList(value: unknown): MigrationJournalEntry[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const entries: MigrationJournalEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    const before = record.before;
    const set = record.set;
    if (typeof record.id !== 'string' || !before || typeof before !== 'object' || !set || typeof set !== 'object') {
      return null;
    }
    const beforeRecord = before as Record<string, unknown>;
    const setRecord = set as Record<string, unknown>;
    const beforeProductId = codeText(beforeRecord.product_id);
    const beforeSku = codeText(beforeRecord.sku);
    if (beforeProductId === null || beforeSku === null) return null;
    const proposed: MigrationJournalEntry['set'] = {};
    if (setRecord.product_id !== undefined) {
      const productId = codeText(setRecord.product_id);
      if (productId === null) return null;
      proposed.product_id = productId;
    }
    if (setRecord.sku !== undefined) {
      const sku = codeText(setRecord.sku);
      if (sku === null) return null;
      proposed.sku = sku;
    }
    entries.push({
      id: record.id,
      before: { product_id: beforeProductId, sku: beforeSku },
      set: proposed,
    });
  }
  return entries;
}

/**
 * Compares one journal entry with the product's identifiers as they are now.
 * Does not write. A match with the proposal is "completed". A match with the
 * saved before-values is "not_completed". Anything else, including a product
 * that could not be read, is "uncertain".
 */
export function classifyIdentifierRecovery(
  entry: MigrationJournalEntry,
  current: { product_id: string; sku: string } | null
): IdentifierRecoveryClass {
  if (!current) return 'uncertain';
  const fields = (['product_id', 'sku'] as const).filter((field) => entry.set[field] !== undefined);
  if (fields.length === 0) return 'uncertain';
  let completed = 0;
  let unchanged = 0;
  for (const field of fields) {
    const proposed = entry.set[field] as string;
    const before = entry.before[field];
    const now = current[field];
    if (now === proposed && now !== before) completed += 1;
    else if (now === before) unchanged += 1;
    else return 'uncertain';
  }
  if (completed === fields.length) return 'completed';
  if (unchanged === fields.length) return 'not_completed';
  return 'uncertain';
}

function failureList(value: unknown): MigrationJournalFailure[] | null {
  if (!Array.isArray(value)) return null;
  const failures: MigrationJournalFailure[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.reason !== 'string') return null;
    failures.push({ id: record.id, reason: record.reason });
  }
  return failures;
}

/** Keeps only the journal fields. Anything else in the file, including a URI, is dropped. */
export function sanitizeMigrationJournal(journal: MigrationJournal): MigrationJournal {
  return {
    runId: journal.runId,
    databaseName: journal.databaseName,
    connectionHost: journal.connectionHost,
    planDigest: journal.planDigest,
    startedAt: journal.startedAt,
    completedAt: journal.completedAt,
    updatedIds: [...journal.updatedIds],
    failed: journal.failed.map((failure) => ({ id: failure.id, reason: failure.reason })),
    notAttempted: [...journal.notAttempted],
    entries: journal.entries.map((entry) => ({
      id: entry.id,
      before: { product_id: entry.before.product_id, sku: entry.before.sku },
      set: {
        ...(entry.set.product_id !== undefined ? { product_id: entry.set.product_id } : {}),
        ...(entry.set.sku !== undefined ? { sku: entry.set.sku } : {}),
      },
    })),
    status: journal.status,
  };
}

function parseJournal(raw: string, fileId: string): MigrationJournal | null {
  if (!RUN_ID.test(fileId)) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (typeof status !== 'string' || !STATUSES.has(status as MigrationJournalStatus)) return null;
  if (record.runId !== fileId) return null;
  if (typeof record.databaseName !== 'string' || typeof record.connectionHost !== 'string') return null;
  if (typeof record.planDigest !== 'string' || typeof record.startedAt !== 'string') return null;
  const updatedIds = stringList(record.updatedIds);
  const notAttempted = stringList(record.notAttempted);
  const failed = failureList(record.failed);
  const entries = entryList(record.entries);
  if (!updatedIds || !notAttempted || !failed || !entries) return null;
  return sanitizeMigrationJournal({
    runId: fileId,
    databaseName: record.databaseName,
    connectionHost: record.connectionHost,
    planDigest: record.planDigest,
    startedAt: record.startedAt,
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : null,
    updatedIds,
    failed,
    notAttempted,
    entries,
    status: status as MigrationJournalStatus,
  });
}

async function writeJournalFile(directory: string, journal: MigrationJournal): Promise<void> {
  const clean = sanitizeMigrationJournal(journal);
  if (!RUN_ID.test(clean.runId)) {
    throw new Error('Refusing to write an execution journal with an unsafe run id.');
  }
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${clean.runId}.json`);
  const temporary = path.join(directory, `${clean.runId}.${process.pid}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(clean), 'utf8');
  await fs.rename(temporary, target);
}

async function settleInterruptedJournals(directory: string, databaseName: string): Promise<MigrationJournal[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') return [];
    throw error;
  }
  const interrupted: MigrationJournal[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const fileId = name.slice(0, -'.json'.length);
    const raw = await fs.readFile(path.join(directory, name), 'utf8');
    const journal = parseJournal(raw, fileId);
    if (!journal || journal.status !== 'running' || journal.databaseName !== databaseName) continue;
    const marked = sanitizeMigrationJournal({
      ...journal,
      status: 'interrupted',
      completedAt: new Date().toISOString(),
    });
    await writeJournalFile(directory, marked);
    interrupted.push(marked);
  }
  return interrupted;
}

async function beginMigrationJournal(directory: string, input: MigrationJournalBegin): Promise<MigrationJournal> {
  const journal = sanitizeMigrationJournal({
    runId: randomUUID(),
    databaseName: input.databaseName,
    connectionHost: input.connectionHost,
    planDigest: input.planDigest,
    startedAt: new Date().toISOString(),
    completedAt: null,
    updatedIds: [],
    failed: [],
    notAttempted: [...input.notAttempted],
    entries: input.entries ? input.entries.map((entry) => ({
      id: entry.id,
      before: { product_id: entry.before.product_id, sku: entry.before.sku },
      set: {
        ...(entry.set.product_id !== undefined ? { product_id: entry.set.product_id } : {}),
        ...(entry.set.sku !== undefined ? { sku: entry.set.sku } : {}),
      },
    })) : [],
    status: 'running',
  });
  await writeJournalFile(directory, journal);
  return journal;
}

async function listRunningJournals(directory: string, databaseName: string): Promise<MigrationJournal[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') return [];
    throw error;
  }
  const running: MigrationJournal[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const fileId = name.slice(0, -'.json'.length);
    const raw = await fs.readFile(path.join(directory, name), 'utf8');
    const journal = parseJournal(raw, fileId);
    if (!journal || journal.status !== 'running' || journal.databaseName !== databaseName) continue;
    running.push(journal);
  }
  return running;
}

export const migrationJournal = {
  directory(): string {
    return defaultJournalDirectory();
  },
  /** Reads running journals and does not change them. */
  listRunning(databaseName: string): Promise<MigrationJournal[]> {
    return listRunningJournals(migrationJournal.directory(), databaseName);
  },
  settle(databaseName: string): Promise<MigrationJournal[]> {
    return settleInterruptedJournals(migrationJournal.directory(), databaseName);
  },
  begin(input: MigrationJournalBegin): Promise<MigrationJournal> {
    return beginMigrationJournal(migrationJournal.directory(), input);
  },
  record(journal: MigrationJournal): Promise<void> {
    return writeJournalFile(migrationJournal.directory(), journal);
  },
};
