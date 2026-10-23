import mongoose from 'mongoose';
import Shipment from '../models/Shipment';
import ShipmentPackage, {
  IShipmentPackage,
  NOTES_MAX_LENGTH,
} from '../models/ShipmentPackage';
import {
  generatePackageCode,
  isPackageCodeDuplicateKey,
  isPackageCodeFormat,
  normalizePackageCode,
} from '../utils/packageCodes';

/** Hard cap per shipment — enforced inside a multi-doc transaction. */
export const MAX_PACKAGES_PER_SHIPMENT = 100;

/**
 * Bounded full-transaction restarts after a package_code unique-index collision (11000).
 * Each restart aborts the failed session and repeats Shipment serialize + count + all inserts.
 */
export const PACKAGE_CODE_TXN_RESTARTS = 5;

/** @deprecated Use PACKAGE_CODE_TXN_RESTARTS — same bound (legacy test/export name). */
export const PACKAGE_CODE_CREATE_RETRIES = PACKAGE_CODE_TXN_RESTARTS;

/** Bounded full-transaction restarts for TransientTransactionError / WriteConflict. */
export const PACKAGE_CREATE_TXN_RETRIES = 5;

/**
 * Retry only confirmed transient txn failures (repo convention: purchaseOrderReceiveService).
 * Does not treat UnknownTransactionCommitResult as a safe confirmed-abort retry.
 */
function isTransientTxnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as {
    errorLabels?: string[];
    code?: number;
    codeName?: string;
    hasErrorLabel?: (label: string) => boolean;
  };
  if (typeof err.hasErrorLabel === 'function' && err.hasErrorLabel('TransientTransactionError')) {
    return true;
  }
  if (Array.isArray(err.errorLabels) && err.errorLabels.includes('TransientTransactionError')) {
    return true;
  }
  if (err.code === 112) return true;
  if (err.codeName === 'WriteConflict') return true;
  return false;
}

export class PackageServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'PackageServiceError';
  }
}

export type PackageCreateSpec = { notes?: string };

export type PackageCreateInput =
  | { count: number; packages?: undefined }
  | { packages: PackageCreateSpec[]; count?: undefined };

function assertValidObjectId(id: string, label: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new PackageServiceError(400, `Invalid ${label}`);
  }
  return new mongoose.Types.ObjectId(id);
}

function normalizeNotes(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    throw new PackageServiceError(400, 'notes must be a string');
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > NOTES_MAX_LENGTH) {
    throw new PackageServiceError(400, `notes must be at most ${NOTES_MAX_LENGTH} characters`);
  }
  return trimmed;
}

/**
 * Canonical create body:
 * - `{ "count": N }` — create N packages with no notes (1 ≤ N ≤ 100)
 * - `{ "packages": [{ "notes"?: string }] }` — create one package per entry
 * Exactly one form required.
 */
export function resolvePackageCreateSpecs(body: unknown): PackageCreateSpec[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PackageServiceError(400, 'Request body must be an object');
  }
  const b = body as Record<string, unknown>;
  const hasCount = Object.prototype.hasOwnProperty.call(b, 'count');
  const hasPackages = Object.prototype.hasOwnProperty.call(b, 'packages');

  if (hasCount && hasPackages) {
    throw new PackageServiceError(400, 'Provide either count or packages, not both');
  }
  if (!hasCount && !hasPackages) {
    throw new PackageServiceError(400, 'Provide count or packages');
  }

  if (hasCount) {
    const n = b.count;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_PACKAGES_PER_SHIPMENT) {
      throw new PackageServiceError(
        400,
        `count must be an integer between 1 and ${MAX_PACKAGES_PER_SHIPMENT}`
      );
    }
    return Array.from({ length: n }, () => ({}));
  }

  if (!Array.isArray(b.packages) || b.packages.length === 0) {
    throw new PackageServiceError(400, 'packages must be a non-empty array');
  }
  if (b.packages.length > MAX_PACKAGES_PER_SHIPMENT) {
    throw new PackageServiceError(
      400,
      `packages length must be at most ${MAX_PACKAGES_PER_SHIPMENT}`
    );
  }
  return b.packages.map((entry, i) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new PackageServiceError(400, `packages[${i}] must be an object`);
    }
    const notes = normalizeNotes((entry as { notes?: unknown }).notes);
    return notes !== undefined ? { notes } : {};
  });
}

function serializePackage(doc: IShipmentPackage) {
  return {
    id: doc._id.toString(),
    package_code: doc.package_code,
    shipment_id: doc.shipment_id.toString(),
    shipment_number: doc.shipment_number,
    notes: doc.notes,
    created_by: doc.created_by?.toString(),
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

async function insertOnePackage(
  fields: {
    shipment_id: mongoose.Types.ObjectId;
    shipment_number?: string;
    notes?: string;
    created_by?: mongoose.Types.ObjectId;
  },
  session: mongoose.ClientSession
): Promise<IShipmentPackage> {
  const created = await ShipmentPackage.create(
    [
      {
        package_code: generatePackageCode(),
        shipment_id: fields.shipment_id,
        shipment_number: fields.shipment_number,
        notes: fields.notes,
        created_by: fields.created_by,
      },
    ],
    { session }
  );
  return (Array.isArray(created) ? created[0] : created) as IShipmentPackage;
}

/**
 * Create packages for a shipment.
 *
 * Concurrency: multi-document transaction (same topology requirement as
 * mark-delivered / GROUND_RG). Concurrent creators serialize on the Shipment
 * document via findOneAndUpdate before count+insert.
 *
 * package_code 11000: abort the failed transaction, end the session, and
 * restart the entire create transaction (new codes). Never insert again on
 * a session whose write may have aborted the txn.
 *
 * All packages in one request commit atomically — no partial success.
 */
export async function createPackagesForShipment(
  shipmentIdRaw: string,
  body: unknown,
  adminId?: string
) {
  const shipmentId = assertValidObjectId(shipmentIdRaw, 'shipment id');
  const specs = resolvePackageCreateSpecs(body);
  const createdBy =
    adminId && mongoose.Types.ObjectId.isValid(adminId)
      ? new mongoose.Types.ObjectId(adminId)
      : undefined;

  let codeCollisionAttempts = 0;
  let transientAttempts = 0;

  // Loop exits via return, throw, or exhaustion of a restart budget.
  for (;;) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // Serialize concurrent creators on this shipment; losers hit WriteConflict and retry.
      const shipment = await Shipment.findOneAndUpdate(
        { _id: shipmentId },
        { $currentDate: { updated_at: true } },
        { session, new: true }
      );
      if (!shipment) {
        throw new PackageServiceError(404, 'Shipment not found');
      }

      const existing = await ShipmentPackage.countDocuments({ shipment_id: shipmentId }).session(
        session
      );
      if (existing + specs.length > MAX_PACKAGES_PER_SHIPMENT) {
        throw new PackageServiceError(
          400,
          `Shipment may have at most ${MAX_PACKAGES_PER_SHIPMENT} packages (${existing} already exist)`
        );
      }

      const created: IShipmentPackage[] = [];
      for (const spec of specs) {
        const doc = await insertOnePackage(
          {
            shipment_id: shipmentId,
            shipment_number: shipment.shipment_number,
            notes: spec.notes,
            created_by: createdBy,
          },
          session
        );
        created.push(doc);
      }

      await session.commitTransaction();
      return {
        packages: created.map(serializePackage),
        total_for_shipment: existing + created.length,
      };
    } catch (err) {
      try {
        await session.abortTransaction();
      } catch {
        /* already aborted by server after failed write */
      }

      if (err instanceof PackageServiceError) throw err;

      // Code collision: never continue inserting on this session — restart whole txn.
      if (isPackageCodeDuplicateKey(err)) {
        codeCollisionAttempts += 1;
        if (codeCollisionAttempts >= PACKAGE_CODE_TXN_RESTARTS) {
          throw new PackageServiceError(503, 'Unable to allocate unique package code');
        }
        continue;
      }

      if (isTransientTxnError(err)) {
        transientAttempts += 1;
        if (transientAttempts >= PACKAGE_CREATE_TXN_RETRIES) {
          throw err;
        }
        continue;
      }

      throw err;
    } finally {
      session.endSession();
    }
  }
}

export async function listPackagesForShipment(shipmentIdRaw: string) {
  const shipmentId = assertValidObjectId(shipmentIdRaw, 'shipment id');
  const shipment = await Shipment.findById(shipmentId).select('_id shipment_number').lean();
  if (!shipment) {
    throw new PackageServiceError(404, 'Shipment not found');
  }

  const list = await ShipmentPackage.find({ shipment_id: shipmentId })
    .sort({ created_at: -1 })
    .lean();

  return {
    shipment_id: shipmentId.toString(),
    shipment_number: (shipment as { shipment_number?: string }).shipment_number,
    packages: list.map((p) => ({
      id: p._id.toString(),
      package_code: p.package_code,
      shipment_id: p.shipment_id.toString(),
      shipment_number: p.shipment_number,
      notes: p.notes,
      created_by: p.created_by?.toString(),
      created_at: p.created_at,
      updated_at: p.updated_at,
    })),
  };
}

export async function getPackageByCode(codeRaw: string) {
  const normalized = normalizePackageCode(codeRaw);
  if (!normalized || !isPackageCodeFormat(normalized)) {
    throw new PackageServiceError(400, 'Invalid package code');
  }

  const pkg = await ShipmentPackage.findOne({ package_code: normalized }).lean();
  if (!pkg) {
    throw new PackageServiceError(404, 'Package not found');
  }

  const shipment = await Shipment.findById(pkg.shipment_id)
    .select('_id shipment_number status')
    .lean();
  if (!shipment) {
    throw new PackageServiceError(404, 'Shipment not found');
  }

  const sh = shipment as {
    _id: mongoose.Types.ObjectId;
    shipment_number?: string;
    status?: string;
  };

  return {
    id: pkg._id.toString(),
    package_code: pkg.package_code,
    notes: pkg.notes,
    shipment_id: pkg.shipment_id.toString(),
    shipment_number: pkg.shipment_number ?? sh.shipment_number,
    created_at: pkg.created_at,
    updated_at: pkg.updated_at,
    shipment: {
      id: sh._id.toString(),
      shipment_number: sh.shipment_number,
      status: sh.status,
    },
  };
}
