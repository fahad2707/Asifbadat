export type VendorAccountPosition = {
  purchases: number;
  paid: number;
  credits_open: number;
  credits_received: number;
  account_position: number;
  payable: number;
  receivable: number;
};

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Purchases minus cash paid minus open vendor credits.
 * Positive = we still owe the supplier (payable, red).
 * Negative = the supplier owes us (receivable, green) — pay $X less on the next PO,
 * or mark the credit as payment received when cash comes back.
 */
export function vendorAccountPosition(input: {
  purchases: number;
  paid: number;
  credits_open: number;
  credits_received?: number;
}): VendorAccountPosition {
  const purchases = roundMoney(input.purchases);
  const paid = roundMoney(input.paid);
  const credits_open = roundMoney(input.credits_open);
  const credits_received = roundMoney(input.credits_received || 0);
  const account_position = roundMoney(purchases - paid - credits_open);
  return {
    purchases,
    paid,
    credits_open,
    credits_received,
    account_position,
    payable: Math.max(0, account_position),
    receivable: Math.max(0, -account_position),
  };
}

export function vendorCreditCoversUnpaidBills(positionWithoutThisCredit: number): boolean {
  return roundMoney(positionWithoutThisCredit) > 0.005;
}
