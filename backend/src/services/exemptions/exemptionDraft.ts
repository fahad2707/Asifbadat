/**
 * Exemption duplicate policy.
 *
 * An active certificate is identified by the customer and the certificate
 * number. The number is trimmed and compared case-insensitively. Exemption
 * type and effective dates are stored on the draft; they do not split one
 * certificate number into two active certificates.
 *
 * Allowed:
 * - the same customer with a different certificate number
 * - the same certificate number for a different customer
 * - a new draft after the earlier certificate is rejected, revoked, or expired
 *
 * Rejected with 409:
 * - a second draft, pending review, or approved certificate with the same
 *   customer and certificate number, including a concurrent insert
 *
 * A duplicate response does not write a new exemption or a new audit row.
 * The earlier certificate and its audit history stay as they are.
 * Customer.tax_exempt is not read or written here.
 *
 * The unique index `active_customer_certificate` is the concurrency guarantee.
 * Application startup does not create it (`autoIndex` is false). The explicit
 * command src/db/ensure-active-exemption-index.ts creates it after a read-only
 * conflict check. Sequential requests are also rejected by the read inside
 * this transaction.
 */

import mongoose from 'mongoose';
import SalesTaxExemption from '../../models/SalesTaxExemption';
import { writeAuditLogInTransaction } from '../../utils/auditLog';

export const ACTIVE_EXEMPTION_STATUSES = ['draft', 'pending_review', 'approved'] as const;

export class ExemptionCertificateRequiredError extends Error {
  constructor() {
    super('A certificate number is required.');
    this.name = 'ExemptionCertificateRequiredError';
  }
}

export class DuplicateExemptionError extends Error {
  constructor() {
    super('An active exemption already uses this certificate number for this customer.');
    this.name = 'DuplicateExemptionError';
  }
}

export function certificateKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!key || key.length > 80) return null;
  return key;
}

export function isExemptionDuplicateKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: number; message?: string; keyPattern?: Record<string, unknown> };
  if (candidate.code !== 11000) return false;
  if (candidate.keyPattern && Object.prototype.hasOwnProperty.call(candidate.keyPattern, 'certificate_key')) return true;
  return typeof candidate.message === 'string' && candidate.message.includes('active_customer_certificate');
}

export async function createExemptionDraft(input: {
  customerId: mongoose.Types.ObjectId;
  certificateNumber: unknown;
  exemptionType?: unknown;
  effectiveOn?: unknown;
  expiresOn?: unknown;
  adminId: mongoose.Types.ObjectId | null;
}): Promise<{ id: mongoose.Types.ObjectId; status: 'draft' }> {
  const key = certificateKey(input.certificateNumber);
  if (!key) throw new ExemptionCertificateRequiredError();
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const existing = await SalesTaxExemption.findOne({
      customer_id: input.customerId,
      certificate_key: key,
      status: { $in: ACTIVE_EXEMPTION_STATUSES },
    }).session(session);
    if (existing) throw new DuplicateExemptionError();
    const [created] = await SalesTaxExemption.create(
      [
        {
          customer_id: input.customerId,
          certificate_number: String(input.certificateNumber).trim().replace(/\s+/g, ' '),
          certificate_key: key,
          exemption_type: input.exemptionType ? String(input.exemptionType).trim() : undefined,
          status: 'draft',
          effective_on: input.effectiveOn ? new Date(String(input.effectiveOn)) : undefined,
          expires_on: input.expiresOn ? new Date(String(input.expiresOn)) : undefined,
          created_by: input.adminId ?? undefined,
        },
      ],
      { session }
    );
    await writeAuditLogInTransaction(session, {
      action: 'sales_tax_exemption_draft_created',
      entityType: 'SalesTaxExemption',
      entityId: created._id,
      adminId: input.adminId,
      after: { status: 'draft', customer_id: String(input.customerId), certificate_key: key },
    });
    await session.commitTransaction();
    return { id: created._id, status: 'draft' };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof DuplicateExemptionError || isExemptionDuplicateKey(error)) {
      throw new DuplicateExemptionError();
    }
    throw error;
  } finally {
    session.endSession();
  }
}
