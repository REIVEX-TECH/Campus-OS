'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface ModQueueEntry {
  reportId: string;
  targetType: 'lf_item' | 'lf_claim';
  targetId: string;
  reason: string;
  note: string | null;
  reporterHandle: string | null;
  itemId: string | null;
  itemTitle: string | null;
  claimMessage: string | null;
}

export interface ModQueueLabels {
  empty: string;
  reportedItem: string;
  reportedClaim: string;
  by: string;
  viewItem: string;
  remove: string;
  removePrompt: string;
  dismiss: string;
  working: string;
}

/** The Lost & Found moderation queue: open reports with remove / dismiss. */
export function LostFoundModQueue({
  base,
  tenant,
  entries,
  labels,
}: {
  base: string;
  tenant: string;
  entries: ModQueueEntry[];
  labels: ModQueueLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, body: unknown) {
    setBusy(key);
    try {
      await fetch('/api/lost-found/moderation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (entries.length === 0) {
    return <p className="px-1 text-sm text-muted-foreground">{labels.empty}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e) => (
        <li key={e.reportId} className="ios-card flex flex-col gap-2 rounded-2xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
              {e.targetType === 'lf_item' ? labels.reportedItem : labels.reportedClaim}
            </span>
            <span className="text-[11px] text-muted-foreground">{e.reason}</span>
          </div>
          {e.itemTitle ? <p className="text-sm font-medium">{e.itemTitle}</p> : null}
          {e.claimMessage ? (
            <p className="whitespace-pre-wrap text-sm italic text-muted-foreground">
              “{e.claimMessage}”
            </p>
          ) : null}
          {e.note ? <p className="text-sm text-muted-foreground">{e.note}</p> : null}
          <p className="text-[11px] text-muted-foreground">
            {labels.by.replace('{handle}', e.reporterHandle ?? '?')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {e.itemId ? (
              <Link
                href={`${base}/lost-found/${e.itemId}`}
                className="text-xs font-medium text-primary"
              >
                {labels.viewItem}
              </Link>
            ) : null}
            {e.targetType === 'lf_item' && e.itemId ? (
              <button
                type="button"
                disabled={busy === e.reportId}
                onClick={() => {
                  const reason = window.prompt(labels.removePrompt);
                  if (reason && reason.trim().length >= 2) {
                    void act(e.reportId, {
                      tenant,
                      action: 'remove',
                      itemId: e.itemId,
                      reason: reason.trim(),
                    });
                  }
                }}
                className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive disabled:opacity-50"
              >
                {busy === e.reportId ? labels.working : labels.remove}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy === e.reportId}
              onClick={() =>
                void act(e.reportId, {
                  tenant,
                  action: 'dismiss',
                  targetType: e.targetType,
                  targetId: e.targetId,
                })
              }
              className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
            >
              {labels.dismiss}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
