'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface RateFormLabels {
  heading: string;
  rating: string;
  comment: string;
  submit: string;
  submitting: string;
  done: string;
  failed: string;
}

/** Rate the other party of a completed ride, 1 to 5 with an optional comment. */
export function RateForm({
  tenant,
  rideId,
  ratee,
  direction,
  labels,
}: {
  tenant: string;
  rideId: string;
  ratee: string;
  direction: 'of_driver' | 'of_passenger';
  labels: RateFormLabels;
}) {
  const router = useRouter();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  if (status === 'done') {
    return <p className="ios-card rounded-2xl p-3 text-sm text-muted-foreground">{labels.done}</p>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'saving') return;
    setStatus('saving');
    const res = await fetch(`/api/rides/${rideId}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant,
        ratee,
        stars,
        direction,
        comment: comment.trim() || undefined,
      }),
    }).catch(() => undefined);
    if (!res?.ok) {
      setStatus('error');
      return;
    }
    setStatus('done');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="ios-card flex flex-col gap-3 rounded-2xl p-4">
      <span className="text-sm font-semibold">{labels.heading}</span>
      <div className="flex items-center gap-1" role="radiogroup" aria-label={labels.rating}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n}`}
            onClick={() => setStars(n)}
            className={`text-2xl leading-none ${n <= stars ? 'text-warning' : 'text-muted-foreground/40'}`}
          >
            {'★'}
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={labels.comment}
        maxLength={2000}
        rows={3}
        className="ios-field min-h-20 w-full rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {status === 'error' ? <p className="text-sm text-destructive">{labels.failed}</p> : null}
      <div>
        <button
          type="submit"
          disabled={status === 'saving'}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {status === 'saving' ? labels.submitting : labels.submit}
        </button>
      </div>
    </form>
  );
}
