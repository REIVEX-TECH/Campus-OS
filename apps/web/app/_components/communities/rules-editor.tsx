'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

export type RuleDraft = { title: string; description: string };

export type RulesLabels = {
  title: string;
  description: string;
  add: string;
  /** "{n}" is replaced with the rule's number. */
  remove: string;
  save: string;
  saved: string;
  working: string;
  errors: Record<string, string>;
};

const field =
  'ios-field h-10 w-full rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** A community's own rules, as an ordered list saved as a whole. */
export function RulesEditor({
  tenant,
  communityId,
  initial,
  labels,
}: {
  tenant: string;
  communityId: string;
  initial: RuleDraft[];
  labels: RulesLabels;
}) {
  const router = useRouter();
  const [rules, setRules] = useState<RuleDraft[]>(initial);
  const [status, setStatus] = useState<{
    kind: 'idle' | 'working' | 'done' | 'error';
    message?: string;
  }>({
    kind: 'idle',
  });
  const working = status.kind === 'working';

  const update = (i: number, patch: Partial<RuleDraft>) => {
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setStatus({ kind: 'idle' });
  };

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus({ kind: 'working' });
    const response = await fetch(`/api/communities/${communityId}/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, rules }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setStatus({
        kind: 'error',
        message: labels.errors[body.error ?? ''] ?? labels.errors.failed,
      });
      return;
    }
    setStatus({ kind: 'done', message: labels.saved });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {rules.map((r, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <input
                className={field}
                value={r.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder={labels.title}
                aria-label={`${labels.title} ${i + 1}`}
                required
                minLength={2}
                maxLength={100}
              />
              <button
                type="button"
                onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))}
                aria-label={labels.remove.replace('{n}', String(i + 1))}
                className="ios-pressable inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            <input
              className={`${field} ml-7 w-auto`}
              value={r.description}
              onChange={(e) => update(i, { description: e.target.value })}
              placeholder={labels.description}
              aria-label={`${labels.description} ${i + 1}`}
              maxLength={500}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setRules((prev) => [...prev, { title: '', description: '' }])}
          disabled={rules.length >= 20}
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
        >
          {labels.add}
        </button>
        <button
          type="submit"
          disabled={working}
          aria-busy={working || undefined}
          className={buttonVariants({ size: 'sm' })}
        >
          {working ? labels.working : labels.save}
        </button>
        {status.kind === 'done' || status.kind === 'error' ? (
          <p
            role="status"
            className={
              status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
            }
          >
            {status.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
