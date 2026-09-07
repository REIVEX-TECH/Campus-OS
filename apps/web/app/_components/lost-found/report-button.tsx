'use client';

import { useState } from 'react';

// The app's field vocabulary, matching the community forms.
const noteField =
  'ios-field h-10 w-full rounded-xl px-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export interface ReportLabels {
  button: string;
  intro: string;
  reasons: { value: string; label: string }[];
  notePlaceholder: string;
  send: string;
  sending: string;
  done: string;
  failed: string;
}

/** Report an item or a claim: a reason and an optional note. */
export function ReportButton({
  tenant,
  targetType,
  targetId,
  labels,
}: {
  tenant: string;
  targetType: 'lf_item' | 'lf_claim';
  targetId: string;
  labels: ReportLabels;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(labels.reasons[0]?.value ?? 'other');
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
    setState('sending');
    try {
      const res = await fetch('/api/lost-found/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, targetType, targetId, reason, note: note || undefined }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <form onSubmit={submit} className="ios-card flex flex-col gap-2 rounded-2xl p-3">
      <p className="text-xs font-medium">{labels.intro}</p>
      <div className="flex flex-col gap-1">
        {labels.reasons.map((r) => (
          <label key={r.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="size-4 accent-primary"
              name={`report-${targetId}`}
              value={r.value}
              checked={reason === r.value}
              onChange={() => setReason(r.value)}
            />
            {r.label}
          </label>
        ))}
      </div>
      <input
        className={noteField}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={labels.notePlaceholder}
        maxLength={1000}
      />
      {state === 'error' ? <p className="text-xs text-destructive">{labels.failed}</p> : null}
      <div>
        <button
          type="submit"
          disabled={state === 'sending'}
          className="rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {state === 'sending' ? labels.sending : labels.send}
        </button>
      </div>
    </form>
  );
}
