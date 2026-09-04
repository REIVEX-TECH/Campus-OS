'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/** Bring a hidden post back into the feeds. One POST, then the list refreshes. */
export function UnhideButton({
  tenant,
  postId,
  labels,
}: {
  tenant: string;
  postId: string;
  labels: { unhide: string; errors: Record<string, string> };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={buttonVariants({ size: 'sm', variant: 'outline' })}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const response = await fetch(`/api/communities/posts/${postId}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tenant, action: 'hide', on: false }),
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
        {labels.unhide}
      </button>
      {error ? (
        <span role="status" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
