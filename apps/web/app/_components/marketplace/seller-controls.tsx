'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SellerControlLabels {
  markReserved: string;
  markSold: string;
  relist: string;
  backToActive: string;
  extend: string;
  del: string;
  delConfirm: string;
  working: string;
  failed: string;
}

type Action = 'reserve' | 'sell' | 'relist' | 'extend' | 'delete';

/** The seller's controls on their own listing: reserve, sell, relist, extend, delete.
 *  Shown only to the seller on the detail page. */
export function SellerControls({
  tenant,
  base,
  listingId,
  status,
  labels,
}: {
  tenant: string;
  base: string;
  listingId: string;
  status: string;
  labels: SellerControlLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function act(action: Action) {
    if (busy) return;
    if (action === 'delete' && !window.confirm(labels.delConfirm)) return;
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/marketplace/listings/${listingId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action }),
    }).catch(() => undefined);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      return;
    }
    if (action === 'delete') router.push(`${base}/marketplace`);
    else router.refresh();
  }

  const pill = 'ios-pressable rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-50';
  const primary = `${pill} bg-primary text-primary-foreground`;
  const muted = `${pill} bg-muted text-muted-foreground`;

  return (
    <div className="ios-card flex flex-col gap-2 rounded-2xl p-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === 'active' ? (
          <>
            <button type="button" disabled={busy} onClick={() => act('reserve')} className={muted}>
              {labels.markReserved}
            </button>
            <button type="button" disabled={busy} onClick={() => act('sell')} className={primary}>
              {labels.markSold}
            </button>
            <button type="button" disabled={busy} onClick={() => act('extend')} className={muted}>
              {labels.extend}
            </button>
          </>
        ) : null}
        {status === 'reserved' ? (
          <>
            <button type="button" disabled={busy} onClick={() => act('sell')} className={primary}>
              {labels.markSold}
            </button>
            <button type="button" disabled={busy} onClick={() => act('relist')} className={muted}>
              {labels.backToActive}
            </button>
          </>
        ) : null}
        {status === 'sold' || status === 'expired' ? (
          <button type="button" disabled={busy} onClick={() => act('relist')} className={primary}>
            {labels.relist}
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
      </div>
      {busy ? <span className="text-xs text-muted-foreground">{labels.working}</span> : null}
      {error ? <span className="text-xs text-destructive">{labels.failed}</span> : null}
    </div>
  );
}
