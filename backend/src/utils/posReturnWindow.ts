/**
 * Task 07D-10E-01 — POS return-window eligibility.
 * Allowed windows: 15 (default), 30, or 45 days from the original sale.
 */
import { POS_RETURN_WINDOW_DAYS, type PosReturnWindowDays } from '../models/Return';

export const POS_RETURN_DEFAULT_WINDOW_DAYS: PosReturnWindowDays = 15;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class PosReturnWindowError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PosReturnWindowError';
    this.status = status;
  }
}

export type PosReturnWindowResult = {
  return_window_days: PosReturnWindowDays;
  return_deadline: Date;
  window_extended: boolean;
};

function isWindowDays(value: number): value is PosReturnWindowDays {
  return (POS_RETURN_WINDOW_DAYS as readonly number[]).includes(value);
}

export function resolvePosReturnWindow(opts: {
  saleCreatedAt: unknown;
  requestedWindowDays?: unknown;
  now?: Date;
}): PosReturnWindowResult {
  const requested = opts.requestedWindowDays;
  const days =
    requested === undefined || requested === null
      ? POS_RETURN_DEFAULT_WINDOW_DAYS
      : Number(requested);

  if (!Number.isInteger(days) || !isWindowDays(days)) {
    throw new PosReturnWindowError('Return window must be 15, 30, or 45 days.');
  }

  const saleCreated = opts.saleCreatedAt instanceof Date
    ? opts.saleCreatedAt
    : new Date(opts.saleCreatedAt as string | number);
  if (Number.isNaN(saleCreated.getTime())) {
    throw new PosReturnWindowError('Original sale is missing a valid created_at timestamp.');
  }

  const return_deadline = new Date(saleCreated.getTime() + days * MS_PER_DAY);
  const now = opts.now ?? new Date();
  if (now.getTime() > return_deadline.getTime()) {
    throw new PosReturnWindowError('This sale is outside the return window.');
  }

  return {
    return_window_days: days,
    return_deadline,
    window_extended: days > POS_RETURN_DEFAULT_WINDOW_DAYS,
  };
}
