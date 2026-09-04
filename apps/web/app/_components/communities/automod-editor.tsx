'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

export type AutomodDraft = {
  kind: 'keyword' | 'domain';
  pattern: string;
  action: 'queue' | 'remove';
};

export type AutomodLabels = {
  heading: string;
  intro: string;
  kind: string;
  keyword: string;
  domain: string;
  pattern: string;
  action: string;
  queue: string;
  remove: string;
  add: string;
  /** "{n}" is replaced with the rule's number. */
  delete: string;
  save: string;
  saved: string;
  working: string;
  empty: string;
  errors: Record<string, string>;
};

const field =
  'ios-field h-10 w-full rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** A community's filters: keywords and link domains, each held for review or removed. Saved as a whole. */
export function AutomodEditor({
  tenant,
  communityId,
  initial,
  labels,
}: {
  tenant: string;
  communityId: string;
  initial: AutomodDraft[];
  labels: AutomodLabels;
}) {
  const router = useRouter();
  const [rules, setRules] = useState<AutomodDraft[]>(initial);
  const [status, setStatus] = useState<{
    kind: 'idle' | 'working' | 'done' | 'error';
    message?: string;
  }>({ kind: 'idle' });
  const working = status.kind === 'working';

  const update = (i: number, patch: Partial<AutomodDraft>) =>
    setRules((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form
      className="ios-card flex flex-col gap-3 rounded-2xl p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setStatus({ kind: 'working' });
        const response = await fetch(`/api/communities/${communityId}/automod`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tenant,
            rules: rules.map((r) => ({ ...r, pattern: r.pattern.trim() })),
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
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rules.map((r, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[8rem_1fr_9rem_auto]">
              <label className="flex flex-col gap-1 text-xs font-medium">
                {labels.kind}
                <select
                  value={r.kind}
                  onChange={(e) => update(i, { kind: e.target.value as AutomodDraft['kind'] })}
                  className={field}
                >
                  <option value="keyword">{labels.keyword}</option>
                  <option value="domain">{labels.domain}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {labels.pattern}
                <input
                  value={r.pattern}
                  onChange={(e) => update(i, { pattern: e.target.value })}
                  required
                  minLength={2}
                  maxLength={100}
                  className={field}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {labels.action}
                <select
                  value={r.action}
                  onChange={(e) => update(i, { action: e.target.value as AutomodDraft['action'] })}
                  className={field}
                >
                  <option value="queue">{labels.queue}</option>
                  <option value="remove">{labels.remove}</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setRules((all) => all.filter((_, j) => j !== i))}
                className={`${buttonVariants({ size: 'sm', variant: 'ghost' })} self-end`}
                aria-label={labels.delete.replace('{n}', String(i + 1))}
              >
                {labels.delete.replace('{n}', '')}
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={rules.length >= 50}
          onClick={() =>
            setRules((all) => [...all, { kind: 'keyword', pattern: '', action: 'queue' }])
          }
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
