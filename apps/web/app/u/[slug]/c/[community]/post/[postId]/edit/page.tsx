import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { communityBySlug } from '@campusos/module-communities/communities';
import { postById } from '@campusos/module-communities/posts';
import { PostForm } from '@/app/_components/communities/post-form';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { requireCommunities } from '@/lib/communities';
import { postPath } from '@/lib/community-constants';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { postFormLabels } from '@/lib/post-labels';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; community: string; postId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('posts.edit.heading'),
    path: `${await tenantBase(slug)}/c`,
    noIndex: true,
  });
}

/** Edit your own post: the title and the text. Anyone else gets a 404. */
export default async function EditPostPage({ params }: Params) {
  const { slug, community: communitySlug, postId } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const community = await communityBySlug(slug, communitySlug);
  if (!community) notFound();
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);
  const post = await postById(actor, slug, postId);
  if (!post || post.communityId !== community.id || post.deletedAt || !post.isOwn) notFound();
  const t = translator(tenant.locale);

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{community.name}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('posts.edit.heading')}</h1>
        </header>
        <div className="ios-card rounded-2xl p-4">
          <PostForm
            tenant={slug}
            base={base}
            communityId={community.id}
            communitySlug={community.slug}
            mode="edit"
            postId={post.id}
            allowedKinds={['text']}
            anonymousAllowed={false}
            initial={{ title: post.title, body: post.body ?? '' }}
            labels={postFormLabels(t, 'edit')}
          />
        </div>
        <p className="px-1 text-sm">
          <Link
            href={postPath(base, community.slug, post.id, post.title)}
            className="font-medium text-primary hover:underline"
          >
            {post.title}
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
