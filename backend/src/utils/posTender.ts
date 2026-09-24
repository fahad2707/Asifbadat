/**
 * Task 07D-04 — POS tender validation (Model A).
 * POSSale is the tender record. Amounts use the shared money helper.
 */
import { formatMoney, roundMoney } from '../services/paymentApplication';

export class PosTenderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PosTenderError';
    this.status = status;
  }
}

export const POS_TENDER_METHODS = ['cash', 'card', 'digital'] as const;
export type PosTenderMethod = (typeof POS_TENDER_METHODS)[number];
export type PosPaymentMethod = PosTenderMethod | 'split';

export type PosTenderSplit = {
  cash?: number;
  card?: number;
  digital?: number;
};

export type NormalizedPosTenders = {
  cash: number;
  card: number;
  digital: number;
  total: number;
};

function readTenderAmount(value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0;
  const amount = roundMoney(value);
  if (!Number.isFinite(amount)) {
    throw new PosTenderError(`Invalid ${label} tender amount.`);
  }
  if (amount < 0) {
    throw new PosTenderError('Tender amounts must be greater than zero.');
  }
  return amount;
}

export function normalizePosTenders(
  paymentMethod: PosPaymentMethod,
  paymentSplit: PosTenderSplit | undefined,
  saleTotal: number
): NormalizedPosTenders {
  if (!['cash', 'card', 'digital', 'split'].includes(paymentMethod)) {
    throw new PosTenderError('Invalid or unsupported tender type.');
  }

  const total = roundMoney(saleTotal);
  if (!(total > 0)) {
    throw new PosTenderError('Sale total must be greater than zero.');
  }

  let cash = 0;
  let card = 0;
  let digital = 0;

  if (paymentMethod === 'split') {
    if (!paymentSplit || typeof paymentSplit !== 'object') {
      throw new PosTenderError('Split payment amounts are required.');
    }
    cash = readTenderAmount(paymentSplit.cash, 'cash');
    card = readTenderAmount(paymentSplit.card, 'card');
    digital = readTenderAmount(paymentSplit.digital, 'digital');
  } else if (paymentSplit && typeof paymentSplit === 'object') {
    cash = readTenderAmount(paymentSplit.cash, 'cash');
    card = readTenderAmount(paymentSplit.card, 'card');
    digital = readTenderAmount(paymentSplit.digital, 'digital');
    const others =
      (paymentMethod === 'cash' ? card + digital : 0) +
      (paymentMethod === 'card' ? cash + digital : 0) +
      (paymentMethod === 'digital' ? cash + card : 0);
    if (roundMoney(others) > 0) {
      throw new PosTenderError(`Non-split ${paymentMethod} sale cannot include other tender types.`);
    }
  } else {
    if (paymentMethod === 'cash') cash = total;
    if (paymentMethod === 'card') card = total;
    if (paymentMethod === 'digital') digital = total;
  }

  const tenders = { cash, card, digital };
  const positive = POS_TENDER_METHODS.filter((method) => tenders[method] > 0);
  if (positive.length === 0) {
    throw new PosTenderError('Tender amounts must be greater than zero.');
  }
  if (paymentMethod === 'split' && positive.length < 2) {
    throw new PosTenderError('Split payment requires more than one tender.');
  }

  const tenderTotal = roundMoney(cash + card + digital);
  if (tenderTotal !== total) {
    throw new PosTenderError(
      `Tender total must equal the sale total. Sale total: ${formatMoney(total)}. Tender total: ${formatMoney(tenderTotal)}.`
    );
  }

  return { cash, card, digital, total: tenderTotal };
}
