/**
 * Task 07D-10E-02 — POS return settlement claim helpers.
 *
 * Unique PosReturnSettlement.return_id plus an atomic unsettled→settled
 * update on Return are the concurrency guarantees. These helpers only
 * build the claim filter/update and identify return_id duplicate keys.
 */

export class PosReturnSettlementError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PosReturnSettlementError';
    this.status = status;
  }
}

type MongoDuplicateError = {
  code?: number;
  keyPattern?: Record<string, unknown>;
  message?: string;
};

export function isReturnSettlementDuplicateKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as MongoDuplicateError;
  if (e.code !== 11000) return false;
  if (e.keyPattern && Object.prototype.hasOwnProperty.call(e.keyPattern, 'return_id')) {
    return true;
  }
  return typeof e.message === 'string' && e.message.includes('return_id');
}

export function posReturnHasEligibleCreditCustomer(ret: { customer_id?: unknown }): boolean {
  return ret?.customer_id != null && String(ret.customer_id).trim() !== '';
}

export function posReturnSettlementClaimFilter(returnId: unknown) {
  return {
    _id: returnId,
    $or: [{ settlement_status: 'unsettled' }, { settlement_status: { $exists: false } }],
  };
}

export function posReturnSettlementClaimUpdate(fields: {
  settled_at: Date;
  refund_method: string;
  cheque_reference?: string;
  settlement_id?: unknown;
}) {
  return {
    $set: {
      settlement_status: 'settled',
      settled_at: fields.settled_at,
      refund_method: fields.refund_method,
      ...(fields.cheque_reference ? { cheque_reference: fields.cheque_reference } : {}),
      ...(fields.settlement_id ? { settlement_id: fields.settlement_id } : {}),
    },
  };
}

export function formatPosReturnSettlementResponse(settlement: any, ret: any) {
  const settlementObj =
    typeof settlement?.toObject === 'function' ? settlement.toObject() : { ...settlement };
  const returnObj = typeof ret?.toObject === 'function' ? ret.toObject() : { ...ret };
  return {
    settlement: {
      id: String(settlement?._id ?? settlementObj?._id),
      ...settlementObj,
    },
    return: {
      id: String(ret?._id ?? returnObj?._id),
      ...returnObj,
    },
  };
}
