import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { communityBySlug, permissionsIn } from '@campusos/module-communities/communities';
import { JoinButton } from '@/app/_components/communities/join-button';
import { listFlairs } from '@campusos/module-communities/flairs';
import { listRules, needsRulesAcceptance } from '@campusos/module-communities/rules';
import { RulesGate } from '@/app/_components/communities/rules-gate';
import { PostForm } from '@/app/_components/communities/post-form';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
import { communityErrors } from '@/lib/community-labels';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { postFormLabels } from '@/lib/post-labels';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; community: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, community } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  const c = await communityBySlug(slug, community);
  if (!c) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('posts.compose.heading', { name: c.name }),
    path: `${await tenantBase(slug)}/c/${c.slug}/submit`,
    noIndex: true,
  });
}

/** Write a post. Signed in to see it; a member holding `communities.post` to send it. */
export default async function SubmitPage({ params }: Params) {
  const { slug, community: communitySlug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const community = await communityBySlug(slug, communitySlug);
  if (!community) notFound();
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);
  const t = translator(tenant.locale);
  const settings = communitiesSettings(tenant);
  const perms = await permissionsIn(actor, slug, community.id);
  const canPost = perms.has('communities.post');
  const flairs = canPost ? await listFlairs(slug, community.id) : [];
  const mustAccept = canPost && (await needsRulesAcceptance(actor, slug, community.id));
  const rules = mustAccept ? await listRules(slug, community.id) : [];

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('posts.compose.heading', { name: community.name })}
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('posts.compose.intro')}</p>
        </header>
        {canPost && community.archivedAt ? (
          <EmptyState title={t('posts.error.archived')} />
        ) : canPost && mustAccept ? (
          <RulesGate
            tenant={slug}
            communityId={community.id}
            rules={rules.map((r) => ({ title: r.title, description: r.description }))}
            labels={{
              heading: t('rules.gate.heading'),
              intro: t('rules.gate.intro'),
              confirm: t('rules.gate.confirm'),
              accept: t('rules.gate.accept'),
              working: t('communities.working'),
              errors: communityErrors(t),
            }}
          />
        ) : canPost ? (
          <div className="ios-card rounded-2xl p-4">
            <PostForm
              tenant={slug}
              base={base}
              communityId={community.id}
              communitySlug={community.slug}
              mode="create"
              allowedKinds={community.allowedKinds.filter(
                (k): k is 'text' | 'link' | 'poll' => k === 'text' || k === 'link' || k === 'poll',
              )}
              anonymousAllowed={community.allowAnonymous && settings.anonymousPosting === 'on'}
              flairs={flairs.map((f) => ({ id: f.id, name: f.name }))}
              labels={postFormLabels(t, 'create')}
            />
          </div>
        ) : (
          <EmptyState title={t('communities.error.not_allowed')}>
            {community.visibility === 'public' ? (
              <div className="pt-2">
                <JoinButton
                  tenant={slug}
                  communityId={community.id}
                  joined={false}
                  labels={{
                    join: t('communities.join'),
                    leave: t('communities.leave'),
                    working: t('communities.working'),
                    errors: communityErrors(t),
                  }}
                />
              </div>
            ) : null}
          </EmptyState>
        )}
        <p className="px-1 text-sm">
          <Link
            href={`${base}/c/${community.slug}`}
            className="font-medium text-primary hover:underline"
          >
            {community.name}
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
