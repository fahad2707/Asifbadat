import { remainingInvoiceBalance, roundMoney } from './paymentApplication';
import { summarizeInvoiceTaxes, taxMarkFromName, type LineTaxInput } from '../utils/invoiceTaxDisplay';

export type SalesStatementInvoice = {
  invoice_number: string;
  invoice_date: Date;
  customer_name: string;
  company: string;
  total_amount: number;
  amount_paid: number;
  items?: LineTaxInput[];
};

export type SalesStatementReceipt = {
  trx_id: string;
  trx_date: Date;
  invoice_num: string;
  amount_received: number;
  pmt_mode: string;
  customer_name: string;
};

export type SalesStatementStatus = 'paid' | 'partial' | 'unpaid';

export type SalesStatementLine = {
  date: string;
  ref: string;
  customer: string;
  company: string;
  kind: 'invoice' | 'payment';
  detail: string;
  debit: number;
  credit: number;
  balance: number;
};

export type SalesStatementInvoiceRow = {
  date: string;
  number: string;
  customer: string;
  company: string;
  total: number;
  paid: number;
  balance: number;
  status: SalesStatementStatus;
  tax: number;
  tax_detail: string;
};

export type SalesStatementBucket = {
  count: number;
  billed: number;
  paid: number;
  balance: number;
};

export type SalesStatement = {
  from: string;
  to: string;
  opening_balance: number;
  invoices_issued: number;
  payments_received: number;
  closing_balance: number;
  paid: SalesStatementBucket;
  partial: SalesStatementBucket;
  unpaid: SalesStatementBucket;
  ledger: SalesStatementLine[];
  invoices: SalesStatementInvoiceRow[];
  taxes: { mark: string; name: string; amount: number }[];
  tax_lines: { date: string; invoice: string; product: string; tax: string; amount: number }[];
};

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function statusFor(total: number, paid: number): SalesStatementStatus {
  const balance = remainingInvoiceBalance(total, paid);
  if (balance <= 0) return 'paid';
  if (roundMoney(paid) > 0) return 'partial';
  return 'unpaid';
}

function emptyBucket(): SalesStatementBucket {
  return { count: 0, billed: 0, paid: 0, balance: 0 };
}

function addBucket(bucket: SalesStatementBucket, total: number, paid: number, balance: number) {
  bucket.count += 1;
  bucket.billed = roundMoney(bucket.billed + total);
  bucket.paid = roundMoney(bucket.paid + paid);
  bucket.balance = roundMoney(bucket.balance + balance);
}

type Movement = {
  at: number;
  date: string;
  ref: string;
  customer: string;
  company: string;
  kind: 'invoice' | 'payment';
  detail: string;
  debit: number;
  credit: number;
};

/**
 * Receivable invoices only. Opening is what was still owed before `from`.
 * Charges are invoices dated in the range. Credits are payments in the range.
 * A payment recorded on the invoice with no receipt is included on the invoice date
 * so the statement matches amount paid on the invoice.
 */
export function buildSalesStatement(
  invoices: SalesStatementInvoice[],
  receipts: SalesStatementReceipt[],
  from: Date,
  to: Date
): SalesStatement {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const byNumber = new Map<string, SalesStatementReceipt[]>();
  for (const receipt of receipts) {
    const key = String(receipt.invoice_num || '').trim();
    if (!key) continue;
    const list = byNumber.get(key) || [];
    list.push(receipt);
    byNumber.set(key, list);
  }

  const movements: Movement[] = [];
  let opening = 0;

  const invoiceRows: SalesStatementInvoiceRow[] = [];
  const buckets = { paid: emptyBucket(), partial: emptyBucket(), unpaid: emptyBucket() };
  const taxLines: SalesStatement['tax_lines'] = [];
  const periodItems: LineTaxInput[] = [];

  for (const invoice of invoices) {
    const when = invoice.invoice_date;
    const whenMs = when.getTime();
    if (whenMs > toMs) continue;
    const total = roundMoney(invoice.total_amount);
    const bookPaid = roundMoney(invoice.amount_paid);
    const number = invoice.invoice_number;
    const matched = byNumber.get(number) || [];
    const receiptSum = roundMoney(matched.reduce((sum, row) => sum + roundMoney(row.amount_received), 0));
    const unreceipted = bookPaid > receiptSum ? roundMoney(bookPaid - receiptSum) : 0;

    const paidBefore = roundMoney(
      matched.reduce((sum, row) => (row.trx_date.getTime() < fromMs ? sum + roundMoney(row.amount_received) : sum), 0) +
        (unreceipted > 0 && whenMs < fromMs ? unreceipted : 0)
    );
    if (whenMs < fromMs) {
      opening = roundMoney(opening + remainingInvoiceBalance(total, paidBefore));
    }

    if (whenMs >= fromMs && whenMs <= toMs) {
      movements.push({
        at: whenMs,
        date: dayKey(when),
        ref: number,
        customer: invoice.customer_name || '',
        company: invoice.company || '',
        kind: 'invoice',
        detail: 'Invoice issued',
        debit: total,
        credit: 0,
      });
    }

    if (unreceipted > 0 && whenMs >= fromMs && whenMs <= toMs) {
      movements.push({
        at: whenMs + 1,
        date: dayKey(when),
        ref: number,
        customer: invoice.customer_name || '',
        company: invoice.company || '',
        kind: 'payment',
        detail: 'Payment recorded on invoice',
        debit: 0,
        credit: unreceipted,
      });
    }

    for (const receipt of matched) {
      const at = receipt.trx_date.getTime();
      if (at < fromMs || at > toMs) continue;
      movements.push({
        at,
        date: dayKey(receipt.trx_date),
        ref: receipt.trx_id || number,
        customer: receipt.customer_name || invoice.customer_name || '',
        company: invoice.company || '',
        kind: 'payment',
        detail: `Payment${receipt.pmt_mode ? ` · ${receipt.pmt_mode}` : ''} · ${number}`,
        debit: 0,
        credit: roundMoney(receipt.amount_received),
      });
    }

    const paidAsOf = roundMoney(
      matched.reduce((sum, row) => (row.trx_date.getTime() <= toMs ? sum + roundMoney(row.amount_received) : sum), 0) +
        (unreceipted > 0 && whenMs <= toMs ? unreceipted : 0)
    );
    const balance = remainingInvoiceBalance(total, paidAsOf);
    const status = statusFor(total, paidAsOf);
    const issuedInRange = whenMs >= fromMs && whenMs <= toMs;
    const paidInRange = matched.some((row) => {
      const at = row.trx_date.getTime();
      return at >= fromMs && at <= toMs;
    }) || (unreceipted > 0 && whenMs >= fromMs && whenMs <= toMs);
    if (issuedInRange || paidInRange || balance > 0) {
      const items = invoice.items || [];
      const groups = summarizeInvoiceTaxes(items);
      const tax = roundMoney(items.reduce((sum, item) => sum + (Number(item.tax_amount) || 0), 0));
      invoiceRows.push({
        date: dayKey(when),
        number,
        customer: invoice.customer_name || '',
        company: invoice.company || '',
        total,
        paid: paidAsOf,
        balance,
        status,
        tax,
        tax_detail: groups.map((group) => `${group.mark || group.name} ${group.amount.toFixed(2)}`).join('; '),
      });
      addBucket(buckets[status], total, paidAsOf, Math.max(0, balance));
      if (issuedInRange) {
        periodItems.push(...items);
        for (const item of items) {
          if (item.taxable !== true && !(Number(item.tax_amount) > 0)) continue;
          taxLines.push({
            date: dayKey(when),
            invoice: number,
            product: String(item.product_name || ''),
            tax: taxMarkFromName(item.tax_type_name || item.tax_type_label, true) || String(item.tax_type_label || 'Tax'),
            amount: roundMoney(item.tax_amount),
          });
        }
      }
    }
  }

  movements.sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'invoice' ? -1 : 1));

  let running = opening;
  let issued = 0;
  let received = 0;
  const ledger: SalesStatementLine[] = movements.map((row) => {
    issued = roundMoney(issued + row.debit);
    received = roundMoney(received + row.credit);
    running = roundMoney(running + row.debit - row.credit);
    return {
      date: row.date,
      ref: row.ref,
      customer: row.customer,
      company: row.company,
      kind: row.kind,
      detail: row.detail,
      debit: row.debit,
      credit: row.credit,
      balance: running,
    };
  });

  invoiceRows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));

  return {
    from: dayKey(from),
    to: dayKey(to),
    opening_balance: opening,
    invoices_issued: issued,
    payments_received: received,
    closing_balance: running,
    paid: buckets.paid,
    partial: buckets.partial,
    unpaid: buckets.unpaid,
    ledger,
    invoices: invoiceRows,
    taxes: summarizeInvoiceTaxes(periodItems),
    tax_lines: taxLines,
  };
}
