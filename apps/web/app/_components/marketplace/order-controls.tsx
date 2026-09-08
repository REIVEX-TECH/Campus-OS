'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface OrderControlLabels {
  accept: string;
  cancelRequest: string;
  cancel: string;
  cancelConfirm: string;
  working: string;
  failed: string;
}

type To = 'awaiting_payment' | 'in_progress' | 'cancelled';

/**
 * The order's pre-delivery controls: a seller accepts a request (to
 * awaiting_payment for an online order, or straight to in_progress for cash), and
 * either party cancels. Deliver / accept-delivery / revision are added with the
 * delivery UI. `paid` is never offered here: that is the money line.
 */
export function OrderControls({
  tenant,
  orderId,
  status,
  role,
  paymentMode,
  labels,
}: {
  tenant: string;
  orderId: string;
  status: string;
  role: 'buyer' | 'seller';
  paymentMode: string;
  labels: OrderControlLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function act(to: To, confirm?: string) {
    if (busy) return;
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/marketplace/orders/${orderId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, to }),
    }).catch(() => undefined);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      return;
    }
    router.refresh();
  }

  const pill = 'ios-pressable rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-50';
  const primary = `${pill} bg-primary text-primary-foreground`;
  const muted = `${pill} bg-muted text-muted-foreground`;
  const danger = `${pill} text-destructive hover:bg-destructive/10`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === 'requested' && role === 'seller' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(paymentMode === 'online' ? 'awaiting_payment' : 'in_progress')}
            className={primary}
          >
            {labels.accept}
          </button>
        ) : null}
        {status === 'requested' && role === 'buyer' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act('cancelled', labels.cancelConfirm)}
            className={muted}
          >
            {labels.cancelRequest}
          </button>
        ) : null}
        {status === 'requested' && role === 'seller' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act('cancelled', labels.cancelConfirm)}
            className={danger}
          >
            {labels.cancel}
          </button>
        ) : null}
        {status === 'awaiting_payment' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act('cancelled', labels.cancelConfirm)}
            className={danger}
          >
            {labels.cancel}
          </button>
        ) : null}
      </div>
      {busy ? <span className="text-xs text-muted-foreground">{labels.working}</span> : null}
      {error ? <span className="text-xs text-destructive">{labels.failed}</span> : null}
    </div>
  );
}
