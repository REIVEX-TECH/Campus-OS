'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/** One POST: everything unread becomes read, and the page and the bell refresh. */
export function MarkReadButton({
  tenant,
  labels,
}: {
  tenant: string;
  labels: { markAll: string; marked: string; errors: Record<string, string> };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={busy}
        className={buttonVariants({ size: 'sm', variant: 'outline' })}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          const response = await fetch('/api/communities/notifications', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tenant, action: 'read', ids: 'all' }),
          });
          setBusy(false);
          if (!response.ok) {
            setMessage({ text: labels.errors.failed ?? '', error: true });
            return;
          }
          setMessage({ text: labels.marked, error: false });
          router.refresh();
        }}
      >
        {labels.markAll}
      </button>
      {message ? (
        <p
          role="status"
          className={message.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
