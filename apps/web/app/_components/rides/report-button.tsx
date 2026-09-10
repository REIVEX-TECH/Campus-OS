'use client';

import { useState } from 'react';

// The app's field vocabulary, matching the community forms.
const field =
  'ios-field h-10 w-full rounded-xl px-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export interface ReportLabels {
  button: string;
  heading: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  noteLabel: string;
  noteHint: string;
  submit: string;
  submitting: string;
  done: string;
  failed: string;
}

/** Report a ride or a person: a short reason and an optional note. */
export function ReportButton({
  tenant,
  targetType,
  targetId,
  labels,
}: {
  tenant: string;
  targetType: 'ride_post' | 'user';
  targetId: string;
  labels: ReportLabels;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  if (state === 'done') {
    return <span className="text-xs text-muted-foreground">{labels.done}</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
      >
        {labels.button}
      </button>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 2) return;
    setState('sending');
    try {
      const res = await fetch('/api/rides/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant,
          targetType,
          targetId,
          reason: reason.trim(),
          note: note.trim() || undefined,
        }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <form onSubmit={submit} className="ios-card flex flex-col gap-2 rounded-2xl p-3">
      <p className="text-xs font-semibold">{labels.heading}</p>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {labels.reasonLabel}
        <input
          className={field}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={labels.reasonPlaceholder}
          maxLength={60}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {labels.noteLabel}
        <input
          className={field}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={labels.noteHint}
          maxLength={1000}
        />
      </label>
      {state === 'error' ? <p className="text-xs text-destructive">{labels.failed}</p> : null}
      <div>
        <button
          type="submit"
          disabled={state === 'sending' || reason.trim().length < 2}
          className="rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {state === 'sending' ? labels.submitting : labels.submit}
        </button>
      </div>
    </form>
  );
}
