'use client';

import { useState } from 'react';
import { buttonVariants } from '@campusos/ui';
import { REPORT_REASONS } from '@/lib/community-constants';
import { refusalMessage } from '@/lib/refusal-message';

/**
 * Report a person, rather than one thing they wrote.
 *
 * For somebody who is a problem across a university and not in one thread, so
 * it goes to the university's administrators and not to a community's
 * moderators. It says nothing back about what happened next, because the
 * person reported is not owed the reporter's name and the reporter is not owed
 * the outcome.
 */
export function ReportPerson({
  tenant,
  userId,
  labels,
  className,
}: {
  tenant: string;
  userId: string;
  labels: {
    report: string;
    heading: string;
    reasons: Record<string, string>;
    note: string;
    send: string;
    cancel: string;
    sent: string;
    errors: Record<string, string>;
  };
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  if (message && !message.error) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {message.text}
      </p>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {open ? null : (
        <button type="button" className={className} onClick={() => setOpen(true)}>
          {labels.report}
        </button>
      )}
      {message?.error ? (
        <p role="status" className="text-xs text-destructive">
          {message.text}
        </p>
      ) : null}

      {open ? (
        <form
          className="ios-card flex w-full max-w-sm flex-col gap-2 rounded-2xl p-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setMessage(null);
            const response = await fetch(`/api/communities/people/${userId}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                action: 'report',
                tenant,
                reason,
                note: note.trim() || undefined,
              }),
            });
            setBusy(false);
            if (!response.ok) {
              const body = (await response.json().catch(() => ({}))) as { error?: string };
              setMessage({ text: refusalMessage(labels.errors, body), error: true });
              return;
            }
            setOpen(false);
            setMessage({ text: labels.sent, error: false });
          }}
        >
          <p className="text-sm font-medium">{labels.heading}</p>
          <label className="flex flex-col gap-1.5 text-sm">
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="ios-field h-10 w-full rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {labels.reasons[r] ?? r}
                </option>
              ))}
            </select>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={labels.note}
            maxLength={500}
            className="ios-field min-h-16 w-full rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className={buttonVariants({ size: 'sm' })}>
              {labels.send}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={buttonVariants({ size: 'sm', variant: 'ghost' })}
            >
              {labels.cancel}
            </button>
          </div>
        </form>
      ) : null}
    </span>
  );
}
