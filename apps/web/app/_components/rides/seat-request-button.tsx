'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface SeatRequestLabels {
  request: string;
  requesting: string;
  pending: string;
  confirmed: string;
  cancel: string;
  cancelling: string;
  failed: string;
  full: string;
}

/** The rider's control on a ride page: request a seat, or cancel a live request. */
export function SeatRequestButton({
  tenant,
  rideId,
  requestId,
  requestStatus,
  seatsAvailable,
  labels,
}: {
  tenant: string;
  rideId: string;
  /** The viewer's live seat request on this ride, if any. */
  requestId: string | null;
  requestStatus: 'pending' | 'accepted' | null;
  seatsAvailable: number | null;
  labels: SeatRequestLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function post(url: string, body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setError(true);
      return;
    }
    router.refresh();
  }

  const btn = 'ios-pressable rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60';

  if (requestStatus && requestId) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          {requestStatus === 'accepted' ? labels.confirmed : labels.pending}
        </p>
        <button
          type="button"
          disabled={busy}
          className={`${btn} bg-muted text-foreground`}
          onClick={() => post(`/api/rides/seat/${requestId}`, { tenant, action: 'cancel' })}
        >
          {busy ? labels.cancelling : labels.cancel}
        </button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {labels.failed}
          </p>
        ) : null}
      </div>
    );
  }

  if (seatsAvailable !== null && seatsAvailable <= 0) {
    return <p className="text-sm font-medium text-muted-foreground">{labels.full}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-primary text-primary-foreground`}
        onClick={() => post(`/api/rides/${rideId}/seat`, { tenant })}
      >
        {busy ? labels.requesting : labels.request}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {labels.failed}
        </p>
      ) : null}
    </div>
  );
}
