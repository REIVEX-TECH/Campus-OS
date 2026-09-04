'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

export type ComposerLabels = {
  placeholder: string;
  send: string;
  cancel: string;
  anonymous: string;
  anonymousHint: string;
  working: string;
  errors: Record<string, string>;
};

/**
 * Write a comment, at the top of a thread or in reply to one. One POST; the
 * thread refreshes from the server. The anonymous option says what it does.
 */
export function CommentComposer({
  tenant,
  postId,
  parentId,
  anonymousAllowed,
  autoFocus = false,
  onDone,
  labels,
}: {
  tenant: string;
  postId: string;
  parentId: string | null;
  anonymousAllowed: boolean;
  autoFocus?: boolean;
  /** Called after a successful send, or on cancel; a reply box closes itself. */
  onDone?: () => void;
  labels: ComposerLabels;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [isAnonymous, setAnonymous] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setWorking(true);
    setError(null);
    const response = await fetch(`/api/communities/posts/${postId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, parentId, body, isAnonymous }),
    });
    setWorking(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(labels.errors[data.error ?? ''] ?? labels.errors.failed ?? null);
      return;
    }
    setBody('');
    setAnonymous(false);
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={labels.placeholder}
        aria-label={labels.placeholder}
        required
        maxLength={10_000}
        autoFocus={autoFocus}
        className="ios-field min-h-20 w-full rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={working}
          aria-busy={working || undefined}
          className={buttonVariants({ size: 'sm' })}
        >
          {working ? labels.working : labels.send}
        </button>
        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            className={buttonVariants({ size: 'sm', variant: 'ghost' })}
          >
            {labels.cancel}
          </button>
        ) : null}
        {anonymousAllowed ? (
          <label
            className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground"
            title={labels.anonymousHint}
          >
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={isAnonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />
            {labels.anonymous}
          </label>
        ) : null}
        {error ? (
          <p role="status" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
