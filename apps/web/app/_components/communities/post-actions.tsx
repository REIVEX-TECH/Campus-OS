'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { REPORT_REASONS, type ReportReason } from '@/lib/community-constants';

export type PostActionLabels = {
  comments: string;
  share: string;
  shared: string;
  save: string;
  unsave: string;
  hide: string;
  unhide: string;
  hidden: string;
  report: string;
  reported: string;
  reportHeading: string;
  reasons: Record<ReportReason, string>;
  reportNote: string;
  reportSend: string;
  reportCancel: string;
  edit: string;
  delete: string;
  deleteConfirm: string;
  deleted: string;
  errors: Record<string, string>;
};

const action =
  'ios-pressable inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The row under a post: comments, copy link, save, hide, report, and for the
 * author, edit and delete. Each is one POST; the page refreshes afterwards
 * rather than being edited here, except the copied link and the report panel,
 * which are local.
 */
export function PostActions({
  tenant,
  postId,
  permalink,
  editHref,
  saved,
  isOwn,
  signedIn,
  afterDelete,
  labels,
}: {
  tenant: string;
  postId: string;
  permalink: string;
  editHref: string;
  saved: boolean;
  isOwn: boolean;
  signedIn: boolean;
  /** Where to go once the post is deleted, when this row is on the post's own page. */
  afterDelete?: string;
  labels: PostActionLabels;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReportReason>('harassment');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/communities/posts/${postId}`, {
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
      return false;
    }
    setMessage({ text: done, error: false });
    return true;
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(new URL(permalink, window.location.origin).toString());
      setMessage({ text: labels.shared, error: false });
    } catch {
      setMessage({ text: labels.errors.failed ?? '', error: true });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Link href={`${permalink}#comments`} className={action}>
          {labels.comments}
        </Link>
        <button type="button" onClick={copyLink} className={action}>
          {labels.share}
        </button>
        {signedIn ? (
          <>
            <button
              type="button"
              disabled={busy}
              aria-pressed={saved}
              onClick={async () => {
                if (
                  await post({ action: 'save', on: !saved }, saved ? labels.save : labels.unsave)
                ) {
                  router.refresh();
                }
              }}
              className={action}
            >
              {saved ? labels.unsave : labels.save}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await post({ action: 'hide', on: true }, labels.hidden)) router.refresh();
              }}
              className={action}
            >
              {labels.hide}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-expanded={reporting}
              onClick={() => setReporting((r) => !r)}
              className={action}
            >
              {labels.report}
            </button>
            {isOwn ? (
              <>
                <Link href={editHref} className={action}>
                  {labels.edit}
                </Link>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm(labels.deleteConfirm)) return;
                    if (await post({ action: 'delete' }, labels.deleted)) {
                      if (afterDelete) router.push(afterDelete);
                      else router.refresh();
                    }
                  }}
                  className={`${action} hover:text-destructive`}
                >
                  {labels.delete}
                </button>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      {reporting ? (
        <form
          className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await post(
                { action: 'report', reason, note: note.trim() || undefined },
                labels.reported,
              )
            ) {
              setReporting(false);
              setNote('');
            }
          }}
        >
          <p className="text-sm font-medium">{labels.reportHeading}</p>
          <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            {REPORT_REASONS.map((r) => (
              <label
                key={r}
                className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-background"
              >
                <input
                  type="radio"
                  name={`reason-${postId}`}
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="size-4 accent-primary"
                />
                {labels.reasons[r]}
              </label>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={labels.reportNote}
            aria-label={labels.reportNote}
            maxLength={500}
            className="ios-field h-10 w-full rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={buttonVariants({ size: 'sm' })}>
              {labels.reportSend}
            </button>
            <button
              type="button"
              onClick={() => setReporting(false)}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              {labels.reportCancel}
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
