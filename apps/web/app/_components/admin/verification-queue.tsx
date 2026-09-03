'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { IdentityAvatar } from '../identity-avatar';

/**
 * The requests waiting for a decision, and the two buttons that decide them.
 *
 * Every decision is one POST the server treats as idempotent, so a double
 * click, a retry, or two admins deciding the same request at once all resolve
 * to one decision. The list refreshes from the server afterwards rather than
 * being edited here.
 */

export type QueueItem = {
  id: string;
  handle: string;
  avatarSeed: string;
  fullName: string;
  rollNumber: string;
  note: string | null;
  /** Already formatted for the locale. */
  requested: string;
};

export type QueueLabels = {
  approve: string;
  reject: string;
  working: string;
  decided: string;
  alreadyDecided: string;
  self: string;
  failed: string;
  fullName: string;
  rollNumber: string;
  note: string;
};

type Outcome = { id: string; message: string };

export function VerificationQueue({
  tenant,
  items,
  labels,
}: {
  tenant: string;
  items: QueueItem[];
  labels: QueueLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function decide(id: string, decision: 'approve' | 'reject'): Promise<void> {
    setBusy(id);
    const response = await fetch('/api/admin/verification', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, requestId: id, decision }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      outcome?: string;
      error?: string;
    };
    setBusy(null);
    if (!response.ok) {
      setOutcome({ id, message: body.error === 'self' ? labels.self : labels.failed });
      return;
    }
    setOutcome({
      id,
      message: body.outcome === 'already_decided' ? labels.alreadyDecided : labels.decided,
    });
    router.refresh();
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((r) => (
        <li key={r.id} className="ios-card flex flex-col gap-3 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <IdentityAvatar seed={r.avatarSeed} label={r.handle} size={40} />
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-sm font-semibold">{r.handle}</p>
              <p className="text-xs text-muted-foreground">{r.requested}</p>
            </div>
          </div>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-muted-foreground">{labels.rollNumber}</dt>
            <dd className="break-words font-medium">{r.rollNumber}</dd>
            <dt className="sr-only">{labels.fullName}</dt>
            <dd className="break-words font-medium sm:col-span-2">{r.fullName}</dd>
            {r.note ? (
              <>
                <dt className="text-muted-foreground">{labels.note}</dt>
                <dd className="break-words">{r.note}</dd>
              </>
            ) : null}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => decide(r.id, 'approve')}
              disabled={busy !== null}
              aria-busy={busy === r.id || undefined}
              className={buttonVariants({ size: 'sm' })}
            >
              {busy === r.id ? labels.working : labels.approve}
            </button>
            <button
              type="button"
              onClick={() => decide(r.id, 'reject')}
              disabled={busy !== null}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              {labels.reject}
            </button>
            {outcome?.id === r.id ? (
              <p className="text-sm text-muted-foreground" role="status">
                {outcome.message}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
