'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface RideFormLabels {
  kind: string;
  offer: string;
  request: string;
  origin: string;
  originPlaceholder: string;
  dest: string;
  destPlaceholder: string;
  departAt: string;
  seats: string;
  womenOnly: string;
  womenOnlyNote: string;
  notes: string;
  notesHint: string;
  optional: string;
  submit: string;
  submitting: string;
  failed: string;
  contactInfo: string;
  past: string;
}

const field =
  'ios-field h-11 w-full rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const area =
  'ios-field min-h-24 w-full rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Post a ride offer or request. One-off departures; recurring offers are a follow-up. */
export function PostRideForm({
  base,
  tenant,
  maxSeats,
  labels,
}: {
  base: string;
  tenant: string;
  maxSeats: number;
  labels: RideFormLabels;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<'offer' | 'request'>('offer');
  const [originText, setOrigin] = useState('');
  const [destText, setDest] = useState('');
  const [departLocal, setDepartLocal] = useState('');
  const [seats, setSeats] = useState(1);
  const [womenOnly, setWomenOnly] = useState(false);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const errorText = (reason: string | null): string => {
    if (reason === 'contact_info') return labels.contactInfo;
    if (reason === 'past') return labels.past;
    return labels.failed;
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'saving') return;
    setStatus('saving');
    setError(null);
    const departAt = departLocal ? new Date(departLocal).toISOString() : '';
    const body: Record<string, unknown> = {
      tenant,
      kind,
      originText: originText.trim(),
      destText: destText.trim(),
      departAt,
      womenOnly,
      ...(kind === 'offer' ? { seats } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    const res = await fetch('/api/rides', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus('error');
      setError(data.error ?? 'failed');
      return;
    }
    const { id } = (await res.json()) as { id: string };
    router.push(`${base}/rides/${id}`);
  }

  const segment = (active: boolean) =>
    `flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${
      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
    }`;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <span className="mb-1.5 block text-sm font-medium">{labels.kind}</span>
        <div className="flex gap-2">
          <button
            type="button"
            className={segment(kind === 'offer')}
            onClick={() => setKind('offer')}
          >
            {labels.offer}
          </button>
          <button
            type="button"
            className={segment(kind === 'request')}
            onClick={() => setKind('request')}
          >
            {labels.request}
          </button>
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.origin}</span>
        <input
          className={field}
          value={originText}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder={labels.originPlaceholder}
          required
          minLength={2}
          maxLength={120}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.dest}</span>
        <input
          className={field}
          value={destText}
          onChange={(e) => setDest(e.target.value)}
          placeholder={labels.destPlaceholder}
          required
          minLength={2}
          maxLength={120}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.departAt}</span>
        <input
          type="datetime-local"
          className={field}
          value={departLocal}
          onChange={(e) => setDepartLocal(e.target.value)}
          required
        />
      </label>

      {kind === 'offer' ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{labels.seats}</span>
          <input
            type="number"
            className={field}
            value={seats}
            min={1}
            max={maxSeats}
            onChange={(e) => setSeats(Math.max(1, Math.min(maxSeats, Number(e.target.value) || 1)))}
            required
          />
        </label>
      ) : null}

      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-1"
          checked={womenOnly}
          onChange={(e) => setWomenOnly(e.target.checked)}
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">{labels.womenOnly}</span>
          <span className="text-[13px] text-muted-foreground">{labels.womenOnlyNote}</span>
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          {labels.notes} <span className="text-muted-foreground">({labels.optional})</span>
        </span>
        <textarea
          className={area}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          placeholder={labels.notesHint}
        />
      </label>

      {status === 'error' ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorText(error)}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === 'saving'}
        className="ios-pressable rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {status === 'saving' ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
