'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface DriverRequestItem {
  id: string;
  status: string;
  passengerHandle: string | null;
}

export interface DriverRequestsLabels {
  heading: string;
  empty: string;
  accept: string;
  decline: string;
  accepted: string;
  declined: string;
  cancelled: string;
  working: string;
  failed: string;
}

/** The driver's seat-request queue on their own ride page: accept or decline each. */
export function DriverRequests({
  tenant,
  requests,
  labels,
}: {
  tenant: string;
  requests: DriverRequestItem[];
  labels: DriverRequestsLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function act(reqId: string, action: 'accept' | 'decline') {
    if (busy) return;
    setBusy(reqId);
    setError(false);
    const res = await fetch(`/api/rides/seat/${reqId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action }),
    });
    setBusy(null);
    if (!res.ok) {
      setError(true);
      return;
    }
    router.refresh();
  }

  const statusLabel: Record<string, string> = {
    accepted: labels.accepted,
    declined: labels.declined,
    cancelled: labels.cancelled,
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{labels.heading}</h2>
      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((r) => (
            <li
              key={r.id}
              className="ios-card flex items-center justify-between gap-3 rounded-xl p-3"
            >
              <span className="text-sm font-medium">
                {r.passengerHandle ? `@${r.passengerHandle}` : '…'}
              </span>
              {r.status === 'pending' ? (
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy === r.id}
                    className="ios-pressable rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    onClick={() => act(r.id, 'accept')}
                  >
                    {busy === r.id ? labels.working : labels.accept}
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    className="ios-pressable rounded-lg bg-muted px-3 py-1.5 text-sm font-semibold disabled:opacity-60"
                    onClick={() => act(r.id, 'decline')}
                  >
                    {labels.decline}
                  </button>
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {statusLabel[r.status] ?? r.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {labels.failed}
        </p>
      ) : null}
    </section>
  );
}
