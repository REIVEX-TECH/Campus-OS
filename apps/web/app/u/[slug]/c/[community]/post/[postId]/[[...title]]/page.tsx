import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { commentsForPost, type CommentSort } from '@campusos/module-communities/comments';
import { communityBySlug, permissionsIn } from '@campusos/module-communities/communities';
import { listModerators } from '@campusos/module-communities/members';
import { pollFor } from '@campusos/module-communities/polls';
import { postById } from '@campusos/module-communities/posts';
import { listRules } from '@campusos/module-communities/rules';
import { CommentThread } from '@/app/_components/communities/comment-thread';
import { CommunityRail } from '@/app/_components/communities/community-rail';
import { ModControls } from '@/app/_components/communities/mod-controls';
import { PollCard } from '@/app/_components/communities/poll-card';
import { PostCard } from '@/app/_components/communities/post-card';
import { EmptyState } from '@/app/_components/empty-state';
import { postPath } from '@/lib/community-constants';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
import { communityErrors, removalLabel } from '@/lib/community-labels';
import { relativeTime } from '@/lib/format';
import { postErrors } from '@/lib/post-labels';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; community: string; postId: string }> };
type PageProps = Params & { searchParams: Promise<{ sort?: string }> };
const SORTS: CommentSort[] = ['best', 'top', 'new', 'old', 'controversial'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, community, postId } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant || !UUID.test(postId)) return {};
  const post = await postById(null, slug, postId);
  if (!post || post.deletedAt) return {};
  return pageMetadata({
    tenant,
    title: post.title,
    path: `${await tenantBase(slug)}/c/${community}/post/${postId}`,
    noIndex: communitiesSettings(tenant).readAccess === 'signedIn',
  });
}

/**
 * A post's own page. The title segment after the id is for people and search
 * engines; the id is what is looked up, so an old link with a changed title
 * still lands here.
 */
export default async function PostPage({ params, searchParams }: PageProps) {
  const { slug, community: communitySlug, postId } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  if (!UUID.test(postId)) notFound();
  const community = await communityBySlug(slug, communitySlug);
  if (!community) notFound();
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  const settings = communitiesSettings(tenant);

  if (settings.readAccess === 'signedIn' && !actor) {
    return (
      <PageShell>
        <EmptyState title={t('communities.signInToRead')}>
          <Link href={`${base}/signin`} className="font-medium text-primary hover:underline">
            {t('communities.signIn')}
          </Link>
        </EmptyState>
      </PageShell>
    );
  }

  const post = await postById(actor, slug, postId);
  if (!post || post.communityId !== community.id || post.deletedAt) notFound();
  const { sort: sortParam } = await searchParams;
  const sort: CommentSort = SORTS.includes(sortParam as CommentSort)
    ? (sortParam as CommentSort)
    : 'best';
  const [rules, moderators, perms, comments, poll] = await Promise.all([
    listRules(slug, community.id),
    listModerators(slug, community.id),
    actor ? permissionsIn(actor, slug, community.id) : Promise.resolve(null),
    commentsForPost(actor, slug, post.id, sort),
    post.kind === 'poll' ? pollFor(actor, slug, post.id) : Promise.resolve(null),
  ]);
  const canComment = perms?.has('communities.comment') ?? false;
  const canModerate = perms?.hasAny('communities.moderate', 'communities.oversee') ?? false;
  const withheld = post.removedAt !== null && !post.isOwn && !canModerate;
  const hint = !actor
    ? t('comments.signInToComment')
    : canComment
      ? null
      : t('comments.joinToComment');

  return (
    <PageShell
      rail={
        <CommunityRail
          community={community}
          rules={rules}
          moderators={moderators}
          base={base}
          locale={tenant.locale}
          canManage={perms?.hasAny('communities.manage', 'communities.oversee') ?? false}
          canModerate={canModerate}
          t={t}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <p className="px-1 text-sm">
          <Link
            href={`${base}/c/${community.slug}`}
            className="font-medium text-primary hover:underline"
          >
            {community.name}
          </Link>
        </p>
        {withheld ? (
          <article className="ios-card flex flex-col gap-1 rounded-2xl p-4">
            <h1 className="text-xl font-bold tracking-tight">{post.title}</h1>
            <p className="text-sm text-muted-foreground">{t('posts.removedNotice')}</p>
          </article>
        ) : (
          <PostCard
            post={post}
            community={{ slug: community.slug, name: community.name }}
            base={base}
            tenant={slug}
            locale={tenant.locale}
            signedIn={actor !== null}
            canVote={perms?.has('communities.vote') ?? false}
            full
            t={t}
          />
        )}
        {poll && !withheld ? (
          <PollCard
            tenant={slug}
            postId={post.id}
            poll={{
              options: poll.options,
              total: poll.total,
              closed: poll.closed,
              myOptionId: poll.myOptionId,
            }}
            canVote={(perms?.has('communities.vote') ?? false) && !post.lockedAt}
            labels={{
              vote: t('poll.vote'),
              votes: t('poll.votes', { count: '{count}' }),
              votesOne: t('poll.votesOne'),
              closesLine: poll.closed
                ? t('poll.closed')
                : t('poll.closesIn', {
                    when: relativeTime(poll.closesAt.toISOString(), tenant.locale),
                  }),
              yours: t('poll.yours'),
              cannotVote: actor ? null : t('poll.signInToVote'),
              errors: postErrors(t),
            }}
          />
        ) : null}
        {post.removedAt && !withheld ? (
          <p className="px-1 text-sm text-muted-foreground">
            {t('posts.removedNotice')}
            {post.removalReason ? ` · ${removalLabel(post.removalReason, t)}` : ''}
          </p>
        ) : null}
        {canModerate ? (
          <ModControls
            tenant={slug}
            communityId={community.id}
            postId={post.id}
            removed={post.removedAt !== null}
            locked={post.lockedAt !== null}
            pinned={post.pinnedAt !== null}
            labels={{
              remove: t('mod.remove'),
              removeReason: t('mod.removeReason'),
              removed: t('mod.removed'),
              restore: t('mod.restore'),
              restored: t('mod.restored'),
              approve: t('mod.approve'),
              approved: t('mod.approved'),
              lock: t('mod.lock'),
              unlock: t('mod.unlock'),
              locked: t('mod.locked'),
              unlocked: t('mod.unlocked'),
              pin: t('mod.pin'),
              unpin: t('mod.unpin'),
              pinned: t('mod.pinned'),
              unpinned: t('mod.unpinned'),
              confirm: t('mod.confirm'),
              cancel: t('mod.cancel'),
              errors: communityErrors(t),
            }}
          />
        ) : null}
        <CommentThread
          tenant={slug}
          postId={post.id}
          postAuthorId={post.publicAuthorId}
          moderatorIds={new Set(moderators.map((m) => m.userId))}
          comments={comments}
          sort={sort}
          sortHref={postPath(base, community.slug, post.id, post.title)}
          locale={tenant.locale}
          signedIn={actor !== null}
          communityId={community.id}
          canModerate={canModerate}
          canComment={canComment && !post.lockedAt && !post.removedAt}
          canVote={perms?.has('communities.vote') ?? false}
          anonymousAllowed={community.allowAnonymous && settings.anonymousPosting === 'on'}
          depthCap={settings.commentDepth}
          hint={hint}
          t={t}
        />
      </div>
    </PageShell>
  );
}
