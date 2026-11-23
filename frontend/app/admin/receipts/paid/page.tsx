'use client';

import { useEffect, useState } from 'react';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import { PAYMENT_PERIODS } from '@/components/admin/PaymentsStatement';
import CashbookStatement from '@/components/admin/CashbookStatement';

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

export default function MoneyPaidPage() {
  const [period, setPeriod] = useState<(typeof PAYMENT_PERIODS)[number]['id']>('month');
  const [statementOpen, setStatementOpen] = useState(false);
  const [lines, setLines] = useState<Array<{ date: string; kind: string; party: string; reference: string; method: string; amount: number }>>([]);
  const [byMethod, setByMethod] = useState<Array<{ method: string; amount: number }>>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    adminApi.get('/banking/money-out/statement', { params: { period } }).then((res) => {
      setLines(res.data?.lines || []);
      setByMethod(res.data?.by_method || []);
      setTotal(Number(res.data?.total) || 0);
    }).catch(() => {
      setLines([]);
      setByMethod([]);
      setTotal(0);
    });
  }, [period]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={adminUi.pageTitle}>Money paid</h1>
        <div className="flex items-center gap-2">
          <select aria-label="Statement period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className={adminUi.filter}>
            {PAYMENT_PERIODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button type="button" onClick={() => setStatementOpen(true)} className={adminUi.btnSecondary}>Statement</button>
        </div>
      </div>
      <p className="text-sm text-[#6B6C72]">Purchase-order payments and paid bills by cash, cheque, and bank transfer.</p>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-[#E3E5E8] px-3 py-1.5 font-semibold">Total {money(total)}</span>
        {byMethod.map((row) => <span key={row.method} className="rounded-md border border-[#E3E5E8] px-3 py-1.5">{row.method} {money(row.amount)}</span>)}
      </div>
      <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-[#F8FAFC] text-[#64748B]">
            <tr>
              <th className="text-left py-2.5 px-3">Date</th>
              <th className="text-left py-2.5 px-3">Type</th>
              <th className="text-left py-2.5 px-3">Supplier / bill</th>
              <th className="text-left py-2.5 px-3">Reference</th>
              <th className="text-left py-2.5 px-3">Method</th>
              <th className="text-right py-2.5 px-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-[#64748B]">No payments in this period.</td></tr>
            ) : lines.map((line, idx) => (
              <tr key={`${line.reference}-${idx}`} className="border-t border-[#E2E8F0]">
                <td className="py-2 px-3">{line.date}</td>
                <td className="py-2 px-3">{line.kind}</td>
                <td className="py-2 px-3">{line.party}</td>
                <td className="py-2 px-3 font-mono">{line.reference}</td>
                <td className="py-2 px-3">{line.method}</td>
                <td className="py-2 px-3 text-right font-mono text-red-600">{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {statementOpen && <CashbookStatement period={period} direction="out" onClose={() => setStatementOpen(false)} />}
    </div>
  );
}
