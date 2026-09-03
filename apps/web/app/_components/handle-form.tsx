'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Change your handle.
 *
 * The rules are enforced on the server; this form's job is to explain a refusal
 * in words rather than leaving someone guessing why their choice bounced.
 */

export type HandleFormLabels = {
  label: string;
  hint: string;
  save: string;
  saving: string;
  saved: string;
  lockedUntil: string;
  errorFormat: string;
  errorReserved: string;
  errorTaken: string;
  errorTooSoon: string;
};

type State = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string };

export function HandleForm({
  handle,
  canChange,
  labels,
}: {
  handle: string;
  canChange: boolean;
  labels: HandleFormLabels;
}) {
  const router = useRouter();
  const [value, setValue] = useState(handle);
  const [state, setState] = useState<State>({ kind: 'idle' });

  const messageFor = (reason: string): string =>
    ({
      format: labels.errorFormat,
      reserved: labels.errorReserved,
      taken: labels.errorTaken,
      too_soon: labels.errorTooSoon,
    })[reason] ?? labels.errorTaken;

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setState({ kind: 'saving' });
    const response = await fetch('/api/account/handle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: value }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setState({ kind: 'error', message: messageFor(body.error ?? 'taken') });
      return;
    }
    setState({ kind: 'saved' });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.label}</span>
        <input
          name="handle"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!canChange}
          aria-describedby="handle-hint"
          className="ios-field h-11 w-full max-w-sm rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
      </label>
      <p id="handle-hint" className="text-xs text-muted-foreground">
        {canChange ? labels.hint : labels.lockedUntil}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!canChange || state.kind === 'saving' || value === handle}
          className="ios-pressable ios-card rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {state.kind === 'saving' ? labels.saving : labels.save}
        </button>
      </div>

      {state.kind === 'error' ? (
        <p className="text-sm text-destructive" role="status">
          {state.message}
        </p>
      ) : null}
      {state.kind === 'saved' ? (
        <p className="text-sm text-muted-foreground" role="status">
          {labels.saved}
        </p>
      ) : null}
    </form>
  );
}
