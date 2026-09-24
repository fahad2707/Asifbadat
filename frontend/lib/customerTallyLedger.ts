/**
 * Customer Tally Ledger rows (sales invoices + receipts only).
 * Quotations are not sales and must not appear as debits.
 */

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

export type TallyLedgerItem = {
  date?: string | Date;
  memo: string;
  debit: number;
  credit: number;
};

export type TallyLedgerRow = TallyLedgerItem & {
  runningBalance: number;
};

function salesOnly(docs: TallyInvoice[]): TallyInvoice[] {
  return docs.filter((doc) => doc.invoice_type !== 'quotation');
}

export function buildCustomerTallyLedgerItems(
  saleInvoices: TallyInvoice[],
  receipts: TallyReceipt[]
): TallyLedgerItem[] {
  return [
    ...salesOnly(saleInvoices).map((invoice) => ({
      date: invoice.invoice_date,
      memo: `${invoice.invoice_number} B2B Invoice`,
      debit: Number(invoice.total_amount) || 0,
      credit: 0,
    })),
    ...receipts.map((receipt) => ({
      date: receipt.trx_date,
      memo: `Receipt ${receipt.trx_id} Voucher`,
      debit: 0,
      credit: Number(receipt.amount_received) || 0,
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

/** CSV keeps invoice rows first, then receipts — same order as the existing export. */
export function buildCustomerTallyCsvStatement(
  saleInvoices: TallyInvoice[],
  receipts: TallyReceipt[]
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
  return statement;
}
