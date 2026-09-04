'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/**
 * Before a first post in a community with rules: the rules, a checkbox, and
 * one button. Accepting is recorded once; the compose form follows on refresh.
 */
export function RulesGate({
  tenant,
  communityId,
  rules,
  labels,
}: {
  tenant: string;
  communityId: string;
  rules: { title: string; description: string | null }[];
  labels: {
    heading: string;
    intro: string;
    confirm: string;
    accept: string;
    working: string;
    errors: Record<string, string>;
  };
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="ios-card flex flex-col gap-3 rounded-2xl p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const response = await fetch(`/api/communities/${communityId}/rules/accept`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenant }),
        });
        setBusy(false);
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setError(labels.errors[data.error ?? ''] ?? labels.errors.failed ?? '');
          return;
        }
        router.refresh();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{labels.heading}</h2>
        <p className="text-sm text-muted-foreground">{labels.intro}</p>
      </div>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
        {rules.map((r, i) => (
          <li key={i}>
            <span className="font-medium">{r.title}</span>
            {r.description ? (
              <span className="block text-muted-foreground">{r.description}</span>
            ) : null}
          </li>
        ))}
      </ol>
      <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        {labels.confirm}
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!checked || busy}
          className={buttonVariants({ size: 'sm' })}
        >
          {busy ? labels.working : labels.accept}
        </button>
        {error ? (
          <p role="status" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
