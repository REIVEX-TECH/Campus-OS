'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { REPORT_REASONS, type ReportReason } from '@/lib/community-constants';
import { CommentComposer, type ComposerLabels } from './comment-composer';

export type CommentData = {
  id: string;
  body: string;
  author: { handle: string; avatarSeed: string } | null;
  authorHref: string | null;
  /** The author's public karma, when the tenant shows it. Null when it does not, or anonymous. */
  karma: number | null;
  isAnonymous: boolean;
  isOwn: boolean;
  myVote: -1 | 0 | 1;
  saved: boolean;
  score: number;
  /** Already formatted for the locale. */
  when: string;
  edited: boolean;
  deleted: boolean;
  removed: boolean;
  blocked: boolean;
  depth: number;
  replyCount: number;
};

export type CommentLabels = {
  anonymous: string;
  op: string;
  mod: string;
  deleted: string;
  removed: string;
  blocked: string;
  remove: string;
  removeReason: string;
  edited: string;
  collapse: string;
  /** "{count}" is replaced. */
  expand: string;
  /** "{count}" is replaced. */
  karma: string;
  reply: string;
  edit: string;
  save: string;
  unsave: string;
  report: string;
  delete: string;
  deleteConfirm: string;
  saveEdit: string;
  cancel: string;
  upvote: string;
  downvote: string;
  reportHeading: string;
  reasons: Record<ReportReason, string>;
  reportNote: string;
  reportSend: string;
  saved: string;
  reported: string;
  maxDepth: string;
  composer: ComposerLabels;
  errors: Record<string, string>;
};

const action =
  'ios-pressable inline-flex h-7 items-center rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * One comment and, nested under it, its replies. Collapsing hides the replies
 * and the text behind one line; every action is one POST and the thread
 * refreshes from the server, except the optimistic vote. An anonymous comment
 * shows "Anonymous" and never an OP or Mod badge, because either would narrow
 * the author.
 */
export function CommentNode({
  tenant,
  postId,
  communityId,
  canModerate,
  comment,
  op,
  mod,
  canComment,
  canVote,
  canReply,
  anonymousAllowed,
  labels,
  children,
}: {
  tenant: string;
  postId: string;
  communityId: string;
  canModerate: boolean;
  comment: CommentData;
  op: boolean;
  mod: boolean;
  canComment: boolean;
  canVote: boolean;
  canReply: boolean;
  anonymousAllowed: boolean;
  labels: CommentLabels;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [reporting, setReporting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeReason, setRemoveReason] = useState('');
  const [reason, setReason] = useState<ReportReason>('harassment');
  const [note, setNote] = useState('');
  const [vote, setVote] = useState({ score: comment.score, myVote: comment.myVote });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/communities/comments/${comment.id}`, {
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
    return true;
  }

  async function castVote(next: -1 | 1): Promise<void> {
    if (!canVote || busy) return;
    const value = vote.myVote === next ? 0 : next;
    const before = vote;
    setVote({ score: vote.score - vote.myVote + value, myVote: value });
    if (!(await post({ action: 'vote', value }))) setVote(before);
  }

  const gone = comment.deleted || comment.removed || comment.blocked;
  const name = comment.author?.handle ?? labels.anonymous;

  return (
    <div id={`comment-${comment.id}`} className="flex gap-2">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-label={
          collapsed ? labels.expand.replace('{count}', String(comment.replyCount)) : labels.collapse
        }
        className="ios-pressable group flex w-4 shrink-0 justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className="mt-8 h-[calc(100%-2rem)] w-0.5 rounded bg-muted group-hover:bg-primary/60"
          aria-hidden="true"
        />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {comment.author ? (
            <IdentityAvatar seed={comment.author.avatarSeed} label={name} size={18} />
          ) : null}
          <span className={gone ? '' : 'font-medium text-foreground'}>
            {comment.blocked ? (
              labels.blocked
            ) : gone ? (
              labels.deleted
            ) : comment.authorHref ? (
              <Link href={comment.authorHref} className="hover:underline">
                {name}
              </Link>
            ) : (
              name
            )}
          </span>
          {!gone && op ? (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {labels.op}
            </span>
          ) : null}
          {!gone && mod ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
              {labels.mod}
            </span>
          ) : null}
          {!gone && comment.karma !== null ? (
            <span>{labels.karma.replace('{count}', String(comment.karma))}</span>
          ) : null}
          <span>{comment.when}</span>
          {comment.edited && !gone ? <span>{labels.edited}</span> : null}
          {collapsed && comment.replyCount > 0 ? (
            <span>{labels.expand.replace('{count}', String(comment.replyCount))}</span>
          ) : null}
        </p>

        {collapsed ? null : (
          <>
            {gone ? (
              <p className="text-sm italic text-muted-foreground">
                {comment.blocked
                  ? labels.blocked
                  : comment.removed
                    ? labels.removed
                    : labels.deleted}
              </p>
            ) : editing ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await post({ action: 'edit', body: draft })) {
                    setEditing(false);
                    router.refresh();
                  }
                }}
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  required
                  maxLength={10_000}
                  className="ios-field min-h-20 w-full rounded-xl px-3.5 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className={buttonVariants({ size: 'sm' })}>
                    {labels.saveEdit}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                  >
                    {labels.cancel}
                  </button>
                </div>
              </form>
            ) : (
              <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
            )}

            {!gone ? (
              <div className="flex flex-wrap items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => castVote(1)}
                  aria-label={labels.upvote}
                  aria-pressed={vote.myVote === 1}
                  disabled={!canVote}
                  className={`${action} ${vote.myVote === 1 ? 'text-primary' : ''}`}
                >
                  ▲
                </button>
                <span className="min-w-5 text-center text-xs font-semibold tabular-nums">
                  {vote.score}
                </span>
                <button
                  type="button"
                  onClick={() => castVote(-1)}
                  aria-label={labels.downvote}
                  aria-pressed={vote.myVote === -1}
                  disabled={!canVote}
                  className={`${action} ${vote.myVote === -1 ? 'text-primary' : ''}`}
                >
                  ▼
                </button>
                {canComment ? (
                  canReply ? (
                    <button type="button" onClick={() => setReplying((r) => !r)} className={action}>
                      {labels.reply}
                    </button>
                  ) : (
                    <span className="px-1.5 text-xs text-muted-foreground" title={labels.maxDepth}>
                      {labels.reply}
                    </span>
                  )
                ) : null}
                {canComment ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      aria-pressed={comment.saved}
                      onClick={async () => {
                        if (await post({ action: 'save', on: !comment.saved })) {
                          setMessage({ text: labels.saved, error: false });
                          router.refresh();
                        }
                      }}
                      className={action}
                    >
                      {comment.saved ? labels.unsave : labels.save}
                    </button>
                    <button
                      type="button"
                      aria-expanded={reporting}
                      onClick={() => setReporting((r) => !r)}
                      className={action}
                    >
                      {labels.report}
                    </button>
                  </>
                ) : null}
                {canModerate && !gone ? (
                  <button
                    type="button"
                    disabled={busy}
                    className={`${action} hover:text-destructive`}
                    aria-expanded={removing}
                    onClick={() => setRemoving((r) => !r)}
                  >
                    {labels.remove}
                  </button>
                ) : null}
                {comment.isOwn ? (
                  <>
                    <button type="button" onClick={() => setEditing(true)} className={action}>
                      {labels.edit}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (!window.confirm(labels.deleteConfirm)) return;
                        if (await post({ action: 'delete' })) router.refresh();
                      }}
                      className={`${action} hover:text-destructive`}
                    >
                      {labels.delete}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            {reporting ? (
              <form
                className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await post({ action: 'report', reason, note: note.trim() || undefined })) {
                    setReporting(false);
                    setNote('');
                    setMessage({ text: labels.reported, error: false });
                  }
                }}
              >
                <p className="text-sm font-medium">{labels.reportHeading}</p>
                <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                  {REPORT_REASONS.map((r) => (
                    <label
                      key={r}
                      className="flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-background"
                    >
                      <input
                        type="radio"
                        name={`reason-${comment.id}`}
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
                  className="ios-field h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className={buttonVariants({ size: 'sm' })}>
                    {labels.reportSend}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReporting(false)}
                    className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                  >
                    {labels.cancel}
                  </button>
                </div>
              </form>
            ) : null}

            {removing ? (
              <form
                className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3 sm:flex-row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  const response = await fetch(`/api/communities/${communityId}/mod`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      tenant,
                      action: 'remove',
                      itemType: 'comment',
                      itemId: comment.id,
                      reason: removeReason.trim(),
                    }),
                  });
                  setBusy(false);
                  if (response.ok) {
                    setRemoving(false);
                    router.refresh();
                  } else {
                    setMessage({ text: labels.errors.failed ?? '', error: true });
                  }
                }}
              >
                <input
                  value={removeReason}
                  onChange={(e) => setRemoveReason(e.target.value)}
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
                    {labels.remove}
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
                className={
                  message.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
                }
              >
                {message.text}
              </p>
            ) : null}

            {replying ? (
              <div className="pt-1">
                <CommentComposer
                  tenant={tenant}
                  postId={postId}
                  parentId={comment.id}
                  anonymousAllowed={anonymousAllowed}
                  autoFocus
                  onDone={() => setReplying(false)}
                  labels={labels.composer}
                />
              </div>
            ) : null}

            {children ? <div className="flex flex-col gap-3 pt-2">{children}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}
