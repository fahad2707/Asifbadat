'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { customerAuthTheme, customerAuthUi } from '@/lib/customer-auth-ui';

export default function CustomerAuthShell({
  children,
  title,
  lead,
}: {
  children: ReactNode;
  title?: string;
  lead?: string;
}) {
  return (
    <div
      className={customerAuthUi.page}
      style={{
        background: `
          radial-gradient(ellipse 80% 50% at 50% -10%, rgba(191,160,106,0.16), transparent 55%),
          radial-gradient(ellipse 60% 40% at 100% 100%, rgba(191,160,106,0.06), transparent 50%),
          ${customerAuthTheme.bg}
        `,
        fontFamily: customerAuthTheme.body,
        color: customerAuthTheme.text,
      }}
    >
      <div
        className={customerAuthUi.panel}
        style={{
          background: customerAuthTheme.panel,
          borderColor: customerAuthTheme.panelBorder,
        }}
      >
        <div className={customerAuthUi.brandMark}>
          <Link href="/site" className="inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#BFA06A] rounded-sm">
            <h1 className={customerAuthUi.brandTitle} style={{ fontFamily: customerAuthTheme.serif }}>
              Express <span className={customerAuthUi.brandAccent}>Distributors</span>
            </h1>
          </Link>
          <p className={customerAuthUi.brandSub}>Wholesale account access</p>
        </div>

        {(title || lead) && (
          <div className="mb-6">
            {title && (
              <h2 className={customerAuthUi.heading} style={{ fontFamily: customerAuthTheme.serif }}>
                {title}
              </h2>
            )}
            {lead && <p className={customerAuthUi.lead}>{lead}</p>}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
