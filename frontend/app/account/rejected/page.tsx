'use client';

import AccountStatusView from '@/components/auth/AccountStatusView';

export default function AccountRejectedPage() {
  return <AccountStatusView expected="rejected" />;
}
