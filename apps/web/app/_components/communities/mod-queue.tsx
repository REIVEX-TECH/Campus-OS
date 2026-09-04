'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

export type QueueEntry = {
  itemType: 'post' | 'comment';
  itemId: string;
  communityId: string;
  communityName: string;
  href: string;
  title: string;
  excerpt: string;
  isAnonymous: boolean;
  removed: boolean;
  reportCount: number;
  /** Already translated. */
  reasons: string[];
  reportIds: string[];
  /** Already formatted for the locale. */
  when: string;
};

export type QueueLabels = {
  empty: string;
  post: string;
  comment: string;
  /** "{count}" is replaced. */
  reports: string;
  reportsOne: string;
  anonymousAuthor: string;
  alreadyRemoved: string;
  open: string;
  approve: string;
  approved: string;
  remove: string;
  removeReason: string;
  removed: string;
  confirm: string;
  cancel: string;
  unmask: string;
  unmaskConfirm: string;
  /** "{handle}" is replaced. */
  unmasked: string;
  errors: Record<string, string>;
};

const action =
  'ios-pressable inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Open reports, grouped by the item they name. Approve clears them; remove
 * takes the item down with a reason. Revealing an anonymous author is offered
 * only when the page says the viewer holds that permission, only from a
 * report, and the server records who asked; the handle is shown here once and
 * is not written anywhere on the page.
 */
export function ModQueue({
  tenant,
  items,
  canUnmask,
  labels,
}: {
  tenant: string;
  items: QueueEntry[];
  canUnmask: boolean;
  labels: QueueLabels;
}) {
  if (items.length === 0) {
    return <p className="px-1 text-sm text-muted-foreground">{labels.empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <QueueRow
          key={`${item.itemType}:${item.itemId}`}
          tenant={tenant}
          item={item}
          canUnmask={canUnmask}
          labels={labels}
        />
      ))}
    </ul>
  );
}

function QueueRow({
  tenant,
  item,
  canUnmask,
  labels,
}: {
  tenant: string;
  item: QueueEntry;
  canUnmask: boolean;
  labels: QueueLabels;
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function send(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/communities/${item.communityId}/mod`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, ...body }),
    });
    setBusy(false);
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : '';
      setMessage({ text: labels.errors[code] ?? labels.errors.failed ?? '', error: true });
      return null;
    }
    return data;
  }

  const kind = item.itemType === 'post' ? labels.post : labels.comment;
  return (
    <li className="ios-card flex flex-col gap-2 rounded-2xl p-3 sm:p-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{item.communityName}</span>
        <span>{kind}</span>
        {item.reportCount > 0 ? (
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
            {item.reportCount === 1
              ? labels.reportsOne
              : labels.reports.replace('{count}', String(item.reportCount))}
          </span>
        ) : null}
        {item.isAnonymous ? <span>{labels.anonymousAuthor}</span> : null}
        {item.removed && labels.alreadyRemoved ? <span>{labels.alreadyRemoved}</span> : null}
        <span>{item.when}</span>
      </p>
      {item.title ? <p className="text-sm font-semibold leading-snug">{item.title}</p> : null}
      {item.excerpt ? (
        <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
          {item.excerpt}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{item.reasons.join(' · ')}</p>
      <div className="flex flex-wrap items-center gap-1">
        <Link href={item.href} className={action}>
          {labels.open}
        </Link>
        <button
          type="button"
          disabled={busy}
          className={action}
          onClick={async () => {
            if (await send({ action: 'approve', itemType: item.itemType, itemId: item.itemId })) {
              setMessage({ text: labels.approved, error: false });
              router.refresh();
            }
          }}
        >
          {labels.approve}
        </button>
        {!item.removed ? (
          <button
            type="button"
            disabled={busy}
            aria-expanded={removing}
            className={`${action} hover:text-destructive`}
            onClick={() => setRemoving((r) => !r)}
          >
            {labels.remove}
          </button>
        ) : null}
        {canUnmask && item.isAnonymous && item.reportIds[0] ? (
          <button
            type="button"
            disabled={busy}
            className={action}
            onClick={async () => {
              if (!window.confirm(labels.unmaskConfirm)) return;
              const data = await send({
                action: 'unmask',
                itemType: item.itemType,
                itemId: item.itemId,
                reportId: item.reportIds[0],
              });
              if (data && typeof data.handle === 'string') {
                setMessage({
                  text: labels.unmasked.replace('{handle}', data.handle),
                  error: false,
                });
              }
            }}
          >
            {labels.unmask}
          </button>
        ) : null}
      </div>
      {removing ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await send({
                action: 'remove',
                itemType: item.itemType,
                itemId: item.itemId,
                reason: reason.trim(),
              })
            ) {
              setRemoving(false);
              setMessage({ text: labels.removed, error: false });
              router.refresh();
            }
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
    </li>
  );
}
