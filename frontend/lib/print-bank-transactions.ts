import type { ExportableBankRow } from './export-bank-transactions-excel';

function money(n: number) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmt(d?: string) {
  if (!d) return '—';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleString();
}

export function printBankTransactions(rows: ExportableBankRow[], title = 'Bank transactions'): void {
  const win = window.open('', '_blank', 'noopener,noreferrer,width=960,height=720');
  if (!win) return;
  const body = rows
    .map((r) => `<tr>
      <td>${fmt(r.date)}</td>
      <td>${r.direction === 'in' ? 'Received' : 'Paid bill'}</td>
      <td>${r.trx_id || ''}</td>
      <td>${r.party || ''}</td>
      <td>${r.reference || ''}</td>
      <td>${r.pmt_mode || ''}</td>
      <td>${r.bank_account_name || ''}</td>
      <td class="num">${r.direction === 'out' ? '−' : ''}${money(Math.abs(r.amount))}</td>
      <td>${r.deposit_status || ''}</td>
    </tr>`)
    .join('');
  win.document.write(`<!doctype html><html><head><title>${title}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; color: #1a1a1a; padding: 24px; }
      h1 { font-size: 20px; font-weight: 500; margin: 0 0 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border-bottom: 1px solid #e3e5e8; padding: 8px 6px; text-align: left; }
      th { font-size: 11px; text-transform: uppercase; color: #6b6c72; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
    </style></head><body>
    <h1>${title}</h1>
    <table><thead><tr>
      <th>Date</th><th>Type</th><th>Ref</th><th>Party</th><th>Reference</th>
      <th>Method</th><th>Bank</th><th class="num">Amount</th><th>Status</th>
    </tr></thead><tbody>${body}</tbody></table>
    </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}
