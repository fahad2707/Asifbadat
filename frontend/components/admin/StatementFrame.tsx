'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X } from 'lucide-react';
import { adminUi } from '@/lib/admin-ui';

export default function StatementFrame({
  title,
  paperClass,
  ready,
  onSave,
  onCsv,
  onClose,
  children,
}: {
  title: string;
  paperClass: string;
  ready: boolean;
  onSave: () => void;
  onCsv: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div className={`${paperClass}-root fixed inset-0 z-[80] flex flex-col bg-[#E7E8EA]`}>
      <style>{`@media print { body * { visibility: hidden !important; } .${paperClass}-root, .${paperClass}-root * { visibility: visible !important; } .${paperClass}-root { position: absolute; inset: 0; background: white; } .${paperClass}-toolbar { display: none !important; } }`}</style>
      <div className={`${paperClass}-toolbar flex shrink-0 items-center justify-between gap-3 border-b border-[#E3E5E8] bg-white px-5 py-3`}>
        <p className="text-sm font-medium text-[#1A1A1A]">{title}</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => window.print()} disabled={!ready} className={`${adminUi.btnPrimary} disabled:opacity-50`}><Printer className="w-4 h-4" />Print</button>
          <button type="button" onClick={onSave} disabled={!ready} className={`${adminUi.btnSecondary} disabled:opacity-50`}>Save</button>
          <button type="button" onClick={onCsv} disabled={!ready} className={`${adminUi.btnSecondary} disabled:opacity-50`}><Download className="w-4 h-4" />Export CSV</button>
          <button type="button" onClick={onClose} className={adminUi.btnIcon} aria-label="Close statement"><X className="w-5 h-5" /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">{children}</div>
    </div>,
    document.body
  );
}

export function downloadText(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function csvCell(value: string | number) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function saveStatementHtml(paperClass: string, filename: string, title: string) {
  const node = document.querySelector(`.${paperClass}`);
  if (!node) return;
  downloadText(filename, `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Georgia,serif;padding:32px;color:#1a1a1a}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #e3e5e8;padding:6px 8px;text-align:left}td.num,th.num{text-align:right}</style></head><body>${node.innerHTML}</body></html>`, 'text/html;charset=utf-8');
}
