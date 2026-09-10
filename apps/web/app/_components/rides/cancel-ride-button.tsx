'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface CancelRideLabels {
  cancel: string;
  cancelling: string;
  confirm: string;
  failed: string;
}

/** The author's control to cancel their own ride (confirm-then-cancel). */
export function CancelRideButton({
  tenant,
  rideId,
  labels,
}: {
  tenant: string;
  rideId: string;
  labels: CancelRideLabels;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function cancel() {
    if (busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/rides/${rideId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action: 'cancel' }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(true);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={busy}
        className="ios-pressable self-start rounded-xl bg-muted px-4 py-2 text-sm font-semibold text-destructive disabled:opacity-60"
        onClick={() => (armed ? cancel() : setArmed(true))}
      >
        {busy ? labels.cancelling : armed ? labels.confirm : labels.cancel}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {labels.failed}
        </p>
      ) : null}
    </div>
  );
}
