'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import { isAdminAuthRedirectError } from '@/lib/admin-auth-redirect';
import { submissionAllowed } from '@/lib/compliance-display';
import { ReadStatus, StatusBadge } from './Chrome';

const SECTIONS = [
  { title: 'Business and locations', ids: ['places_of_business'] },
  { title: 'Sales tax licence and filing frequency', ids: ['sales_tax_licence', 'filing_frequency', 'reporting_basis'] },
  { title: 'Tax sourcing', ids: ['jurisdiction_sourcing'] },
  { title: 'Local tax', ids: ['local_collection_duty'] },
  { title: 'Rounding policy', ids: ['rounding_method'] },
  { title: 'Freight treatment', ids: ['freight_billing'] },
  { title: 'Exemption handling', ids: ['exemption_practice', 'missing_tax_assignment'] },
  { title: 'Cigarette wholesaler licence', ids: ['cigarette_wholesaler_licence', 'interstate_cigarette_sales', 'purchaser_classes', 'counter_versus_shipped', 'cigarette_destination', 'cigarette_returns', 'excise_responsibility', 'little_cigar_classification'] },
  { title: 'Stamping-agent status', ids: ['stamping_agent_licence'] },
  { title: 'OTP licence', ids: ['otp_wholesaler_licence'] },
  { title: 'NPM/MSA applicability', ids: ['msa_meaning', 'npm_responsibility'] },
];

type Decision = { id: string; domain: string; question: string };
type Draft = { _id: string; status: string; payload?: { decisionId?: string; note?: string }; created_at?: string };

export default function SettingsDesk() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [authFailed, setAuthFailed] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    setAuthFailed(false);
    try {
      const [overview, configuration] = await Promise.all([
        adminApi.get('/compliance/overview'),
        adminApi.get('/compliance/configuration'),
      ]);
      setDecisions(overview.data.decisions || []);
      setDrafts(configuration.data.rows || []);
    } catch (err: any) {
      if (isAdminAuthRedirectError(err)) setAuthFailed(true);
      else setError(err?.response?.data?.error || 'Settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function latest(id: string) {
    return drafts.find((row) => row.payload?.decisionId === id);
  }

  async function save(decision: Decision) {
    if (!submissionAllowed(busyId !== '')) return;
    setBusyId(decision.id);
    try {
      await adminApi.post('/compliance/configuration', {
        domain: decision.domain,
        payload: { decisionId: decision.id, note: notes[decision.id] || '' },
      });
      toast.success('Draft saved. It is not approved.');
      await load();
    } catch (err: any) {
      if (!isAdminAuthRedirectError(err)) toast.error(err?.response?.data?.error || 'The draft could not be saved.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className={`p-6 space-y-4 ${adminUi.workspace}`}>
      <div>
        <h1 className={adminUi.pageTitle}>Compliance settings</h1>
        <p className={`mt-1 ${adminUi.meta}`}>Notes stay drafts. Approval is not available until a reviewed configuration workflow exists.</p>
      </div>
      <ReadStatus phase={authFailed ? 'auth' : loading ? 'loading' : error ? 'error' : 'ready'} error={error} onRetry={load} />
      {!loading && !error && !authFailed && SECTIONS.map((section) => {
        const items = section.ids.map((id) => decisions.find((decision) => decision.id === id)).filter(Boolean) as Decision[];
        if (items.length === 0) return null;
        return (
          <section key={section.title} className={`p-4 space-y-4 ${adminUi.panel}`}>
            <h2 className={adminUi.sectionTitle}>{section.title}</h2>
            {items.map((decision) => {
              const saved = latest(decision.id);
              return (
                <div key={decision.id} className="grid gap-2 md:grid-cols-[1fr_180px]">
                  <div>
                    <p className="text-sm">{decision.question}</p>
                    <div className="mt-2 flex items-center gap-2">
                      {saved ? <StatusBadge status={saved.status} /> : <span className={adminUi.badge}>Not recorded</span>}
                      <span className={adminUi.meta}>{saved?.status === 'draft' ? 'Latest note is a draft.' : saved ? 'A note is saved.' : 'No note saved.'}</span>
                    </div>
                    <input className={`mt-2 ${adminUi.field}`} placeholder="Draft note" value={notes[decision.id] ?? saved?.payload?.note ?? ''} onChange={(event) => setNotes({ ...notes, [decision.id]: event.target.value })} />
                  </div>
                  <div className="md:text-right">
                    <button className={adminUi.btnSecondary} type="button" disabled={busyId === decision.id} onClick={() => save(decision)}>{busyId === decision.id ? 'Saving…' : 'Save draft'}</button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
