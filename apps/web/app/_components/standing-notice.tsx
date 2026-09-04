'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/**
 * What was done, why, and until when, shown to the person it was done to.
 *
 * Never hidden and never softened: a restriction the person cannot see is one
 * they cannot appeal, and an unappealable decision is one nobody ever learns
 * was wrong. The note goes to the university's administrators and is the only
 * thing on this card that the person controls.
 */
export function StandingNotice({
  tenant,
  status,
  reason,
  until,
  appealNote,
  labels,
}: {
  tenant: string;
  status: 'restricted' | 'suspended';
  reason: string | null;
  /** Already formatted, or null for until it is lifted. */
  until: string | null;
  appealNote: string | null;
  labels: {
    restricted: string;
    suspended: string;
    restrictedBody: string;
    suspendedBody: string;
    reason: string;
    untilDate: string;
    untilLifted: string;
    appeal: string;
    appealPlaceholder: string;
    appealSend: string;
    appealSent: string;
    appealStanding: string;
    failed: string;
  };
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section
      aria-labelledby="standing-heading"
      className="ios-card mx-auto flex w-full max-w-xl flex-col gap-3 rounded-2xl p-5"
    >
      <h1 id="standing-heading" className="text-xl font-bold tracking-tight">
        {status === 'suspended' ? labels.suspended : labels.restricted}
      </h1>
      <p className="text-sm text-muted-foreground">
        {status === 'suspended' ? labels.suspendedBody : labels.restrictedBody}
      </p>
      {reason ? (
        <p className="text-sm">
          <span className="font-medium">{labels.reason}</span> {reason}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {until ? labels.untilDate.replace('{date}', until) : labels.untilLifted}
      </p>

      {appealNote ? (
        <p className="rounded-xl bg-muted/50 p-3 text-sm">
          <span className="font-medium">{labels.appealStanding}</span> {appealNote}
        </p>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setMessage(null);
            const response = await fetch('/api/standing/appeal', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tenant, note: note.trim() }),
            });
            setBusy(false);
            if (!response.ok) {
              setMessage(labels.failed);
              return;
            }
            setMessage(labels.appealSent);
            router.refresh();
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{labels.appeal}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={labels.appealPlaceholder}
              required
              minLength={3}
              maxLength={1000}
              className="ios-field min-h-24 w-full rounded-xl px-3.5 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className={buttonVariants({ size: 'sm' })}>
              {labels.appealSend}
            </button>
            {message ? (
              <p role="status" className="text-xs text-muted-foreground">
                {message}
              </p>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
