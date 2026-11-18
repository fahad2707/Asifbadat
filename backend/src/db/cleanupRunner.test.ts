/**
 * Guarded cleanup runner — fake dependencies, no Mongo connection.
 *
 * Run with:
 *     npx tsx --test src/db/cleanupRunner.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  assertPlanIsAllowed,
  runGuardedCleanup,
  type CleanupConfig,
  type CleanupDeps,
  type CleanupOperation,
} from './cleanupRunner';
import {
  ACKNOWLEDGE_CATALOGUE_DELETION_FLAG,
  CONFIRM_DATABASE_FLAG,
  CleanupSafeguardError,
  type ConnectedTargetEvidence,
} from './cleanupSafeguards';

const DB = 'express_distributors_dev';
const CONFIRM = `${CONFIRM_DATABASE_FLAG}=${DB}`;

function assertNoMongoConnection() {
  assert.equal(mongoose.connection.readyState, 0, 'runner tests must not open a MongoDB connection');
}

type Trace = {
  events: string[];
  logs: string[];
  errors: string[];
};

function fakeOperation(trace: Trace, overrides: Partial<CleanupOperation> & { label: string; collection: string }): CleanupOperation {
  return {
    kind: 'delete',
    action: 'delete all documents',
    count: async () => {
      trace.events.push(`count:${overrides.label}`);
      return 7;
    },
    run: async () => {
      trace.events.push(`run:${overrides.label}`);
      return 7;
    },
    ...overrides,
  };
}

function harness(options: {
  argv?: string[];
  env?: CleanupDeps['env'];
  evidence?: Partial<ConnectedTargetEvidence>;
  localHostnames?: string[];
} = {}) {
  const trace: Trace = { events: [], logs: [], errors: [] };
  const deps: CleanupDeps = {
    argv: options.argv || [],
    env: options.env || { MONGODB_URI: 'mongodb://127.0.0.1:27017/express_distributors_dev', NODE_ENV: 'development' },
    localHostnames: options.localHostnames || ['dev-laptop.local'],
    connect: async () => {
      trace.events.push('connect');
    },
    describeConnection: async () => {
      trace.events.push('describe');
      return {
        databaseName: DB,
        connectionHost: '127.0.0.1',
        serverReportedHosts: [],
        serverHostname: 'dev-laptop.local',
        isMongosRouter: false,
        ...options.evidence,
      };
    },
    disconnect: async () => {
      trace.events.push('disconnect');
    },
    listCollectionNames: async () => [],
    rawCollection: () => ({
      countDocuments: async () => 0,
      deleteMany: async () => {
        trace.events.push('raw-delete');
        return { deletedCount: 0 };
      },
    }),
    log: (line) => trace.logs.push(line),
    error: (line) => trace.errors.push(line),
  };
  return { trace, deps };
}

function config(trace: Trace, overrides: Partial<CleanupConfig> = {}): CleanupConfig {
  return {
    command: 'npm run example',
    title: 'Example cleanup',
    allowsCatalogueDeletion: false,
    allowsAuditLogDeletion: false,
    buildOperations: async () => {
      trace.events.push('build');
      return [
        fakeOperation(trace, { label: 'Customers', collection: 'customers' }),
        fakeOperation(trace, { label: 'Invoices', collection: 'invoices' }),
      ];
    },
    ...overrides,
  };
}

const ran = (trace: Trace) => trace.events.filter((event) => event.startsWith('run:') || event === 'raw-delete');

test('default run is a dry run: counts are read, nothing is executed, exit code 0', async () => {
  assertNoMongoConnection();
  const { trace, deps } = harness();

  const code = await runGuardedCleanup(config(trace), deps);

  assert.equal(code, 0);
  assert.deepEqual(trace.events, ['connect', 'describe', 'build', 'count:Customers', 'count:Invoices', 'disconnect']);
  assert.deepEqual(ran(trace), []);
  assert.ok(trace.logs.includes('DRY RUN: nothing was deleted or changed.'));
});

test('dry run does not read invariants or run operations even when confirmations are also present', async () => {
  assertNoMongoConnection();
  const { trace, deps } = harness({ argv: [CONFIRM, '--dry-run'] });
  let invariantReads = 0;

  const code = await runGuardedCleanup(
    config(trace, {
      invariants: [{ label: 'x', read: async () => ++invariantReads, expect: 'unchanged' }],
    }),
    deps
  );

  assert.equal(code, 0);
  assert.deepEqual(ran(trace), []);
  assert.equal(invariantReads, 0);
});

test('dry-run report names database, host, each collection, its count, operation, catalogue and image impact', async () => {
  assertNoMongoConnection();
  const { trace, deps } = harness();

  await runGuardedCleanup(
    config(trace, {
      allowsCatalogueDeletion: true,
      buildOperations: async () => [
        fakeOperation(trace, { label: 'Products', collection: 'products' }),
        fakeOperation(trace, { label: 'Customers', collection: 'customers', note: 'example note' }),
        fakeOperation(trace, {
          label: 'Products (reservations only)',
          collection: 'products',
          kind: 'update',
          action: 'set committed_quantity to 0',
          fields: ['committed_quantity'],
        }),
      ],
    }),
    deps
  );

  const report = trace.logs.join('\n');
  assert.match(report, /Connected database : express_distributors_dev/);
  assert.match(report, /Connected host     : 127\.0\.0\.1/);
  assert.match(report, /Target check       : MongoDB server is on this machine/);
  assert.match(report, /1\. Products \[products\]\n\s+documents\s+: 7\n\s+operation\s+: delete all documents/);
  assert.match(report, /product catalogue  : YES - records DELETED\n\s+image references   : YES - image_url deleted with the records/);
  assert.match(report, /2\. Customers \[customers\]\n\s+documents\s+: 7\n\s+operation\s+: delete all documents\n\s+product catalogue  : no\n\s+image references   : no\n\s+note\s+: example note/);
  assert.match(report, /product catalogue  : YES - field\(s\) committed_quantity modified, records kept\n\s+image references   : no/);
  assert.match(report, /Product catalogue records deleted : YES \(Products\)/);
  assert.match(report, /Image references affected         : YES \(Products\)/);
  assert.match(report, /Cloudinary                        : no remote image is deleted by this script/);
  assert.match(
    report,
    /To execute, type on this run: npm run example -- --confirm-database=<database name shown above> --acknowledge-catalogue-deletion/
  );
  assert.doesNotMatch(report, new RegExp(`${CONFIRM_DATABASE_FLAG}=${DB}`), 'the hint must not be copy-pasteable');
});

test('with the database confirmation, operations run in plan order and exit code is 0', async () => {
  assertNoMongoConnection();
  const { trace, deps } = harness({ argv: [CONFIRM] });

  const code = await runGuardedCleanup(config(trace), deps);

  assert.equal(code, 0);
  assert.deepEqual(ran(trace), ['run:Customers', 'run:Invoices']);
  assert.equal(trace.events.at(-1), 'disconnect');
});

test('a remote MONGODB_URI is refused before any connection is opened, with NODE_ENV=development', async () => {
  assertNoMongoConnection();
  const { trace, deps } = harness({
    argv: [CONFIRM, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG],
    env: { MONGODB_URI: 'mongodb+srv://user:secret@cluster0.example.mongodb.net/test', NODE_ENV: 'development' },
  });

  const code = await runGuardedCleanup(config(trace), deps);

  assert.equal(code, 1);
  assert.deepEqual(trace.events, [], 'no connect, no describe, no plan, no operations');
  const output = trace.errors.join('\n');
  assert.match(output, /REFUSED: Example cleanup did not run\. Nothing was deleted or changed\./);
  assert.match(output, /No database connection was opened\./);
  assert.doesNotMatch(output + trace.logs.join('\n'), /secret/);
});

test('NODE_ENV=production is refused before any connection is opened', async () => {
  assertNoMongoConnection();
  const { trace, deps } = harness({
    argv: [CONFIRM],
    env: { MONGODB_URI: 'mongodb://127.0.0.1:27017/x', NODE_ENV: 'production' },
  });

  assert.equal(await runGuardedCleanup(config(trace), deps), 1);
  assert.deepEqual(trace.events, []);
});

test('a server that is not on this machine is refused after connecting, before the plan is built', async () => {
  assertNoMongoConnection();
  const remoteEvidence: Array<Partial<ConnectedTargetEvidence>> = [
    { serverHostname: 'prod-db-01' },
    { serverReportedHosts: ['cluster0-shard-00-00.example.mongodb.net:27017'] },
    { connectionHost: 'db.internal.example' },
    { isMongosRouter: true },
    { serverHostname: undefined },
    { serverReportedHosts: undefined },
    { databaseName: '' },
  ];
  for (const evidence of remoteEvidence) {
    const { trace, deps } = harness({ argv: [CONFIRM, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG], evidence });

    const code = await runGuardedCleanup(config(trace), deps);

    assert.equal(code, 1, JSON.stringify(evidence));
    assert.deepEqual(trace.events, ['connect', 'describe', 'disconnect'], JSON.stringify(evidence));
  }
});

test('a script restricted to one database name refuses any other database', async () => {
  assertNoMongoConnection();
  const { trace, deps } = harness({ argv: [`${CONFIRM_DATABASE_FLAG}=other_db`], evidence: { databaseName: 'other_db' } });

  const code = await runGuardedCleanup(config(trace, { requiredDatabaseName: DB }), deps);

  assert.equal(code, 1);
  assert.deepEqual(trace.events, ['connect', 'describe', 'disconnect']);
  assert.match(trace.errors.join('\n'), /only runs against the database "express_distributors_dev", not "other_db"/);
});

test('wrong, missing or incomplete confirmations are refused and nothing runs', async () => {
  assertNoMongoConnection();
  const catalogueConfig = (trace: Trace) =>
    config(trace, {
      allowsCatalogueDeletion: true,
      buildOperations: async () => [fakeOperation(trace, { label: 'Products', collection: 'products' })],
    });
  const attempts = [
    [`${CONFIRM_DATABASE_FLAG}=test`, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG],
    [CONFIRM],
    [ACKNOWLEDGE_CATALOGUE_DELETION_FLAG],
    [CONFIRM_DATABASE_FLAG, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG],
  ];
  for (const argv of attempts) {
    const { trace, deps } = harness({ argv });

    const code = await runGuardedCleanup(catalogueConfig(trace), deps);

    assert.equal(code, 1, argv.join(' '));
    assert.deepEqual(ran(trace), [], argv.join(' '));
    assert.match(trace.errors.join('\n'), /REFUSED/);
  }

  const { trace, deps } = harness({ argv: [CONFIRM, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG] });
  assert.equal(await runGuardedCleanup(catalogueConfig(trace), deps), 0);
  assert.deepEqual(ran(trace), ['run:Products']);
});

test('a confirmation stored in the launching package.json script is refused', async () => {
  assertNoMongoConnection();
  const { trace, deps } = harness({
    argv: [CONFIRM],
    env: {
      MONGODB_URI: 'mongodb://127.0.0.1:27017/express_distributors_dev',
      NODE_ENV: 'development',
      npm_lifecycle_script: `tsx src/db/example.ts ${CONFIRM}`,
    },
  });

  assert.equal(await runGuardedCleanup(config(trace), deps), 1);
  assert.deepEqual(ran(trace), []);
  assert.match(trace.errors.join('\n'), /stored in the package\.json script/);
});

test('a plan that deletes catalogue records is rejected for a script not allowed to, before counting', async () => {
  assertNoMongoConnection();
  for (const collection of ['products', 'categories', 'subcategories']) {
    const { trace, deps } = harness({ argv: [CONFIRM, ACKNOWLEDGE_CATALOGUE_DELETION_FLAG] });

    await assert.rejects(
      () =>
        runGuardedCleanup(
          config(trace, {
            buildOperations: async () => [
              fakeOperation(trace, { label: 'Customers', collection: 'customers' }),
              fakeOperation(trace, { label: 'Sneaky', collection }),
            ],
          }),
          deps
        ),
      (err: unknown) =>
        err instanceof CleanupSafeguardError && err.message.includes(`would delete product catalogue records (${collection})`)
    );
    assert.deepEqual(trace.events, ['connect', 'describe', 'disconnect'], 'nothing counted or run; connection closed');
  }
});

test('a plan that touches audit history is rejected unless the script is a full reset', async () => {
  assertNoMongoConnection();
  const { trace } = harness();
  const deleteAudit = fakeOperation(trace, { label: 'Audit logs', collection: 'auditlogs' });
  const updateAudit = fakeOperation(trace, {
    label: 'Audit logs',
    collection: 'auditlogs',
    kind: 'update',
    fields: ['details'],
  });

  assert.throws(() => assertPlanIsAllowed(config(trace), [deleteAudit]), /would delete audit history/);
  assert.doesNotThrow(() => assertPlanIsAllowed(config(trace, { allowsAuditLogDeletion: true }), [deleteAudit]));
  assert.throws(
    () => assertPlanIsAllowed(config(trace, { allowsAuditLogDeletion: true }), [updateAudit]),
    /would update audit history/,
    'audit records are never modified, even by a full reset'
  );
});

test('an update that would overwrite a protected product field is rejected', () => {
  assertNoMongoConnection();
  const { trace } = harness();
  for (const field of ['image_url', 'sku', 'price', 'cost_price', 'stock_quantity']) {
    const operation = fakeOperation(trace, {
      label: 'Products',
      collection: 'products',
      kind: 'update',
      fields: ['committed_quantity', field],
    });
    assert.throws(
      () => assertPlanIsAllowed(config(trace, { allowsCatalogueDeletion: true }), [operation]),
      (err: unknown) => err instanceof CleanupSafeguardError && err.message.includes(`protected product field(s) ${field}`)
    );
  }
  const undeclared = fakeOperation(trace, { label: 'Products', collection: 'products', kind: 'update' });
  assert.throws(() => assertPlanIsAllowed(config(trace), [undeclared]), /does not declare the fields it writes/);

  const reservations = fakeOperation(trace, {
    label: 'Products',
    collection: 'products',
    kind: 'update',
    fields: ['committed_quantity'],
  });
  assert.doesNotThrow(() => assertPlanIsAllowed(config(trace), [reservations]));
});

test('invariants are read before and after execution and a violation fails the run', async () => {
  assertNoMongoConnection();
  const values = { products: [1400, 1399], audit: [10, 12] };
  const { trace, deps } = harness({ argv: [CONFIRM] });

  const code = await runGuardedCleanup(
    config(trace, {
      invariants: [
        { label: 'Product count unchanged', read: async () => values.products.shift()!, expect: 'unchanged' },
        { label: 'Audit log count not decreased', read: async () => values.audit.shift()!, expect: 'not-decreased' },
      ],
    }),
    deps
  );

  assert.equal(code, 1);
  assert.match(trace.errors.join('\n'), /SAFETY CHECK FAILED: Product count unchanged \(before: 1400, after: 1399\)/);
  assert.ok(trace.logs.includes('  Safety check passed: Audit log count not decreased'));
});

test('a decreased "not-decreased" invariant fails the run', async () => {
  assertNoMongoConnection();
  const audit = [10, 9];
  const { trace, deps } = harness({ argv: [CONFIRM] });

  const code = await runGuardedCleanup(
    config(trace, {
      invariants: [{ label: 'Audit log count not decreased', read: async () => audit.shift()!, expect: 'not-decreased' }],
    }),
    deps
  );

  assert.equal(code, 1);
  assert.match(trace.errors.join('\n'), /SAFETY CHECK FAILED: Audit log count not decreased/);
});

test('an operation error is reported, later operations still run, and the exit code is 1', async () => {
  assertNoMongoConnection();
  const { trace, deps } = harness({ argv: [CONFIRM] });

  const code = await runGuardedCleanup(
    config(trace, {
      buildOperations: async () => [
        fakeOperation(trace, {
          label: 'Customers',
          collection: 'customers',
          run: async () => {
            throw new Error('write failed');
          },
        }),
        fakeOperation(trace, { label: 'Invoices', collection: 'invoices' }),
      ],
    }),
    deps
  );

  assert.equal(code, 1);
  assert.deepEqual(ran(trace), ['run:Invoices']);
  assert.match(trace.errors.join('\n'), /Customers: ERROR - write failed/);
});

test('a failing preflight stops the run before the target is even evaluated', async () => {
  assertNoMongoConnection();
  const { trace, deps } = harness({ argv: [CONFIRM] });

  await assert.rejects(
    () =>
      runGuardedCleanup(
        config(trace, {
          preflight: () => {
            throw new CleanupSafeguardError('plan is unsafe');
          },
        }),
        deps
      ),
    /plan is unsafe/
  );
  assert.deepEqual(trace.events, []);
});
