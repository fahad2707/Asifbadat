/**
 * Storefront account-status routing helpers.
 * Uses GET /api/user/profile fields only — not an authorization mechanism.
 */
import api from '@/lib/api';

export type AccountStatus = 'approved' | 'pending' | 'rejected' | null;

export type ParsedAccountStatus = AccountStatus | 'invalid';

export function parseAccountStatus(raw: unknown): ParsedAccountStatus {
  if (raw === 'approved' || raw === 'pending' || raw === 'rejected') return raw;
  if (raw === null || raw === undefined) return null;
  return 'invalid';
}

/** Destination after login / status refresh. Never treats unknown as approved. */
export function routeForAccountStatus(status: ParsedAccountStatus): string {
  switch (status) {
    case 'approved':
      // Storefront catalog — Account nav on /site uses /store/orders separately.
      return '/site';
    case 'pending':
      return '/account/pending';
    case 'rejected':
      return '/account/rejected';
    default:
      return '/account/restricted';
  }
}

export type ProfileAccountFields = {
  account_approved: boolean;
  account_status: ParsedAccountStatus;
};

/**
 * Fetch current profile status with the authenticated API client.
 * Relies on the token already stored by the auth store / localStorage.
 */
export async function fetchProfileAccountStatus(): Promise<ProfileAccountFields> {
  const res = await api.get('/user/profile');
  const status = parseAccountStatus(res.data?.account_status);
  const approvedFlag = res.data?.account_approved === true;

  if (status === 'approved') {
    if (!approvedFlag) {
      return { account_approved: false, account_status: 'invalid' };
    }
    return { account_approved: true, account_status: 'approved' };
  }

  // Never elevate non-approved / null / invalid statuses via the boolean flag alone.
  return {
    account_approved: false,
    account_status: status,
  };
}
