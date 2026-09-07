'use client';

import { useState } from 'react';

const REASONS = ['prohibited', 'scam', 'spam', 'inappropriate', 'other'] as const;

export interface ReportLabels {
  button: string;
  prompt: string;
  note: string;
  send: string;
  done: string;
  failed: string;
  cancel: string;
  reasonLabels: Record<string, string>;
}

/** Report a listing to moderators: pick a reason, optionally add a note, send. */
export function ReportButton({
  tenant,
  listingId,
  labels,
}: {
  tenant: string;
  listingId: string;
  labels: ReportLabels;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('prohibited');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  async function send() {
    if (state === 'sending') return;
    setState('sending');
    const res = await fetch('/api/marketplace/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant,
        targetType: 'mkt_listing',
        targetId: listingId,
        reason,
        note: note.trim() || undefined,
      }),
    }).catch(() => undefined);
    setState(res?.ok ? 'done' : 'error');
  }

  if (state === 'done') {
    return <p className="px-1 text-xs text-muted-foreground">{labels.done}</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ios-pressable rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
      >
        {labels.button}
      </button>
    );
  }

  const field =
    'ios-field rounded-lg px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="ios-card flex flex-col gap-2 rounded-2xl p-3">
      <span className="text-sm font-medium">{labels.prompt}</span>
      <select
        className={`${field} h-9`}
        value={reason}
        onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
        aria-label={labels.prompt}
      >
        {REASONS.map((r) => (
          <option key={r} value={r}>
            {labels.reasonLabels[r] ?? r}
          </option>
        ))}
      </select>
      <input
        className={`${field} h-9`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={labels.note}
        maxLength={1000}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={state === 'sending'}
          onClick={() => void send()}
          className="ios-pressable rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {labels.send}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ios-pressable rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          {labels.cancel}
        </button>
        {state === 'error' ? (
          <span className="text-xs text-destructive">{labels.failed}</span>
        ) : null}
      </div>
    </div>
  );
}
