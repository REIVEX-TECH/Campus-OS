'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * A notification row that records a click-through before it navigates.
 *
 * The POST is fire-and-forget with keepalive, so it survives the page unload the
 * navigation triggers and never delays the click. Failure is silent: this is a
 * best-effort metric (block D, "instrument first"), not a user-facing action, and a
 * dropped beacon just under-counts. The stamp is idempotent server-side, so a repeat
 * click is a no-op.
 */
export function NotificationLink({
  tenant,
  id,
  href,
  className,
  children,
}: {
  tenant: string;
  id: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        try {
          void fetch('/api/notifications', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tenant, action: 'click', id }),
            keepalive: true,
          }).catch(() => {});
        } catch {
          // best effort: never let instrumentation break navigation
        }
      }}
    >
      {children}
    </Link>
  );
}
