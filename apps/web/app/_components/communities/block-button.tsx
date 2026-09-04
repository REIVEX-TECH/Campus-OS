'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Block or unblock one person. Tells the blocker what changed; tells the other person nothing. */
export function BlockButton({
  tenant,
  userId,
  blocked,
  labels,
  className,
}: {
  tenant: string;
  userId: string;
  blocked: boolean;
  labels: { block: string; unblock: string; done: string; errors: Record<string, string> };
  className: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        aria-pressed={blocked}
        className={className}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          const response = await fetch('/api/communities/blocks', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tenant, userId, on: !blocked }),
          });
          setBusy(false);
          if (!response.ok) {
            const data = (await response.json().catch(() => ({}))) as { error?: string };
            setMessage({
              text: labels.errors[data.error ?? ''] ?? labels.errors.failed ?? '',
              error: true,
            });
            return;
          }
          if (!blocked) setMessage({ text: labels.done, error: false });
          router.refresh();
        }}
      >
        {blocked ? labels.unblock : labels.block}
      </button>
      {message ? (
        <span
          role="status"
          className={message.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
        >
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
