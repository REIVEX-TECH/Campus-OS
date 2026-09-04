'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type PinnedEntry = { id: string; title: string; href: string };

/** The pinned posts in the order the community shows them, with up and down. */
export function PinnedOrder({
  tenant,
  communityId,
  items,
  labels,
}: {
  tenant: string;
  communityId: string;
  items: PinnedEntry[];
  labels: {
    empty: string;
    up: string;
    down: string;
    unpin: string;
    errors: Record<string, string>;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/communities/${communityId}/mod`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, ...body }),
    });
    setBusy(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(labels.errors[data.error ?? ''] ?? labels.errors.failed ?? '');
      return;
    }
    router.refresh();
  }

  const action =
    'ios-pressable inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  if (items.length === 0) {
    return <p className="px-1 text-sm text-muted-foreground">{labels.empty}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <ol className="ios-card flex flex-col rounded-2xl p-2">
        {items.map((p, i) => (
          <li key={p.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5">
            <span className="w-5 text-center text-xs font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <Link
              href={p.href}
              className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
            >
              {p.title}
            </Link>
            <button
              type="button"
              disabled={busy || i === 0}
              aria-label={labels.up}
              className={action}
              onClick={() => send({ action: 'pinMove', postId: p.id, direction: 'up' })}
            >
              ▲
            </button>
            <button
              type="button"
              disabled={busy || i === items.length - 1}
              aria-label={labels.down}
              className={action}
              onClick={() => send({ action: 'pinMove', postId: p.id, direction: 'down' })}
            >
              ▼
            </button>
            <button
              type="button"
              disabled={busy}
              className={action}
              onClick={() => send({ action: 'pin', postId: p.id, on: false })}
            >
              {labels.unpin}
            </button>
          </li>
        ))}
      </ol>
      {error ? (
        <p role="status" className="px-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
