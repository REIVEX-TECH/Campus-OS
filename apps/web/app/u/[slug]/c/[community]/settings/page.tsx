import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { communityBySlug, permissionsIn } from '@campusos/module-communities/communities';
import { listMembers } from '@campusos/module-communities/members';
import { listAutomodRules } from '@campusos/module-communities/automod';
import { listFlairs } from '@campusos/module-communities/flairs';
import { listRules } from '@campusos/module-communities/rules';
import { AutomodEditor } from '@/app/_components/communities/automod-editor';
import { FlairEditor } from '@/app/_components/communities/flair-editor';
import { CommunityForm } from '@/app/_components/communities/community-form';
import { ModeratorsPanel } from '@/app/_components/communities/moderators-panel';
import { RulesEditor } from '@/app/_components/communities/rules-editor';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
import { communityErrors, communityFormLabels } from '@/lib/community-labels';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
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
    title: translator(tenant.locale)('communities.settings.heading', { name: c.name }),
    path: `${await tenantBase(slug)}/c/${c.slug}/settings`,
    noIndex: true,
  });
}

/**
 * A community's settings, rules and moderators. Owners (`communities.manage`)
 * and the university's administrators (`communities.oversee`); 404 to anyone
 * else, so the page's existence says nothing. Every save is re-checked on the
 * server inside its own transaction.
 */
export default async function CommunitySettingsPage({ params }: Params) {
  const { slug, community: communitySlug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const community = await communityBySlug(slug, communitySlug);
  if (!community) notFound();
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);
  const perms = await permissionsIn(actor, slug, community.id);
  if (!perms.hasAny('communities.manage', 'communities.oversee')) notFound();
  const t = translator(tenant.locale);
  const settings = communitiesSettings(tenant);
  const [rules, members, filters, flairs] = await Promise.all([
    listRules(slug, community.id),
    listMembers(slug, community.id),
    listAutomodRules(actor, slug, community.id),
    listFlairs(slug, community.id),
  ]);
  const errors = communityErrors(t);

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('communities.settings.heading', { name: community.name })}
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t('communities.settings.intro')}
          </p>
        </header>

        <section
          aria-labelledby="c-settings"
          className="ios-card flex flex-col gap-3 rounded-2xl p-4"
        >
          <h2 id="c-settings" className="text-base font-semibold">
            {t('communities.settings')}
          </h2>
          <CommunityForm
            tenant={slug}
            base={base}
            mode="edit"
            communityId={community.id}
            initial={{
              name: community.name,
              description: community.description,
              allowAnonymous: community.allowAnonymous,
              allowedKinds: community.allowedKinds.filter(
                (k): k is 'text' | 'link' | 'poll' => k === 'text' || k === 'link' || k === 'poll',
              ),
              visibility: community.visibility === 'restricted' ? 'restricted' : 'public',
              modLogPublic: false,
              minKarmaToPost: community.minKarmaToPost,
              minKarmaToComment: community.minKarmaToComment,
              minKarmaToJoin: community.minKarmaToJoin,
              minAccountAgeDays: community.minAccountAgeDays,
              requireVerified: community.requireVerified,
            }}
            anonymousAllowedByTenant={settings.anonymousPosting === 'on'}
            labels={communityFormLabels(t, 'edit')}
          />
        </section>

        <section aria-labelledby="c-rules" className="ios-card flex flex-col gap-3 rounded-2xl p-4">
          <div className="flex flex-col gap-0.5">
            <h2 id="c-rules" className="text-base font-semibold">
              {t('communities.rules.heading')}
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t('communities.rules.intro')}
            </p>
          </div>
          <RulesEditor
            tenant={slug}
            communityId={community.id}
            initial={rules.map((r) => ({ title: r.title, description: r.description }))}
            labels={{
              title: t('communities.rules.title'),
              description: t('communities.rules.description'),
              add: t('communities.rules.add'),
              remove: t('communities.rules.remove', { n: '{n}' }),
              save: t('communities.rules.save'),
              saved: t('communities.rules.saved'),
              working: t('communities.working'),
              errors,
            }}
          />
        </section>

        <FlairEditor
          tenant={slug}
          communityId={community.id}
          initial={flairs.map((f) => ({ id: f.id, name: f.name, color: f.color }))}
          labels={{
            heading: t('flairs.heading'),
            intro: t('flairs.intro'),
            name: t('flairs.name'),
            color: t('flairs.color'),
            add: t('flairs.add'),
            remove: t('flairs.remove', { n: '{n}' }),
            save: t('flairs.save'),
            saved: t('flairs.saved'),
            working: t('communities.working'),
            empty: t('flairs.empty'),
            errors,
          }}
        />

        <AutomodEditor
          tenant={slug}
          communityId={community.id}
          initial={(filters.ok ? filters.value : []).map((r) => ({
            kind: r.kind,
            pattern: r.pattern,
            action: r.action,
          }))}
          labels={{
            heading: t('automod.heading'),
            intro: t('automod.intro'),
            kind: t('automod.kind'),
            keyword: t('automod.keyword'),
            domain: t('automod.domain'),
            pattern: t('automod.pattern'),
            action: t('automod.action'),
            queue: t('automod.queue'),
            remove: t('automod.remove'),
            add: t('automod.add'),
            delete: t('automod.delete', { n: '{n}' }),
            save: t('automod.save'),
            saved: t('automod.saved'),
            working: t('communities.working'),
            empty: t('automod.empty'),
            errors,
          }}
        />

        <section aria-labelledby="c-mods" className="ios-card flex flex-col gap-3 rounded-2xl p-4">
          <div className="flex flex-col gap-0.5">
            <h2 id="c-mods" className="text-base font-semibold">
              {t('communities.mods.heading')}
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t('communities.mods.intro')}
            </p>
          </div>
          <ModeratorsPanel
            tenant={slug}
            communityId={community.id}
            selfUserId={actor.userId}
            members={members}
            labels={{
              make: t('communities.mods.make'),
              unmake: t('communities.mods.unmake'),
              makeOwner: t('communities.mods.makeOwner'),
              you: t('communities.mods.you'),
              owner: t('communities.role.community_owner'),
              moderator: t('communities.role.community_moderator'),
              working: t('communities.working'),
              saved: t('communities.mods.saved'),
              errors,
            }}
          />
        </section>

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
