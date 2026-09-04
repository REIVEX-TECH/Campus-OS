import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { communityBySlug, permissionsIn } from '@campusos/module-communities/communities';
import { listSanctions } from '@campusos/module-communities/mod-actions';
import { listMembers } from '@campusos/module-communities/members';
import { MemberSanctions } from '@/app/_components/communities/member-sanctions';
import { EmptyState } from '@/app/_components/empty-state';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
import { communityErrors } from '@/lib/community-labels';
import { translator, type MessageKey } from '@/lib/i18n';
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
    title: translator(tenant.locale)('communities.membersPage.heading', { name: c.name }),
    path: `${await tenantBase(slug)}/c/${c.slug}/members`,
    noIndex: true,
  });
}

/** Who belongs, owners and moderators first. Handles only. */
export default async function CommunityMembersPage({ params }: Params) {
  const { slug, community: communitySlug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
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
  const members = await listMembers(slug, community.id);
  const perms = actor ? await permissionsIn(actor, slug, community.id) : null;
  const canModerate = perms?.hasAny('communities.moderate', 'communities.oversee') ?? false;
  const sanctions = actor && canModerate ? await listSanctions(actor, slug, community.id) : null;
  const whenAt = new Intl.DateTimeFormat(tenant.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const when = new Intl.DateTimeFormat(tenant.locale, { dateStyle: 'medium' });

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('communities.membersPage.heading', { name: community.name })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('communities.members', { count: community.memberCount })}
          </p>
        </header>
        <ul className="ios-card flex flex-col rounded-2xl p-2">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 rounded-xl px-2 py-2">
              <IdentityAvatar seed={m.avatarSeed} label={m.handle} size={32} />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-sm font-medium">{m.handle}</p>
                <p className="text-xs text-muted-foreground">
                  {t('communities.membersPage.since', { date: when.format(m.joinedAt) })}
                </p>
              </div>
              {m.roles[0] ? (
                <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {t(`communities.role.${m.roles[0]}` as MessageKey)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {canModerate && sanctions?.ok ? (
          <MemberSanctions
            tenant={slug}
            communityId={community.id}
            members={members
              .filter((m) => m.roles.length === 0 && m.userId !== actor?.userId)
              .map((m) => ({ userId: m.userId, handle: m.handle }))}
            sanctions={sanctions.value.map((x) => ({
              id: x.id,
              kind: x.kind,
              handle: x.handle,
              reason: x.reason,
              until: x.until
                ? t('mod.sanction.until', { date: whenAt.format(x.until) })
                : t('mod.sanction.permanent'),
            }))}
            labels={{
              heading: t('mod.sanction.heading'),
              member: t('mod.sanction.member'),
              kind: t('mod.sanction.kind'),
              ban: t('mod.sanction.ban'),
              mute: t('mod.sanction.mute'),
              banHint: t('mod.sanction.banHint'),
              muteHint: t('mod.sanction.muteHint'),
              duration: t('mod.sanction.duration'),
              durations: {
                day: t('mod.sanction.day'),
                week: t('mod.sanction.week'),
                month: t('mod.sanction.month'),
                forever: t('mod.sanction.forever'),
              },
              reason: t('mod.sanction.reason'),
              apply: t('mod.sanction.apply'),
              applied: t('mod.sanction.applied'),
              active: t('mod.sanction.active'),
              none: t('mod.sanction.none'),
              lift: t('mod.sanction.lift'),
              lifted: t('mod.sanction.lifted'),
              errors: communityErrors(t),
            }}
          />
        ) : null}
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
