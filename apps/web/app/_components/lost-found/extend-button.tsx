'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Push an about-to-expire item's window out by another full period. */
export function ExtendButton({
  tenant,
  itemId,
  label,
  busyLabel,
}: {
  tenant: string;
  itemId: string;
  label: string;
  busyLabel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function extend() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/lost-found/items/${itemId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, action: 'extend' }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={extend}
      disabled={busy}
      className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
    >
      {busy ? busyLabel : label}
    </button>
  );
}
