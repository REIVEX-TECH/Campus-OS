'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

export type FlairDraft = { id?: string; name: string; color: string };

export type FlairLabels = {
  heading: string;
  intro: string;
  name: string;
  color: string;
  add: string;
  /** "{n}" is replaced. */
  remove: string;
  save: string;
  saved: string;
  working: string;
  empty: string;
  errors: Record<string, string>;
};

const PALETTE = ['#0b5d3b', '#1d4ed8', '#b45309', '#be123c', '#6d28d9', '#0f766e', '#6b7280'];

const field =
  'ios-field h-10 w-full rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** A community's post flairs: name and colour each, saved as a set by id so posts keep theirs. */
export function FlairEditor({
  tenant,
  communityId,
  initial,
  labels,
}: {
  tenant: string;
  communityId: string;
  initial: FlairDraft[];
  labels: FlairLabels;
}) {
  const router = useRouter();
  const [flairs, setFlairs] = useState<FlairDraft[]>(initial);
  const [status, setStatus] = useState<{
    kind: 'idle' | 'working' | 'done' | 'error';
    message?: string;
  }>({ kind: 'idle' });
  const working = status.kind === 'working';
  const update = (i: number, patch: Partial<FlairDraft>) =>
    setFlairs((all) => all.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <form
      className="ios-card flex flex-col gap-3 rounded-2xl p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setStatus({ kind: 'working' });
        const response = await fetch(`/api/communities/${communityId}/flairs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tenant,
            flairs: flairs.map((f) => ({ ...f, name: f.name.trim() })),
          }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setStatus({
            kind: 'error',
            message: labels.errors[data.error ?? ''] ?? labels.errors.failed ?? '',
          });
          return;
        }
        setStatus({ kind: 'done', message: labels.saved });
        router.refresh();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">{labels.heading}</h2>
        <p className="text-xs text-muted-foreground">{labels.intro}</p>
      </div>
      {flairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {flairs.map((f, i) => (
            <li key={f.id ?? `new-${i}`} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <label className="flex flex-col gap-1 text-xs font-medium">
                {labels.name}
                <input
                  value={f.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  required
                  maxLength={24}
                  className={field}
                />
              </label>
              <fieldset className="flex flex-col gap-1 text-xs font-medium">
                <legend>{labels.color}</legend>
                <div className="flex h-10 items-center gap-1.5">
                  {PALETTE.map((c) => (
                    <label key={c} className="cursor-pointer">
                      <input
                        type="radio"
                        name={`flair-color-${i}`}
                        value={c}
                        checked={f.color === c}
                        onChange={() => update(i, { color: c })}
                        className="sr-only"
                      />
                      <span
                        aria-label={c}
                        className={`block size-6 rounded-full ring-offset-2 ring-offset-background ${
                          f.color === c ? 'ring-2 ring-ring' : ''
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                type="button"
                onClick={() => setFlairs((all) => all.filter((_, j) => j !== i))}
                className={`${buttonVariants({ size: 'sm', variant: 'ghost' })} self-end`}
                aria-label={labels.remove.replace('{n}', String(i + 1))}
              >
                {labels.remove.replace('{n}', '')}
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={flairs.length >= 20}
          onClick={() => setFlairs((all) => [...all, { name: '', color: PALETTE[0]! }])}
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
        >
          {labels.add}
        </button>
        <button type="submit" disabled={working} className={buttonVariants({ size: 'sm' })}>
          {working ? labels.working : labels.save}
        </button>
        {status.message ? (
          <p
            role="status"
            className={
              status.kind === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
            }
          >
            {status.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
