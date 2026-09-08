'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface ReviewFormLabels {
  heading: string;
  rating: string;
  comment: string;
  submit: string;
  submitting: string;
  failed: string;
}

/** The buyer rates a completed order 1 to 5 with an optional comment. */
export function ReviewForm({
  tenant,
  orderId,
  labels,
}: {
  tenant: string;
  orderId: string;
  labels: ReviewFormLabels;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'saving') return;
    setStatus('saving');
    const res = await fetch(`/api/marketplace/orders/${orderId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, rating, body: body || undefined }),
    }).catch(() => undefined);
    if (!res?.ok) {
      setStatus('error');
      return;
    }
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
            aria-checked={rating === n}
            aria-label={`${n}`}
            onClick={() => setRating(n)}
            className={`text-2xl leading-none ${n <= rating ? 'text-warning' : 'text-muted-foreground/40'}`}
          >
            {'★'}
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
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
