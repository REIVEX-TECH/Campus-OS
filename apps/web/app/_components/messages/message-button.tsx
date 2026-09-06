'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Open (or reuse) a conversation with someone, then go to the thread. */
export function MessageButton({
  tenant,
  base,
  userId,
  label,
  busyLabel,
  className,
}: {
  tenant: string;
  base: string;
  userId: string;
  label: string;
  busyLabel: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/messages/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, userId }),
      });
      const result = (await res.json().catch(() => ({}))) as { id?: string };
      if (res.ok && result.id) router.push(`${base}/messages/${result.id}`);
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={start} disabled={busy} className={className}>
      {busy ? busyLabel : label}
    </button>
  );
}
