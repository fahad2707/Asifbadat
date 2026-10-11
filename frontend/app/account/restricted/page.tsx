'use client';

import AccountStatusView from '@/components/auth/AccountStatusView';

/** Fail-safe destination when account_status is null, missing, or inconsistent. */
export default function AccountRestrictedPage() {
  return <AccountStatusView expected="restricted" />;
}
