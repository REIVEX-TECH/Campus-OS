'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Withdraw one's own open item. Posts the action and refreshes the list. */
export function WithdrawButton({
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

  async function withdraw() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/lost-found/items/${itemId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, action: 'withdraw' }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={withdraw}
      disabled={busy}
      className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
    >
      {busy ? busyLabel : label}
    </button>
  );
}
