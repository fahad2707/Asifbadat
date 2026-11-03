export type WebsiteSignupStatus = 'pending' | 'approved' | 'rejected';
export type WebsiteSignupLinkOutcome = 'created' | 'linked' | 'unlinked';
export type WebsiteSignupMatchKind =
  | 'none'
  | 'approved_crm'
  | 'already_linked'
  | 'ambiguous'
  | 'non_approved_crm';

export interface WebsiteSignupResolutionApp {
  status: WebsiteSignupStatus;
  link_outcome: WebsiteSignupLinkOutcome;
  match_kind: WebsiteSignupMatchKind;
  user_id: string | null;
  customer_id: string | null;
  matched_customer_ids: string[];
}

export function isObjectIdString(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

/** UX safeguard mirroring backend safe-path eligibility. Backend remains authoritative. */
export function canApproveApplication(app: WebsiteSignupResolutionApp): boolean {
  return (
    app.status === 'pending' &&
    app.link_outcome === 'created' &&
    app.match_kind === 'none' &&
    isObjectIdString(app.user_id) &&
    isObjectIdString(app.customer_id)
  );
}

export function needsManualResolution(app: WebsiteSignupResolutionApp): boolean {
  if (app.status !== 'pending') return false;
  return !canApproveApplication(app);
}

export function canBindMatchedCustomer(app: WebsiteSignupResolutionApp): boolean {
  if (app.status !== 'pending') return false;
  if (!isObjectIdString(app.user_id)) return false;
  if (
    app.match_kind !== 'non_approved_crm' &&
    app.match_kind !== 'approved_crm' &&
    app.match_kind !== 'ambiguous'
  ) {
    return false;
  }
  const ids = candidateCustomerIds(app);
  return ids.length > 0;
}

export function candidateCustomerIds(app: WebsiteSignupResolutionApp): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...app.matched_customer_ids, app.customer_id]) {
    if (!isObjectIdString(id) || seen.has(id as string)) continue;
    seen.add(id as string);
    out.push(id as string);
  }
  return out;
}

export function manualResolutionReason(kind: WebsiteSignupMatchKind): string {
  switch (kind) {
    case 'non_approved_crm':
      return 'Signup email or phone matched an existing CRM customer that is not approved for online ordering. The website login was not attached automatically so a new signup cannot claim that CRM row.';
    case 'approved_crm':
      return 'Signup email or phone matched an existing CRM customer that already has wholesale access. Binding a new website login would grant that account without proving it is the same person.';
    case 'already_linked':
      return 'Signup email or phone matched a CRM customer that is already linked to a different website login. This signup cannot take over that customer.';
    case 'ambiguous':
      return 'Signup email or phone matched more than one CRM customer. An admin must choose the correct record after verifying identity.';
    case 'none':
      return 'This application is missing a safe new-customer record, so Approve cannot run. Check whether customer creation failed at registration.';
    default:
      return 'This application cannot be auto-approved until identity is confirmed.';
  }
}
