import Link from 'next/link';
import type { FlairView } from '@campusos/module-communities/flairs';
import type { PostView } from '@campusos/module-communities/posts';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { postPath, type ReportReason } from '@/lib/community-constants';
import { relativeTime } from '@/lib/format';
import type { MessageKey, Translate } from '@/lib/i18n';
import { PostActions } from './post-actions';
import { VoteColumn } from './vote-column';

/**
 * A post, as a card in a list or the top of its own page: the vote column,
 * who and when, the title, the text or the link, and the actions. An
 * anonymous post shows "Anonymous" and nothing that could narrow the author.
 */
export function PostCard({
  post,
  community,
  base,
  tenant,
  locale,
  signedIn,
  canVote,
  full = false,
  flairs = [],
  t,
}: {
  post: PostView;
  community: { slug: string; name: string };
  base: string;
  tenant: string;
  locale: string;
  signedIn: boolean;
  canVote: boolean;
  /** The post's own page: the whole body, and delete returns to the community. */
  full?: boolean;
  /** The community's flairs, to name the one this post wears. */
  flairs?: FlairView[];
  t: Translate;
}) {
  const permalink = postPath(base, community.slug, post.id, post.title);
  const flair = post.flairId ? flairs.find((f) => f.id === post.flairId) : undefined;
  const when = relativeTime(post.createdAt.toISOString(), locale);
  const errors = {
    not_verified: t('communities.error.not_verified'),
    not_allowed: t('communities.error.not_allowed'),
    banned: t('communities.error.banned'),
    rate_limited: t('communities.error.rate_limited'),
    locked: t('posts.error.locked'),
    exists: t('posts.error.exists'),
    failed: t('communities.error.failed'),
  };
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

  return (
    <article className="ios-card flex gap-2 rounded-2xl p-3 sm:p-4">
      <VoteColumn
        tenant={tenant}
        postId={post.id}
        score={post.score}
        myVote={post.myVote}
        canVote={canVote}
        labels={{ up: t('posts.upvote'), down: t('posts.downvote'), errors }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {!full ? (
            <Link
              href={`${base}/c/${community.slug}`}
              className="font-medium text-foreground hover:underline"
            >
              {community.name}
            </Link>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            {post.author ? (
              <>
                <IdentityAvatar
                  seed={post.author.avatarSeed}
                  label={post.author.handle}
                  size={18}
                />
                <span>{post.author.handle}</span>
              </>
            ) : (
              <span>{t('posts.anonymous')}</span>
            )}
          </span>
          <time dateTime={post.createdAt.toISOString()}>{when}</time>
          {post.editedAt ? (
            <Link href={`${permalink.replace(/\/[^/]*$/, '')}/history`} className="hover:underline">
              {t('posts.edited')}
            </Link>
          ) : null}
          {flair ? (
            <Link
              href={`${base}/c/${community.slug}?flair=${flair.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium hover:underline"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: flair.color }}
              />
              {flair.name}
            </Link>
          ) : null}
          {post.crosspostOf ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
              {t('posts.crosspostPill')}
            </span>
          ) : null}
          {post.kind === 'poll' ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
              {t('posts.pollPill')}
            </span>
          ) : null}
          {post.pinnedAt ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {t('posts.pinned')}
            </span>
          ) : null}
          {post.lockedAt ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
              {t('posts.locked')}
            </span>
          ) : null}
          {post.removedAt ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
              {t('posts.removed')}
            </span>
          ) : null}
          {post.spoiler ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
              {t('posts.spoiler')}
            </span>
          ) : null}
        </p>

        {full ? (
          <h1 className="text-xl font-bold tracking-tight">{post.title}</h1>
        ) : (
          <h3 className="text-base font-semibold leading-snug">
            <Link href={permalink} className="hover:underline">
              {post.title}
            </Link>
          </h3>
        )}

        {post.crosspost ? (
          <p className="text-sm text-muted-foreground">
            <Link
              href={postPath(
                base,
                post.crosspost.communitySlug,
                post.crosspost.postId,
                post.crosspost.title,
              )}
              className="font-medium text-foreground hover:underline"
            >
              {t('posts.crosspostedFrom', { community: post.crosspost.communityName })}
            </Link>
          </p>
        ) : null}
        {post.kind === 'link' && post.url ? (
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex max-w-full items-center gap-1.5 truncate text-sm font-medium text-primary hover:underline"
          >
            {post.urlDomain ?? post.url}
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="size-3.5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 3h7v7M13 3 7 9M11 9v4H3V5h4" />
            </svg>
          </a>
        ) : null}

        {post.body ? (
          post.spoiler && !full ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {t('posts.showSpoiler')}
              </summary>
              <p className="mt-1 whitespace-pre-wrap">{post.body}</p>
            </details>
          ) : (
            <p
              className={`whitespace-pre-wrap text-sm ${full ? '' : 'line-clamp-3 text-muted-foreground'}`}
            >
              {post.body}
            </p>
          )
        ) : null}

        <PostActions
          tenant={tenant}
          postId={post.id}
          permalink={permalink}
          editHref={`${permalink.replace(/\/[^/]*$/, '')}/edit`}
          saved={post.saved}
          isOwn={post.isOwn}
          authorId={post.publicAuthorId}
          signedIn={signedIn}
          afterDelete={full ? `${base}/c/${community.slug}` : undefined}
          labels={{
            comments: t('posts.comments', { count: post.commentCount }),
            share: t('posts.share'),
            shared: t('posts.shared'),
            save: t('posts.save'),
            unsave: t('posts.unsave'),
            hide: t('posts.hide'),
            unhide: t('posts.unhide'),
            hidden: t('posts.hidden'),
            report: t('posts.report'),
            reported: t('posts.reported'),
            reportHeading: t('posts.report.heading'),
            reasons,
            reportNote: t('posts.report.note'),
            reportSend: t('posts.report.send'),
            reportCancel: t('posts.report.cancel'),
            edit: t('posts.edit'),
            delete: t('posts.delete'),
            deleteConfirm: t('posts.deleteConfirm'),
            deleted: t('posts.deleted'),
            block: t('posts.block', { handle: post.author?.handle ?? '' }),
            blocked: t('posts.blocked'),
            errors,
          }}
        />
      </div>
    </article>
  );
}
