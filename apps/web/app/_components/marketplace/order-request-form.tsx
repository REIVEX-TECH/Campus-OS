'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface OrderRequestLabels {
  requirements: string;
  requirementsPlaceholder: string;
  paymentMode: string;
  cash: string;
  cashHint: string;
  online: string;
  onlineHint: string;
  submit: string;
  submitting: string;
  failed: string;
}

const area =
  'ios-field min-h-24 w-full rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Buyer's order request: their brief, a payment mode, then place the order. */
export function OrderRequestForm({
  base,
  tenant,
  gigId,
  packageId,
  labels,
}: {
  base: string;
  tenant: string;
  gigId: string;
  packageId: string;
  labels: OrderRequestLabels;
}) {
  const router = useRouter();
  const [requirements, setRequirements] = useState('');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'online'>('cash');
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'saving') return;
    setStatus('saving');
    try {
      const res = await fetch('/api/marketplace/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant,
          gigId,
          packageId,
          paymentMode,
          requirements: requirements || undefined,
        }),
      });
      if (!res.ok) {
        setStatus('error');
        return;
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`${base}/orders/${id}`);
    } catch {
      setStatus('error');
    }
  }

  const modeRow =
    'flex cursor-pointer items-start gap-2 rounded-xl border border-border p-3 text-sm';

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{labels.requirements}</span>
        <textarea
          className={area}
          value={requirements}
          onChange={(e) => setRequirements(e.target.value)}
          placeholder={labels.requirementsPlaceholder}
          maxLength={4000}
          rows={5}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{labels.paymentMode}</legend>
        <label className={modeRow}>
          <input
            type="radio"
            name="paymentMode"
            checked={paymentMode === 'cash'}
            onChange={() => setPaymentMode('cash')}
            className="mt-0.5"
          />
          <span className="flex flex-col">
            <span className="font-medium">{labels.cash}</span>
            <span className="text-xs text-muted-foreground">{labels.cashHint}</span>
          </span>
        </label>
        <label className={modeRow}>
          <input
            type="radio"
            name="paymentMode"
            checked={paymentMode === 'online'}
            onChange={() => setPaymentMode('online')}
            className="mt-0.5"
          />
          <span className="flex flex-col">
            <span className="font-medium">{labels.online}</span>
            <span className="text-xs text-muted-foreground">{labels.onlineHint}</span>
          </span>
        </label>
      </fieldset>

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
