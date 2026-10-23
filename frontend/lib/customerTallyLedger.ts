/**
 * Customer Tally Ledger rows (sales invoices + receipts + approved credit memos).
 * Quotations are not sales and must not appear as debits.
 * Draft/cancelled credit memos do not affect the ledger.
 */

export const TALLY_CREDIT_MEMO_STATUSES = ['APPROVED', 'ADJUSTED', 'CLOSED'] as const;

export type TallyInvoice = {
  invoice_number: string;
  invoice_type?: string;
  invoice_date?: string | Date;
  total_amount: number;
};

export type TallyReceipt = {
  trx_id: string;
  trx_date?: string | Date;
  amount_received: number;
};

export type TallyCreditMemo = {
  credit_memo_number: string;
  total_amount: number;
  status?: string;
  reason?: string;
  approved_at?: string | Date;
  created_at?: string | Date;
};

export type TallyLedgerKind = 'invoice' | 'receipt' | 'credit_memo';

export type TallyLedgerItem = {
  date?: string | Date;
  memo: string;
  debit: number;
  credit: number;
  kind: TallyLedgerKind;
};

export type TallyLedgerRow = TallyLedgerItem & {
  runningBalance: number;
};

function salesOnly(docs: TallyInvoice[]): TallyInvoice[] {
  return docs.filter((doc) => doc.invoice_type !== 'quotation');
}

function ledgerCreditMemos(memos: TallyCreditMemo[]): TallyCreditMemo[] {
  return memos.filter((memo) =>
    TALLY_CREDIT_MEMO_STATUSES.includes(String(memo.status || '').toUpperCase() as (typeof TALLY_CREDIT_MEMO_STATUSES)[number])
  );
}

function creditMemoMemo(memo: TallyCreditMemo): string {
  const reason = memo.reason ? ` (${String(memo.reason).replace(/_/g, ' ')})` : '';
  return `${memo.credit_memo_number} Credit Memo${reason}`;
}

export function buildCustomerTallyLedgerItems(
  saleInvoices: TallyInvoice[],
  receipts: TallyReceipt[],
  creditMemos: TallyCreditMemo[] = []
): TallyLedgerItem[] {
  return [
    ...salesOnly(saleInvoices).map((invoice) => ({
      date: invoice.invoice_date,
      memo: `${invoice.invoice_number} B2B Invoice`,
      debit: Number(invoice.total_amount) || 0,
      credit: 0,
      kind: 'invoice' as const,
    })),
    ...receipts.map((receipt) => ({
      date: receipt.trx_date,
      memo: `Receipt ${receipt.trx_id} Voucher`,
      debit: 0,
      credit: Number(receipt.amount_received) || 0,
      kind: 'receipt' as const,
    })),
    ...ledgerCreditMemos(creditMemos).map((memo) => ({
      date: memo.approved_at || memo.created_at,
      memo: creditMemoMemo(memo),
      debit: 0,
      credit: Number(memo.total_amount) || 0,
      kind: 'credit_memo' as const,
    })),
  ].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
}

export function withTallyRunningBalances(items: TallyLedgerItem[]): TallyLedgerRow[] {
  let runningBalance = 0;
  return items.map((item) => {
    runningBalance += item.debit - item.credit;
    return { ...item, runningBalance };
  });
}

/** CSV keeps invoice rows first, then receipts, then credit memos — same invoice/receipt order as before. */
export function buildCustomerTallyCsvStatement(
  saleInvoices: TallyInvoice[],
  receipts: TallyReceipt[],
  creditMemos: TallyCreditMemo[] = []
): string[][] {
  let balance = 0;
  const statement: string[][] = salesOnly(saleInvoices).map((invoice) => {
    balance += Number(invoice.total_amount) || 0;
    return [
      new Date(invoice.invoice_date || 0).toLocaleDateString(),
      `${invoice.invoice_number} Invoice`,
      (Number(invoice.total_amount) || 0).toFixed(2),
      '0.00',
      balance.toFixed(2),
    ];
  });
  for (const receipt of receipts) {
    balance -= Number(receipt.amount_received) || 0;
    statement.push([
      new Date(receipt.trx_date || 0).toLocaleDateString(),
      `${receipt.trx_id} Payment Recv`,
      '0.00',
      (Number(receipt.amount_received) || 0).toFixed(2),
      balance.toFixed(2),
    ]);
  }
  for (const memo of ledgerCreditMemos(creditMemos)) {
    balance -= Number(memo.total_amount) || 0;
    statement.push([
      new Date(memo.approved_at || memo.created_at || 0).toLocaleDateString(),
      `${memo.credit_memo_number} Credit Memo`,
      '0.00',
      (Number(memo.total_amount) || 0).toFixed(2),
      balance.toFixed(2),
    ]);
  }
  return statement;
}
