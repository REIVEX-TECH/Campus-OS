'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/**
 * Ask the university to verify you.
 *
 * The rules live on the server; this form's only job is to collect the three
 * things an admin can check and to explain a refusal in words. The details are
 * purged once decided, and the intro says so before anything is typed.
 */

export type VerificationFormLabels = {
  fullName: string;
  rollNumber: string;
  note: string;
  submit: string;
  submitting: string;
  sent: string;
  errorFormat: string;
  errorOpen: string;
  errorRate: string;
  errorVerified: string;
  errorGeneric: string;
};

type State = { kind: 'idle' | 'sending' | 'sent' } | { kind: 'error'; message: string };

export function VerificationRequestForm({
  tenant,
  labels,
}: {
  tenant: string;
  labels: VerificationFormLabels;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const messageFor = (reason: string): string =>
    ({
      format: labels.errorFormat,
      open_request: labels.errorOpen,
      rate_limited: labels.errorRate,
      already_verified: labels.errorVerified,
    })[reason] ?? labels.errorGeneric;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setState({ kind: 'sending' });
    const response = await fetch('/api/account/verification', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, fullName, rollNumber, note: note || undefined }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setState({ kind: 'error', message: messageFor(body.error ?? 'generic') });
      return;
    }
    setState({ kind: 'sent' });
    router.refresh();
  }

  const sending = state.kind === 'sending';
  const field =
    'ios-field h-11 w-full rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.fullName}</span>
        <input
          name="fullName"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
          required
          minLength={2}
          maxLength={120}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.rollNumber}</span>
        <input
          name="rollNumber"
          value={rollNumber}
          onChange={(e) => setRollNumber(e.target.value)}
          autoComplete="off"
          required
          minLength={2}
          maxLength={40}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.note}</span>
        <textarea
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          className="ios-field w-full rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={sending}
          aria-busy={sending || undefined}
          className={buttonVariants({ size: 'sm' })}
        >
          {sending ? labels.submitting : labels.submit}
        </button>
        {state.kind === 'sent' ? (
          <p className="text-sm text-muted-foreground" role="status">
            {labels.sent}
          </p>
        ) : null}
        {state.kind === 'error' ? (
          <p className="text-sm text-destructive" role="status">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
