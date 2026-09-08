'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface GigSellerControlLabels {
  pause: string;
  activate: string;
  del: string;
  delConfirm: string;
  working: string;
  failed: string;
}

type Action = 'pause' | 'activate' | 'delete';

/** The seller's controls on their own gig: pause / un-pause / delete. */
export function GigSellerControls({
  tenant,
  base,
  gigId,
  status,
  labels,
}: {
  tenant: string;
  base: string;
  gigId: string;
  status: string;
  labels: GigSellerControlLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function act(action: Action) {
    if (busy) return;
    if (action === 'delete' && !window.confirm(labels.delConfirm)) return;
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/marketplace/gigs/${gigId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action }),
    }).catch(() => undefined);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      return;
    }
    if (action === 'delete') router.push(`${base}/services/mine`);
    else router.refresh();
  }

  const pill = 'ios-pressable rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-50';
  const muted = `${pill} bg-muted text-muted-foreground`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'active' ? (
        <button type="button" disabled={busy} onClick={() => act('pause')} className={muted}>
          {labels.pause}
        </button>
      ) : null}
      {status === 'paused' ? (
        <button type="button" disabled={busy} onClick={() => act('activate')} className={muted}>
          {labels.activate}
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => act('delete')}
        className={`${pill} text-destructive hover:bg-destructive/10`}
      >
        {labels.del}
      </button>
      {busy ? <span className="text-xs text-muted-foreground">{labels.working}</span> : null}
      {error ? <span className="text-xs text-destructive">{labels.failed}</span> : null}
    </div>
  );
}
