'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface OrderControlLabels {
  accept: string;
  cancelRequest: string;
  cancel: string;
  cancelConfirm: string;
  start: string;
  deliver: string;
  acceptDelivery: string;
  acceptConfirm: string;
  requestRevision: string;
  working: string;
  failed: string;
}

type To = 'awaiting_payment' | 'in_progress' | 'delivered' | 'completed' | 'cancelled';

/**
 * The order's lifecycle controls, up to the money line. A seller accepts a request
 * (to awaiting_payment for online, or straight to in_progress for cash), starts a
 * paid order, and delivers; a buyer accepts a delivery, requests a revision (back
 * to in_progress, if the package has one left), or cancels. `paid` is never offered
 * here: reaching paid is payment confirmation (the finance flow), not a button.
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
  const isSeller = role === 'seller';
  const isBuyer = role === 'buyer';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === 'requested' && isSeller ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(paymentMode === 'online' ? 'awaiting_payment' : 'in_progress')}
            className={primary}
          >
            {labels.accept}
          </button>
        ) : null}
        {status === 'requested' && isBuyer ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act('cancelled', labels.cancelConfirm)}
            className={muted}
          >
            {labels.cancelRequest}
          </button>
        ) : null}
        {/* A paid order is started by the seller. Reachable once payment is confirmed. */}
        {status === 'paid' && isSeller ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act('in_progress')}
            className={primary}
          >
            {labels.start}
          </button>
        ) : null}
        {status === 'in_progress' && isSeller ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act('delivered')}
            className={primary}
          >
            {labels.deliver}
          </button>
        ) : null}
        {status === 'delivered' && isBuyer ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => act('completed', labels.acceptConfirm)}
              className={primary}
            >
              {labels.acceptDelivery}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act('in_progress')}
              className={muted}
            >
              {labels.requestRevision}
            </button>
          </>
        ) : null}
        {(status === 'requested' && isSeller) || status === 'awaiting_payment' ? (
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
