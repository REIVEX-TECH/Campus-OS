'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/** Crosspost this post into one of the communities the viewer belongs to. */
export function CrosspostButton({
  tenant,
  postId,
  targets,
  labels,
  className,
}: {
  tenant: string;
  postId: string;
  targets: { id: string; name: string; href: string }[];
  labels: {
    crosspost: string;
    to: string;
    send: string;
    cancel: string;
    errors: Record<string, string>;
  };
  className: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(targets[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (targets.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-expanded={open}
        className={className}
        onClick={() => setOpen((o) => !o)}
      >
        {labels.crosspost}
      </button>
      {open ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const response = await fetch(`/api/communities/posts/${postId}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tenant, action: 'crosspost', communityId: target }),
            });
            setBusy(false);
            const data = (await response.json().catch(() => ({}))) as {
              error?: string;
              id?: string;
            };
            if (!response.ok || !data.id) {
              setError(labels.errors[data.error ?? ''] ?? labels.errors.failed ?? '');
              return;
            }
            const chosen = targets.find((t) => t.id === target);
            router.push(`${chosen?.href ?? ''}/post/${data.id}`);
          }}
        >
          <label className="flex items-center gap-1.5 text-xs font-medium">
            {labels.to}
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="ios-field h-8 rounded-lg px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy} className={buttonVariants({ size: 'sm' })}>
            {labels.send}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            {labels.cancel}
          </button>
          {error ? (
            <span role="status" className="text-xs text-destructive">
              {error}
            </span>
          ) : null}
        </form>
      ) : null}
    </span>
  );
}
