'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import adminApi from '@/lib/admin-api';
import { openPdfFromResponse } from '@/lib/download-pdf';
import { formatApiError } from '@/lib/format-api-error';
import { adminUi } from '@/lib/admin-ui';
import {
  applySuccessfulListResult,
  beginListRequest,
  endCreate,
  endPrint,
  isCreateInFlight,
  isPrintInFlight,
  markCreateConfirmed,
  markCreateUncertain,
  needsCreateVerification,
  tryBeginCreate,
  tryBeginPrint,
} from '@/lib/shipmentPackageRequestGuards';
import toast from 'react-hot-toast';

const MAX_PACKAGES_PER_SHIPMENT = 100;
const MAX_LABEL_ENTRIES = 50;
const MAX_COPIES_PER_PACKAGE = 50;
const MAX_TOTAL_LABELS = 200;
const NOTES_MAX = 500;

const UNCERTAIN_CREATE_MSG =
  "We couldn't confirm whether the packages were created. Refresh the package list and verify before trying again.";

export type ShipmentPackageRow = {
  id: string;
  package_code: string;
  shipment_id?: string;
  shipment_number?: string;
  notes?: string;
  created_at?: string;
};

function fmtDateTime(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function pdfApiError(err: unknown, fallback: string): string {
  try {
    const data = (err as { response?: { data?: ArrayBuffer | string | { error?: string } } })?.response
      ?.data;
    if (data instanceof ArrayBuffer) {
      const text = new TextDecoder().decode(data);
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) return parsed.error;
    }
    if (typeof data === 'object' && data && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  } catch {
    /* fall through */
  }
  return formatApiError(err, fallback);
}

export default function ShipmentPackagesSection({
  shipmentId,
  onChanged,
}: {
  shipmentId: string;
  onChanged?: () => void;
}) {
  const shipmentIdRef = useRef(shipmentId);
  shipmentIdRef.current = shipmentId;

  const [packages, setPackages] = useState<ShipmentPackageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [createCount, setCreateCount] = useState(1);
  const [createNotes, setCreateNotes] = useState('');
  const [creating, setCreating] = useState(() => isCreateInFlight(shipmentId));
  const [createBlockedUntilRefresh, setCreateBlockedUntilRefresh] = useState(() =>
    needsCreateVerification(shipmentId)
  );

  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(() => isPrintInFlight(shipmentId));

  const remaining = Math.max(0, MAX_PACKAGES_PER_SHIPMENT - packages.length);
  const totalLabels = selectedIds.size * copies;

  const isCurrent = useCallback((id: string) => shipmentIdRef.current === id, []);

  const loadPackages = useCallback(
    async (id: string, opts?: { silent?: boolean }): Promise<boolean> => {
      if (!opts?.silent) {
        setLoading(true);
        setLoadError(null);
      }
      const capturedGen = beginListRequest(id);
      try {
        const res = await adminApi.get(`/shipments/${id}/packages`);
        if (!isCurrent(id)) return false;
        const list = (res.data?.packages || []) as ShipmentPackageRow[];
        setPackages(Array.isArray(list) ? list : []);
        setSelectedIds(new Set());
        setLoadError(null);
        const clearToCreate = applySuccessfulListResult(id, capturedGen);
        setCreateBlockedUntilRefresh(needsCreateVerification(id));
        return clearToCreate && !needsCreateVerification(id);
      } catch (err) {
        if (!isCurrent(id)) return false;
        const msg = formatApiError(err, 'Failed to load packages');
        setLoadError(msg);
        if (!opts?.silent) toast.error(msg);
        setCreateBlockedUntilRefresh(needsCreateVerification(id));
        return false;
      } finally {
        if (isCurrent(id) && !opts?.silent) setLoading(false);
      }
    },
    [isCurrent]
  );

  useEffect(() => {
    let cancelled = false;
    setPackages([]);
    setSelectedIds(new Set());
    setCreateCount(1);
    setCreateNotes('');
    setCopies(1);
    setLoadError(null);
    setLoading(true);
    setCreating(isCreateInFlight(shipmentId));
    setPrinting(isPrintInFlight(shipmentId));
    setCreateBlockedUntilRefresh(needsCreateVerification(shipmentId));

    const capturedGen = beginListRequest(shipmentId);

    (async () => {
      try {
        const res = await adminApi.get(`/shipments/${shipmentId}/packages`);
        if (cancelled || !isCurrent(shipmentId)) return;
        const list = (res.data?.packages || []) as ShipmentPackageRow[];
        setPackages(Array.isArray(list) ? list : []);
        setLoadError(null);
        applySuccessfulListResult(shipmentId, capturedGen);
        setCreateBlockedUntilRefresh(needsCreateVerification(shipmentId));
      } catch (err) {
        if (cancelled || !isCurrent(shipmentId)) return;
        const msg = formatApiError(err, 'Failed to load packages');
        setLoadError(msg);
        toast.error(msg);
        setCreateBlockedUntilRefresh(needsCreateVerification(shipmentId));
      } finally {
        if (!cancelled && isCurrent(shipmentId)) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shipmentId, isCurrent]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === packages.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(packages.map((p) => p.id)));
  };

  const createPackages = async () => {
    const targetId = shipmentId;
    if (!tryBeginCreate(targetId)) {
      if (needsCreateVerification(targetId) || createBlockedUntilRefresh) {
        toast.error('Refresh the package list and verify before creating again.');
      }
      return;
    }

    const n = Number(createCount);
    if (!Number.isInteger(n) || n < 1) {
      endCreate(targetId);
      toast.error('Count must be a positive integer');
      return;
    }
    if (n > remaining) {
      endCreate(targetId);
      toast.error(
        remaining === 0
          ? `This shipment already has the maximum of ${MAX_PACKAGES_PER_SHIPMENT} packages`
          : `Only ${remaining} package slot(s) remaining (max ${MAX_PACKAGES_PER_SHIPMENT})`
      );
      return;
    }
    const notes = createNotes.trim();
    if (notes.length > NOTES_MAX) {
      endCreate(targetId);
      toast.error(`Notes must be at most ${NOTES_MAX} characters`);
      return;
    }

    if (isCurrent(targetId)) setCreating(true);

    try {
      const body =
        notes.length > 0
          ? { packages: Array.from({ length: n }, () => ({ notes })) }
          : { count: n };
      const res = await adminApi.post(`/shipments/${targetId}/packages`, body);

      markCreateConfirmed(targetId);

      if (!isCurrent(targetId)) {
        return;
      }

      const created = Array.isArray(res.data?.packages) ? res.data.packages.length : n;
      toast.success(`Created ${created} package${created === 1 ? '' : 's'}`);
      setCreateNotes('');
      setCreateCount(1);
      setCreateBlockedUntilRefresh(false);
      await loadPackages(targetId, { silent: true });
      if (isCurrent(targetId)) setLoading(false);
      onChanged?.();
    } catch {
      // Outcome may be uncertain. Bump verify generation; never auto-resubmit.
      markCreateUncertain(targetId);

      if (!isCurrent(targetId)) {
        return;
      }

      toast.error(UNCERTAIN_CREATE_MSG);
      setCreateBlockedUntilRefresh(true);
      const refreshed = await loadPackages(targetId, { silent: true });
      if (!isCurrent(targetId)) return;
      if (isCurrent(targetId)) setLoading(false);

      if (refreshed) {
        toast(
          'Package list refreshed — verify whether packages were created before trying again.'
        );
      } else {
        toast.error(
          'Could not refresh the package list. Refresh successfully before creating packages again.'
        );
      }
    } finally {
      endCreate(targetId);
      if (isCurrent(targetId)) {
        setCreating(false);
        setCreateBlockedUntilRefresh(needsCreateVerification(targetId));
      }
    }
  };

  const printSelected = async () => {
    const targetId = shipmentId;
    if (!tryBeginPrint(targetId)) return;

    const ids = Array.from(selectedIds);
    if (!ids.length) {
      endPrint(targetId);
      toast.error('Select at least one package');
      return;
    }
    if (ids.length > MAX_LABEL_ENTRIES) {
      endPrint(targetId);
      toast.error(`Select at most ${MAX_LABEL_ENTRIES} packages per print job`);
      return;
    }
    const qty = Number(copies);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_COPIES_PER_PACKAGE) {
      endPrint(targetId);
      toast.error(`Copies must be an integer from 1 to ${MAX_COPIES_PER_PACKAGE}`);
      return;
    }
    const total = ids.length * qty;
    if (total > MAX_TOTAL_LABELS) {
      endPrint(targetId);
      toast.error(`Total labels cannot exceed ${MAX_TOTAL_LABELS} (currently ${total})`);
      return;
    }

    if (isCurrent(targetId)) setPrinting(true);

    try {
      const res = await adminApi.post(
        `/packages/labels/pdf`,
        {
          items: ids.map((package_id) => ({ package_id, quantity: qty })),
        },
        { responseType: 'arraybuffer' }
      );
      if (!isCurrent(targetId)) return;
      const ok = await openPdfFromResponse(res.data, res.headers?.['content-type']);
      if (ok && isCurrent(targetId)) toast.success(`Opened ${total} package label(s)`);
    } catch (err) {
      if (!isCurrent(targetId)) return;
      toast.error(pdfApiError(err, 'Failed to generate package labels'));
    } finally {
      endPrint(targetId);
      if (isCurrent(targetId)) {
        setPrinting(false);
      }
    }
  };

  const createDisabled =
    creating ||
    createBlockedUntilRefresh ||
    isCreateInFlight(shipmentId) ||
    needsCreateVerification(shipmentId) ||
    remaining === 0 ||
    loading ||
    !!loadError;

  const allSelected = packages.length > 0 && selectedIds.size === packages.length;

  const helperRemaining = useMemo(() => {
    if (loading) return null;
    return `${packages.length} / ${MAX_PACKAGES_PER_SHIPMENT} packages · ${remaining} remaining`;
  }, [loading, packages.length, remaining]);

  return (
    <section>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className={adminUi.sectionTitle}>Packages</h3>
          {helperRemaining && <p className={`${adminUi.helper} mt-0.5`}>{helperRemaining}</p>}
        </div>
        {loadError && (
          <button
            type="button"
            className={adminUi.btnSecondary}
            disabled={loading}
            onClick={() => loadPackages(shipmentId)}
          >
            Retry
          </button>
        )}
      </div>

      <p className={`${adminUi.helper} mt-2`}>
        Creating packages does not change inventory or shipment status.
      </p>

      {loading ? (
        <div className="mt-3 flex justify-center py-6">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-black border-t-transparent" />
        </div>
      ) : loadError ? (
        <div className="mt-3 rounded-md border border-[#FDECEC] bg-[#FDECEC] px-3 py-2 text-sm text-[#8A100E]">
          {loadError}
          {createBlockedUntilRefresh && (
            <p className="mt-1 text-xs">Create is disabled until the package list loads successfully.</p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3 border border-[#E3E5E8] rounded-md overflow-hidden">
            {packages.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[#6B6C72]">No packages yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-[#FAFAFA] text-[#6B6C72]">
                  <tr>
                    <th className="px-2 py-1.5 w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all packages"
                      />
                    </th>
                    <th className="text-left px-2 py-1.5 font-medium">Code</th>
                    <th className="text-left px-2 py-1.5 font-medium">Created</th>
                    <th className="text-left px-2 py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.map((pkg) => (
                    <tr key={pkg.id} className="border-t border-[#E3E5E8]">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(pkg.id)}
                          onChange={() => toggleSelected(pkg.id)}
                          aria-label={`Select ${pkg.package_code}`}
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[11px]">{pkg.package_code}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{fmtDateTime(pkg.created_at)}</td>
                      <td className="px-2 py-1.5 max-w-[120px] truncate" title={pkg.notes || undefined}>
                        {pkg.notes?.trim() ? pkg.notes : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="mt-3 space-y-2 rounded-md border border-[#E3E5E8] px-3 py-2">
            <p className="text-xs font-medium text-[#1A1A1A]">Create packages</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-[#6B6C72]">
                Count
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, remaining)}
                  value={createCount}
                  disabled={createDisabled}
                  onChange={(e) => setCreateCount(Number(e.target.value))}
                  className="mt-0.5 block w-20 rounded border border-[#E3E5E8] px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-[#6B6C72] flex-1 min-w-[140px]">
                Notes (optional, all new)
                <input
                  type="text"
                  value={createNotes}
                  maxLength={NOTES_MAX}
                  disabled={createDisabled}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  placeholder="e.g. fragile"
                  className="mt-0.5 block w-full rounded border border-[#E3E5E8] px-2 py-1 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={createDisabled}
                className={adminUi.btnPrimary}
                onClick={createPackages}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
            {createBlockedUntilRefresh && (
              <p className="text-xs text-[#8A4500]">
                Create blocked until the package list refreshes successfully.
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() => loadPackages(shipmentId)}
                >
                  Refresh now
                </button>
              </p>
            )}
          </div>

          <div className="mt-3 space-y-2 rounded-md border border-[#E3E5E8] px-3 py-2">
            <p className="text-xs font-medium text-[#1A1A1A]">Print labels</p>
            <p className={`${adminUi.helper}`}>
              Prints existing packages only — does not create packages or change shipment status.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-[#6B6C72]">
                Copies each
                <input
                  type="number"
                  min={1}
                  max={MAX_COPIES_PER_PACKAGE}
                  value={copies}
                  disabled={printing || selectedIds.size === 0}
                  onChange={(e) => setCopies(Number(e.target.value))}
                  className="mt-0.5 block w-20 rounded border border-[#E3E5E8] px-2 py-1 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={
                  printing ||
                  isPrintInFlight(shipmentId) ||
                  selectedIds.size === 0 ||
                  selectedIds.size > MAX_LABEL_ENTRIES ||
                  totalLabels > MAX_TOTAL_LABELS
                }
                className={adminUi.btnSecondary}
                onClick={printSelected}
              >
                {printing
                  ? 'Generating…'
                  : `Print ${selectedIds.size || 0} selected${selectedIds.size ? ` · ${totalLabels} label(s)` : ''}`}
              </button>
            </div>
            {selectedIds.size > MAX_LABEL_ENTRIES && (
              <p className="text-xs text-[#C81916]">
                At most {MAX_LABEL_ENTRIES} packages can be printed at once.
              </p>
            )}
            {selectedIds.size > 0 &&
              selectedIds.size <= MAX_LABEL_ENTRIES &&
              totalLabels > MAX_TOTAL_LABELS && (
                <p className="text-xs text-[#C81916]">
                  Total labels ({totalLabels}) exceeds {MAX_TOTAL_LABELS}. Reduce selection or copies.
                </p>
              )}
          </div>
        </>
      )}
    </section>
  );
}
