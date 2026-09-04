'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

export type ModControlLabels = {
  remove: string;
  removeReason: string;
  removed: string;
  restore: string;
  restored: string;
  approve: string;
  approved: string;
  lock: string;
  unlock: string;
  locked: string;
  unlocked: string;
  pin: string;
  unpin: string;
  pinned: string;
  unpinned: string;
  confirm: string;
  cancel: string;
  errors: Record<string, string>;
};

const action =
  'ios-pressable inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * A moderator's row under a post: remove (with a reason), restore or approve,
 * lock, pin. One POST each; the page refreshes from the server afterwards.
 */
export function ModControls({
  tenant,
  communityId,
  postId,
  removed,
  locked,
  pinned,
  labels,
}: {
  tenant: string;
  communityId: string;
  postId: string;
  removed: boolean;
  locked: boolean;
  pinned: boolean;
  labels: ModControlLabels;
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function send(body: Record<string, unknown>, done: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/communities/${communityId}/mod`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, ...body }),
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
    setMessage({ text: done, error: false });
    setRemoving(false);
    setReason('');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/40 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {removed ? (
          <button
            type="button"
            disabled={busy}
            className={action}
            onClick={() =>
              send({ action: 'approve', itemType: 'post', itemId: postId }, labels.restored)
            }
          >
            {labels.restore}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              className={action}
              onClick={() =>
                send({ action: 'approve', itemType: 'post', itemId: postId }, labels.approved)
              }
            >
              {labels.approve}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-expanded={removing}
              className={`${action} hover:text-destructive`}
              onClick={() => setRemoving((r) => !r)}
            >
              {labels.remove}
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          aria-pressed={locked}
          className={action}
          onClick={() =>
            send({ action: 'lock', postId, on: !locked }, locked ? labels.unlocked : labels.locked)
          }
        >
          {locked ? labels.unlock : labels.lock}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={pinned}
          className={action}
          onClick={() =>
            send({ action: 'pin', postId, on: !pinned }, pinned ? labels.unpinned : labels.pinned)
          }
        >
          {pinned ? labels.unpin : labels.pin}
        </button>
      </div>
      {removing ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void send(
              { action: 'remove', itemType: 'post', itemId: postId, reason: reason.trim() },
              labels.removed,
            );
          }}
        >
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={labels.removeReason}
            aria-label={labels.removeReason}
            required
            minLength={3}
            maxLength={300}
            className="ios-field h-9 flex-1 rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className={buttonVariants({ size: 'sm', variant: 'destructive' })}
            >
              {labels.confirm}
            </button>
            <button
              type="button"
              onClick={() => setRemoving(false)}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              {labels.cancel}
            </button>
          </div>
        </form>
      ) : null}
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
