'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import { actorLabel, formatPacks, listPhase, submissionAllowed, validateMovement, validatePeriod } from '@/lib/compliance-display';
import { Drawer, EmptyRow, MetricCard, ModuleTabs, PreviewBanner, ReadStatus, StatusBadge } from './Chrome';

type Tab = 'overview' | 'products' | 'ledger' | 'reconciliation' | 'rev772' | 'rev777' | 'conditional';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'products', label: 'Product classification' },
  { id: 'ledger', label: 'Movement ledger' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'rev772', label: 'REV-772' },
  { id: 'rev777', label: 'REV-777' },
  { id: 'conditional', label: 'Conditional reports' },
];

type ProductRow = { _id: string; name: string; sku?: string; barcode?: string; product_id?: string; tobacco_class?: string; cigarette_pack_size?: number; stock_unit?: string; packs_per_stock_unit?: number };
type LedgerRow = { _id: string; product_name: string; movement_type: string; movement_date?: string; quantity: number; stock_unit?: string; stamp?: string; source_number?: string; reason?: string; actor?: { label?: string | null }; affects_physical_stock?: boolean };

function failure(err: any, fallback: string) {
  if (isAdminAuthRedirectError(err)) return '';
  return err?.response?.data?.error || fallback;
}

export default function TobaccoDesk() {
  const params = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.some((item) => item.id === requested) ? (requested as Tab) : 'overview';
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [missing, setMissing] = useState<number | null>(null);
  const [gates, setGates] = useState<Array<{ id: string; enabled: false; blockedBy: string }>>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [productAttempted, setProductAttempted] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [selected, setSelected] = useState<ProductRow | null>(null);
  const [form, setForm] = useState({ tobacco_class: 'unknown', cigarette_pack_size: '', stock_unit: '', packs_per_stock_unit: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerAttempted, setLedgerAttempted] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [movement, setMovement] = useState({ productId: '', movementType: 'adjustment', quantity: '', reason: '', movementDate: '' });
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.get('/compliance/tobacco/summary').then((response) => {
      setCounts(response.data.counts || {});
      setMissing(response.data.cigarettesMissingPackaging);
      setGates(response.data.conditionalReports || []);
    }).catch((err) => {
      if (isAdminAuthRedirectError(err)) setAuthFailed(true);
      else setError(failure(err, 'Tobacco summary could not be loaded.'));
    });
  }, []);

  useEffect(() => {
    if (tab !== 'ledger' && tab !== 'reconciliation' && tab !== 'rev772') return;
    let ignore = false;
    setLedgerLoading(true);
    setLedgerAttempted(true);
    adminApi.get('/compliance/tobacco/ledger').then((response) => {
      if (!ignore) setLedger(response.data.rows || []);
    }).catch((err) => {
      if (ignore) return;
      if (isAdminAuthRedirectError(err)) setAuthFailed(true);
      else setError(failure(err, 'The ledger could not be loaded.'));
    }).finally(() => {
      if (!ignore) setLedgerLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, [tab]);

  async function searchProducts() {
    if (productLoading) return;
    if (!productQuery.trim()) {
      setProductAttempted(false);
      setError('Enter a name, SKU, barcode, or product ID.');
      return;
    }
    setProductLoading(true);
    setProductAttempted(true);
    setError('');
    try {
      const response = await adminApi.get('/compliance/tobacco/products', { params: { q: productQuery, tobaccoClass: classFilter } });
      setProducts(response.data.rows || []);
    } catch (err) {
      if (isAdminAuthRedirectError(err)) setAuthFailed(true);
      else setError(failure(err, 'The product search could not be loaded.'));
    } finally {
      setProductLoading(false);
    }
  }

  function openProduct(row: ProductRow) {
    setSelected(row);
    setConfirmed(false);
    setForm({
      tobacco_class: row.tobacco_class || 'unknown',
      cigarette_pack_size: row.cigarette_pack_size ? String(row.cigarette_pack_size) : '',
      stock_unit: row.stock_unit || '',
      packs_per_stock_unit: row.packs_per_stock_unit ? String(row.packs_per_stock_unit) : '',
    });
  }

  async function saveClassification() {
    if (!selected || !submissionAllowed(busy)) return;
    if (!confirmed) return toast.error('Confirm the classification before saving.');
    setBusy(true);
    try {
      await adminApi.post(`/compliance/tobacco/products/${selected._id}/classification`, {
        confirm: true,
        tobacco_class: form.tobacco_class,
        cigarette_pack_size: form.cigarette_pack_size === '' ? null : Number(form.cigarette_pack_size),
        stock_unit: form.stock_unit === '' ? null : form.stock_unit,
        packs_per_stock_unit: form.packs_per_stock_unit === '' ? null : Number(form.packs_per_stock_unit),
      });
      toast.success('Classification saved. Stock was not changed.');
      setSelected(null);
      await searchProducts();
    } catch (err) {
      const text = failure(err, 'The classification could not be saved.');
      if (text) toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  async function saveMovement() {
    const invalid = validateMovement(movement);
    if (invalid) return toast.error(invalid);
    if (!submissionAllowed(busy)) return;
    setBusy(true);
    try {
      await adminApi.post('/compliance/tobacco/movements', {
        productId: movement.productId,
        movementType: movement.movementType,
        quantity: Number(movement.quantity),
        reason: movement.reason,
        movementDate: movement.movementDate || undefined,
        stamp: 'unknown',
      });
      toast.success('Ledger row saved. Physical stock was not changed.');
      setMovementOpen(false);
      const response = await adminApi.get('/compliance/tobacco/ledger');
      setLedger(response.data.rows || []);
    } catch (err) {
      const text = failure(err, 'The movement could not be saved.');
      if (text) toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  async function loadReconciliation(save: boolean) {
    const invalid = validatePeriod(start, end);
    if (invalid) return setError(invalid);
    if (!submissionAllowed(busy)) return;
    setBusy(true);
    setError('');
    try {
      if (!save) {
        const response = await adminApi.get('/compliance/tobacco/reconciliation', { params: { start, end } });
        setPreview(response.data.preview);
      } else {
        const response = await adminApi.post('/compliance/reports/rev-772', { start, end });
        setPreview(response.data.preview);
        toast.success('REV-772 preview saved. Filing ready: no.');
      }
    } catch (err) {
      const text = failure(err, 'The tobacco preview could not be loaded.');
      if (text) setError(text);
    } finally {
      setBusy(false);
    }
  }

  async function saveRev777(lines: unknown[]) {
    const invalid = validatePeriod(start, end);
    if (invalid) return setError(invalid);
    if (!submissionAllowed(busy)) return;
    setBusy(true);
    try {
      const response = await adminApi.post('/compliance/reports/rev-777', { start, end, lines });
      setPreview(response.data.preview);
      toast.success('REV-777 preview saved. Filing ready: no.');
    } catch (err) {
      const text = failure(err, 'REV-777 could not be saved.');
      if (text) toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  const productPhase = listPhase({ requested: productAttempted, loading: productLoading, error: productAttempted ? error : '', authFailed, count: products.length });
  const ledgerPhase = listPhase({ requested: ledgerAttempted, loading: ledgerLoading, error: ledgerAttempted ? error : '', authFailed, count: ledger.length });

  return (
    <div className={`p-6 space-y-4 ${adminUi.workspace}`}>
      <div>
        <h1 className={adminUi.pageTitle}>Tobacco compliance</h1>
        <p className={`mt-1 ${adminUi.meta}`}>Catalogue classification and compliance movements. Stock quantities stay on the inventory screens.</p>
      </div>
      <ModuleTabs tabs={TABS.map((item) => ({ ...item, href: `/admin/compliance/tobacco?tab=${item.id}` }))} current={tab} />
      <ReadStatus phase={authFailed ? 'auth' : error ? 'error' : 'ready'} error={error} onRetry={() => {
        setError('');
        setAuthFailed(false);
        if (tab === 'products') {
          searchProducts();
          return;
        }
        const path = tab === 'ledger' || tab === 'reconciliation' || tab === 'rev772' ? '/compliance/tobacco/ledger' : '/compliance/tobacco/summary';
        adminApi.get(path).then((response) => {
          if (path.endsWith('ledger')) setLedger(response.data.rows || []);
          else {
            setCounts(response.data.counts || {});
            setMissing(response.data.cigarettesMissingPackaging);
            setGates(response.data.conditionalReports || []);
          }
        }).catch((err) => setError(failure(err, 'The tobacco screen could not be loaded.')));
      }} />

      {tab === 'overview' && (
        <>
          {counts == null && !error && !authFailed && <p className={adminUi.meta}>Loading…</p>}
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Cigarettes" value={counts ? String(counts.cigarette ?? 0) : 'Not available'} />
            <MetricCard label="Little cigars" value={counts ? String(counts.little_cigar ?? 0) : 'Not available'} />
            <MetricCard label="OTP" value={counts ? String(counts.otp ?? 0) : 'Not available'} />
            <MetricCard label="Non-tobacco" value={counts ? String(counts.non_tobacco ?? 0) : 'Not available'} />
            <MetricCard label="Unknown" value={counts ? String(counts.unknown ?? 0) : 'Not available'} />
            <MetricCard label="Missing packaging" value={missing == null ? 'Not available' : String(missing)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className={adminUi.btnPrimary} href="/admin/compliance/tobacco?tab=products">Classify products</Link>
            <Link className={adminUi.btnSecondary} href="/admin/compliance/tobacco?tab=ledger">Record movement</Link>
            <Link className={adminUi.btnSecondary} href="/admin/compliance/tobacco?tab=reconciliation">Reconcile inventory</Link>
            <Link className={adminUi.btnGhost} href="/admin/compliance/tobacco?tab=rev772">REV-772 preview</Link>
            <Link className={adminUi.btnGhost} href="/admin/compliance/tobacco?tab=rev777">REV-777 preview</Link>
          </div>
        </>
      )}

      {tab === 'products' && (
        <>
          <div className="flex flex-wrap gap-2">
            <input className={adminUi.field} style={{ width: 280 }} placeholder="Name, SKU, barcode, or product ID" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} />
            <select className={adminUi.field} style={{ width: 180 }} value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="">All classes</option>
              <option value="unknown">Unknown</option>
              <option value="cigarette">Cigarette</option>
              <option value="little_cigar">Little cigar</option>
              <option value="otp">OTP</option>
              <option value="non_tobacco">Non-tobacco</option>
            </select>
            <button className={adminUi.btnSecondary} type="button" onClick={searchProducts}>Search</button>
          </div>
          <div className={`overflow-x-auto ${adminUi.panel}`}>
            <table className="w-full">
              <thead className={adminUi.tableHead}><tr>{['Product', 'SKU', 'Class', 'Unit', 'Pack size', 'Packs per unit', ''].map((heading) => <th key={heading} className="px-3 py-2 text-left">{heading}</th>)}</tr></thead>
              <tbody>
                {productPhase === 'ready' || productPhase === 'refreshing' ? products.map((row) => (
                  <tr key={row._id} className={adminUi.tableRowHover}>
                    <td className={adminUi.tableCell}>{row.name}<div className={adminUi.meta}>{row.product_id || row._id}</div></td>
                    <td className={adminUi.tableCell}>{row.sku || '—'}</td>
                    <td className={adminUi.tableCell}><StatusBadge status={row.tobacco_class || 'unknown'} /></td>
                    <td className={adminUi.tableCell}>{row.stock_unit || '—'}</td>
                    <td className={adminUi.tableCell}>{row.cigarette_pack_size || '—'}</td>
                    <td className={adminUi.tableCell}>{row.packs_per_stock_unit || '—'}</td>
                    <td className={`${adminUi.tableCell} text-right`}><button className="underline" type="button" onClick={() => openProduct(row)}>Open</button></td>
                  </tr>
                )) : <EmptyRow colSpan={7} text={productPhase === 'empty' ? 'No products match this search.' : productPhase === 'loading' ? 'Loading…' : productPhase === 'error' || productPhase === 'auth' ? 'The product search could not be loaded.' : 'Search the catalogue. Products are not classified from their names.'} />}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'ledger' && <LedgerTable rows={ledger} phase={ledgerPhase} onRecord={() => setMovementOpen(true)} />}
      {(tab === 'reconciliation' || tab === 'rev772') && (
        <ReportPeriod
          start={start}
          end={end}
          setStart={setStart}
          setEnd={setEnd}
          busy={busy}
          preview={preview}
          onReview={() => loadReconciliation(false)}
          onSave={() => loadReconciliation(true)}
          saveLabel="Save REV-772 preview"
        />
      )}
      {tab === 'rev777' && (
        <section className={`p-4 space-y-3 ${adminUi.panel}`}>
          <PreviewBanner />
          <p className={adminUi.meta}>Sales are not copied in. Destination, purchaser, and ship method stay blank until you enter them.</p>
          <div className="flex gap-2">
            <input className={adminUi.field} type="date" value={start} onChange={(event) => setStart(event.target.value)} />
            <input className={adminUi.field} type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
            <button className={adminUi.btnSecondary} type="button" disabled={busy} onClick={() => saveRev777([])}>Save empty preview</button>
          </div>
          {preview && <pre className="text-xs whitespace-pre-wrap">{JSON.stringify({ status: preview.status, filingReady: preview.filingReady, exceptions: preview.exceptions, blockers: preview.blockers }, null, 2)}</pre>}
        </section>
      )}
      {tab === 'conditional' && (
        <div className={`overflow-hidden ${adminUi.panel}`}>
          <table className="w-full">
            <tbody>
              {gates.map((gate) => (
                <tr key={gate.id}>
                  <td className={adminUi.tableCell}>{gate.id}</td>
                  <td className={adminUi.tableCell}><span className={adminUi.badge}>Disabled</span></td>
                  <td className={adminUi.tableCell}>{gate.blockedBy.replace(/_/g, ' ')}</td>
                  <td className={`${adminUi.tableCell} text-right`}><Link className="underline" href="/admin/compliance/settings">Settings</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <Drawer title={selected.name} onClose={() => setSelected(null)}>
          <p className={adminUi.meta}>{selected.sku || 'No SKU'} · {selected.barcode || 'No barcode'}</p>
          <select className={adminUi.field} value={form.tobacco_class} onChange={(event) => setForm({ ...form, tobacco_class: event.target.value })}>
            <option value="unknown">Unknown</option>
            <option value="cigarette">Cigarette</option>
            <option value="little_cigar">Little cigar</option>
            <option value="otp">OTP</option>
            <option value="non_tobacco">Non-tobacco</option>
          </select>
          <select className={adminUi.field} value={form.cigarette_pack_size} onChange={(event) => setForm({ ...form, cigarette_pack_size: event.target.value })}>
            <option value="">Pack size not set</option>
            <option value="20">20</option>
            <option value="25">25</option>
          </select>
          <select className={adminUi.field} value={form.stock_unit} onChange={(event) => setForm({ ...form, stock_unit: event.target.value })}>
            <option value="">Stock unit not set</option>
            <option value="pack">Pack</option>
            <option value="carton">Carton</option>
            <option value="case">Case</option>
            <option value="other">Other</option>
          </select>
          <input className={adminUi.field} placeholder="Packs per stock unit" value={form.packs_per_stock_unit} onChange={(event) => setForm({ ...form, packs_per_stock_unit: event.target.value })} />
          <label className="text-sm"><input className="mr-2" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I confirm this classification and pack conversion.</label>
          <button className={adminUi.btnPrimary} type="button" disabled={busy || !confirmed} onClick={saveClassification}>{busy ? 'Saving…' : 'Save classification'}</button>
        </Drawer>
      )}

      {movementOpen && (
        <Drawer title="Record movement" onClose={() => setMovementOpen(false)}>
          <div className="flex gap-2">
            <input className={adminUi.field} placeholder="Search a cigarette product" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} />
            <button className={adminUi.btnSecondary} type="button" onClick={async () => {
              const response = await adminApi.get('/compliance/tobacco/products', { params: { q: productQuery, tobaccoClass: 'cigarette' } });
              setProducts(response.data.rows || []);
            }}>Search</button>
          </div>
          <ul className="text-sm">
            {products.filter((row) => row.tobacco_class === 'cigarette').map((row) => (
              <li key={row._id}><button className="underline" type="button" onClick={() => setMovement({ ...movement, productId: row._id })}>{row.name}</button></li>
            ))}
          </ul>
          <p className={adminUi.meta}>Selected product: {movement.productId || 'none'}</p>
          <select className={adminUi.field} value={movement.movementType} onChange={(event) => setMovement({ ...movement, movementType: event.target.value })}>
            {['opening', 'receipt', 'sale', 'supplier_return', 'customer_return', 'adjustment', 'other_removal', 'closing'].map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
          </select>
          <input className={adminUi.field} placeholder="Quantity" value={movement.quantity} onChange={(event) => setMovement({ ...movement, quantity: event.target.value })} />
          <input className={adminUi.field} type="date" value={movement.movementDate} onChange={(event) => setMovement({ ...movement, movementDate: event.target.value })} />
          <input className={adminUi.field} placeholder="Reason" value={movement.reason} onChange={(event) => setMovement({ ...movement, reason: event.target.value })} />
          <p className={adminUi.meta}>Stamp is saved as unknown. Purchases and sales are not copied into this ledger automatically.</p>
          <button className={adminUi.btnPrimary} type="button" disabled={busy} onClick={saveMovement}>{busy ? 'Saving…' : 'Save movement'}</button>
        </Drawer>
      )}
    </div>
  );
}

function LedgerTable({ rows, phase, onRecord }: { rows: LedgerRow[]; phase: string; onRecord: () => void }) {
  return (
    <>
      <button className={adminUi.btnPrimary} type="button" onClick={onRecord}>Record movement</button>
      <p className={adminUi.meta}>Manual rows do not change stock. Purchases, sales, and stock movements are not posted here automatically.</p>
      <div className={`overflow-x-auto ${adminUi.panel}`}>
        <table className="w-full">
          <thead className={adminUi.tableHead}><tr>{['Date', 'Product', 'Type', 'Qty', 'Unit', 'Stamp', 'Source', 'Reason', 'User'].map((heading) => <th key={heading} className="px-3 py-2 text-left">{heading}</th>)}</tr></thead>
          <tbody>
            {phase === 'ready' || phase === 'refreshing' ? rows.map((row) => (
              <tr key={row._id}>
                <td className={adminUi.tableCell}>{row.movement_date ? String(row.movement_date).slice(0, 10) : '—'}</td>
                <td className={adminUi.tableCell}>{row.product_name}</td>
                <td className={adminUi.tableCell}>{row.movement_type.replace(/_/g, ' ')}</td>
                <td className={adminUi.tableCell}>{row.quantity}</td>
                <td className={adminUi.tableCell}>{row.stock_unit || '—'}</td>
                <td className={adminUi.tableCell}>{row.stamp || 'unknown'}</td>
                <td className={adminUi.tableCell}>{row.source_number || 'Manual'}</td>
                <td className={adminUi.tableCell}>{row.reason || '—'}</td>
                <td className={adminUi.tableCell}>{actorLabel(row.actor)}</td>
              </tr>
            )) : <EmptyRow colSpan={9} text={phase === 'empty' ? 'No compliance movements have been recorded.' : phase === 'loading' ? 'Loading…' : 'The ledger could not be loaded.'} />}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ReportPeriod({ start, end, setStart, setEnd, busy, preview, onReview, onSave, saveLabel }: { start: string; end: string; setStart: (value: string) => void; setEnd: (value: string) => void; busy: boolean; preview: any; onReview: () => void; onSave: () => void; saveLabel: string }) {
  return (
    <section className="space-y-3">
      <PreviewBanner />
      <div className={`p-4 flex flex-wrap gap-2 items-end ${adminUi.panel}`}>
        <input className={adminUi.field} type="date" value={start} onChange={(event) => setStart(event.target.value)} />
        <input className={adminUi.field} type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
        <button className={adminUi.btnSecondary} type="button" disabled={busy} onClick={onReview}>Review ledger</button>
        <button className={adminUi.btnPrimary} type="button" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : saveLabel}</button>
      </div>
      {preview && (
        <div className={`p-4 ${adminUi.panel}`}>
          <p className={adminUi.body}>Status: {preview.status}. Expected closing: {formatPacks(preview.calculatedClosingPacks)}. Stated closing: {formatPacks(preview.statedClosingPacks)}. Difference: {formatPacks(preview.differencePacks)}.</p>
          {preview.buckets && (
            <ul className="mt-2 text-sm space-y-1">
              {Object.entries(preview.buckets).map(([key, value]) => <li key={key}>{key}: {formatPacks(value)}</li>)}
            </ul>
          )}
          {preview.categories && (
            <ul className="mt-2 text-sm space-y-1">
              {Object.entries(preview.categories).map(([key, value]) => <li key={key}>{key}: {formatPacks(value)}</li>)}
            </ul>
          )}
          <p className={`mt-2 ${adminUi.meta}`}>{(preview.exceptions || []).length} movements are missing pack or stamp data.</p>
        </div>
      )}
    </section>
  );
}
