import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { communityBySlug, permissionsIn } from '@campusos/module-communities/communities';
import { listModerators } from '@campusos/module-communities/members';
import { postById } from '@campusos/module-communities/posts';
import { listRules } from '@campusos/module-communities/rules';
import { CommunityRail } from '@/app/_components/communities/community-rail';
import { PostCard } from '@/app/_components/communities/post-card';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; community: string; postId: string }> };

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
export default async function PostPage({ params }: Params) {
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
  const [rules, moderators, perms] = await Promise.all([
    listRules(slug, community.id),
    listModerators(slug, community.id),
    actor ? permissionsIn(actor, slug, community.id) : Promise.resolve(null),
  ]);

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
        <section aria-labelledby="post-comments" className="flex flex-col gap-2">
          <h2
            id="post-comments"
            className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t('posts.comments', { count: post.commentCount })}
          </h2>
          <EmptyState title={t('posts.commentsSoon')} />
        </section>
      </div>
    </PageShell>
  );
}
