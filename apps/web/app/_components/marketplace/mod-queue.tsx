'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface ModQueueEntry {
  reportId: string;
  targetId: string;
  reason: string;
  note: string | null;
  reporterHandle: string | null;
  listingId: string | null;
  listingTitle: string | null;
}

export interface ModQueueLabels {
  reportedBy: string;
  view: string;
  remove: string;
  dismiss: string;
  removeReason: string;
  confirm: string;
  cancel: string;
  working: string;
  failed: string;
  unknownMember: string;
}

/** The moderator queue: each open report with remove (with a reason) and dismiss. */
export function ModQueue({
  tenant,
  base,
  entries,
  labels,
}: {
  tenant: string;
  base: string;
  entries: ModQueueEntry[];
  labels: ModQueueLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(false);
    const res = await fetch('/api/marketplace/moderation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, ...body }),
    }).catch(() => undefined);
    setBusy(null);
    if (res?.ok) router.refresh();
    else setError(true);
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e) => (
        <li key={e.reportId} className="ios-card flex flex-col gap-2 rounded-2xl p-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">{e.listingTitle ?? e.targetId}</span>
            <span className="text-xs text-muted-foreground">
              {e.reason}
              {e.note ? `: ${e.note}` : ''}
            </span>
            <span className="text-xs text-muted-foreground">
              {labels.reportedBy.replace('{handle}', e.reporterHandle ?? labels.unknownMember)}
            </span>
          </div>
          {removing === e.reportId ? (
            <div className="flex flex-col gap-2">
              <input
                className="ios-field h-9 rounded-lg px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={reason}
                onChange={(ev) => setReason(ev.target.value)}
                placeholder={labels.removeReason}
                aria-label={labels.removeReason}
                maxLength={300}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null || reason.trim().length < 2}
                  onClick={() =>
                    void post({ action: 'remove', listingId: e.targetId, reason }, e.reportId)
                  }
                  className="ios-pressable rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground disabled:opacity-50"
                >
                  {labels.confirm}
                </button>
                <button
                  type="button"
                  onClick={() => setRemoving(null)}
                  className="ios-pressable rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  {labels.cancel}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {e.listingId ? (
                <Link
                  href={`${base}/marketplace/${e.listingId}`}
                  className="ios-pressable rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
                >
                  {labels.view}
                </Link>
              ) : null}
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setRemoving(e.reportId);
                  setReason('');
                }}
                className="ios-pressable rounded-full px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {labels.remove}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void post(
                    { action: 'dismiss', targetType: 'mkt_listing', targetId: e.targetId },
                    e.reportId,
                  )
                }
                className="ios-pressable rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
              >
                {labels.dismiss}
              </button>
              {busy === e.reportId ? (
                <span className="text-xs text-muted-foreground">{labels.working}</span>
              ) : null}
              {error ? <span className="text-xs text-destructive">{labels.failed}</span> : null}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
