import type { ReactNode } from 'react';
import Link from 'next/link';
import type { CommentSort, CommentView } from '@campusos/module-communities/comments';
import type { ReportReason } from '@/lib/community-constants';
import { relativeTime } from '@/lib/format';
import type { MessageKey, Translate } from '@/lib/i18n';
import { CommentComposer } from './comment-composer';
import { CommentNode, type CommentLabels } from './comment-node';
import { VerifyGateInline } from '@/app/_components/get-verified';

const SORTS: CommentSort[] = ['best', 'top', 'new', 'old', 'controversial'];

/**
 * The comments under a post: the composer, the sort tabs, and the tree. The
 * module returns the tree in order with each comment's depth; this nests the
 * elements so a collapse hides a whole subtree. OP is the post's public author;
 * Mod is a current moderator; neither is ever shown on an anonymous comment.
 */
export function CommentThread({
  tenant,
  postId,
  communityId,
  canModerate,
  base,
  postAuthorId,
  moderatorIds,
  karma,
  comments,
  sort,
  sortHref,
  locale,
  signedIn,
  canComment,
  canVote,
  anonymousAllowed,
  depthCap,
  hint,
  t,
}: {
  tenant: string;
  postId: string;
  communityId: string;
  canModerate: boolean;
  /** The tenant base, for links to profiles. */
  base: string;
  postAuthorId: string | null;
  moderatorIds: ReadonlySet<string>;
  /** Public karma by author id, when the tenant shows it. Null when it does not. */
  karma: ReadonlyMap<string, number> | null;
  comments: CommentView[];
  sort: CommentSort;
  /** The page's path without the sort, for the tabs. */
  sortHref: string;
  locale: string;
  signedIn: boolean;
  canComment: boolean;
  canVote: boolean;
  anonymousAllowed: boolean;
  depthCap: number;
  /** Why the composer is absent, when it is. */
  hint: string | null;
  t: Translate;
}) {
  const reasons = Object.fromEntries(
    (
      [
        'harassment',
        'hate',
        'adult',
        'personal_information',
        'threats',
        'spam',
        'misinformation',
        'community_rule',
        'other',
      ] as const
    ).map((r) => [r, t(`posts.report.reason.${r}` as MessageKey)]),
  ) as Record<ReportReason, string>;
  const errors = {
    not_verified: t('communities.error.not_verified'),
    not_allowed: t('communities.error.not_allowed'),
    banned: t('communities.error.banned'),
    rate_limited: t('communities.error.rate_limited'),
    locked: t('posts.error.locked'),
    depth: t('posts.error.depth'),
    failed: t('communities.error.failed'),
  };
  const composerLabels = {
    placeholder: t('comments.write'),
    send: t('comments.send'),
    cancel: t('comments.cancel'),
    anonymous: t('comments.anonymous'),
    anonymousHint: t('comments.anonymousHint'),
    working: t('comments.working'),
    errors,
  };
  const labels: CommentLabels = {
    anonymous: t('posts.anonymous'),
    op: t('comments.op'),
    mod: t('comments.mod'),
    karma: t('profile.karma'),
    deleted: t('comments.deleted'),
    removed: t('comments.removed'),
    blocked: t('comments.blocked'),
    remove: t('comments.remove'),
    removeReason: t('comments.removeReason'),
    edited: t('posts.edited'),
    collapse: t('comments.collapse'),
    expand: t('comments.expand', { count: '{count}' }),
    reply: t('comments.reply'),
    edit: t('comments.edit'),
    save: t('comments.save'),
    unsave: t('comments.unsave'),
    report: t('comments.report'),
    delete: t('comments.delete'),
    deleteConfirm: t('comments.deleteConfirm'),
    saveEdit: t('comments.saveEdit'),
    cancel: t('comments.cancel'),
    upvote: t('posts.upvote'),
    downvote: t('posts.downvote'),
    reportHeading: t('comments.report.heading'),
    reasons,
    reportNote: t('posts.report.note'),
    reportSend: t('posts.report.send'),
    saved: t('comments.saved'),
    reported: t('comments.reported'),
    maxDepth: t('comments.maxDepth'),
    composer: composerLabels,
    errors,
  };

  // Children by parent, in the module's order (siblings already sorted).
  const byParent = new Map<string | null, CommentView[]>();
  for (const c of comments) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  const countReplies = (id: string): number =>
    (byParent.get(id) ?? []).reduce((n, child) => n + 1 + countReplies(child.id), 0);

  const render = (c: CommentView): ReactNode => {
    const children = byParent.get(c.id) ?? [];
    const notAnonymous = !c.isAnonymous && c.publicAuthorId !== null;
    return (
      <CommentNode
        key={c.id}
        tenant={tenant}
        postId={postId}
        communityId={communityId}
        canModerate={canModerate}
        comment={{
          id: c.id,
          body: c.body,
          author: c.author,
          authorHref: c.author ? `${base}/people/${c.author.handle}` : null,
          // Anonymous comments carry no number, which is why the map is keyed
          // on the public author id: there is nothing to look them up by.
          karma: karma && c.publicAuthorId ? (karma.get(c.publicAuthorId) ?? 0) : null,
          isAnonymous: c.isAnonymous,
          isOwn: c.isOwn,
          myVote: c.myVote,
          saved: c.saved,
          score: c.score,
          when: relativeTime(c.createdAt.toISOString(), locale),
          edited: c.editedAt !== null,
          deleted: c.deletedAt !== null,
          removed: c.removedAt !== null,
          blocked: c.blocked,
          depth: c.depth,
          replyCount: countReplies(c.id),
        }}
        op={notAnonymous && postAuthorId !== null && c.publicAuthorId === postAuthorId}
        mod={notAnonymous && c.publicAuthorId !== null && moderatorIds.has(c.publicAuthorId)}
        canComment={canComment}
        canVote={canVote}
        canReply={c.depth + 1 <= depthCap}
        anonymousAllowed={anonymousAllowed}
        labels={labels}
      >
        {children.length > 0 ? children.map(render) : null}
      </CommentNode>
    );
  };

  const roots = byParent.get(null) ?? [];

  return (
    <section id="comments" aria-labelledby="post-comments" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2
          id="post-comments"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t('comments.heading', { count: comments.length })}
        </h2>
        <nav aria-label={t('comments.sortLabel')} className="flex gap-1">
          {SORTS.map((s) => (
            <Link
              key={s}
              href={s === 'best' ? sortHref : `${sortHref}?sort=${s}`}
              aria-current={s === sort ? 'page' : undefined}
              className={`ios-pressable rounded-lg px-2.5 py-1 text-xs font-medium ${
                s === sort
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`comments.sort.${s}` as MessageKey)}
            </Link>
          ))}
        </nav>
      </div>

      {canComment ? (
        <div className="ios-card rounded-2xl p-3">
          <CommentComposer
            tenant={tenant}
            postId={postId}
            parentId={null}
            anonymousAllowed={anonymousAllowed}
            labels={composerLabels}
          />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2 px-1">
          {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
          <VerifyGateInline />
        </div>
      )}

      {roots.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{t('comments.none')}</p>
      ) : (
        <div className="ios-card flex flex-col gap-4 rounded-2xl p-3 sm:p-4">
          {roots.map(render)}
        </div>
      )}
      {signedIn ? null : null}
    </section>
  );
}
