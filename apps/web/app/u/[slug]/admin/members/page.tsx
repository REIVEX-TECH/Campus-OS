import type { Metadata } from 'next';
import Link from 'next/link';
import { getTenantRegistry } from '@/lib/tenants';
import { listMembers } from '@campusos/module-identity/members';
import { listStandings } from '@campusos/module-identity/standing';
import { isCommunityRole } from '@campusos/core';
import { listRoles } from '@campusos/module-identity/rbac';
import { AdminNav } from '@/app/_components/admin/admin-nav';
import { listReportedPeople } from '@campusos/module-communities/oversight';
import { MembersList } from '@/app/_components/admin/members-list';
import { ReportedPeople } from '@/app/_components/admin/reported-people';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { accessForPage } from '@/lib/tenant-access';
import { communitiesEnabled, communitiesSettings } from '@/lib/communities';
import { reportReasonLabels } from '@/lib/community-labels';
import { translator, type MessageKey } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { roleDisplayName } from '@/lib/role-names';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('admin.members.heading'),
    path: `${await tenantBase(slug)}/admin/members`,
    noIndex: true,
  });
}

/**
 * The members of the university, and the roles each of them holds.
 *
 * Gated by `manage-members`, resolved on this request; anyone without it gets
 * a 404. The role controls appear only for someone who also holds
 * `manage-roles`, and every action is re-checked on the server inside its own
 * transaction. Handles only: no email is read anywhere on this page.
 */
/** Why a member is under a standing and when it ends, in one line, or null. */
function standingLineFor(
  entry: { reason: string | null; until: Date | null } | undefined,
  format?: (date: Date) => string,
): string | null {
  if (!entry) return null;
  const ends = entry.until && format ? format(entry.until) : null;
  return [entry.reason, ends].filter(Boolean).join(' · ') || null;
}

export default async function AdminMembersPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const { actor, permissions } = await accessForPage(slug, 'manage-members');
  const canManageRoles = permissions.has('manage-roles');
  const canRestrict = permissions.has('restrict-members');

  const settings = communitiesEnabled(tenant) ? communitiesSettings(tenant) : null;
  const [members, roles, standings, reported] = await Promise.all([
    listMembers({ userId: actor.userId }, slug),
    listRoles(actor.userId, slug),
    canRestrict
      ? listStandings({ userId: actor.userId }, slug)
      : Promise.resolve({ ok: true as const, value: [] }),
    // Reports about people are a communities feature, so the section is absent
    // for a tenant that has the module switched off.
    canRestrict && settings
      ? listReportedPeople({ userId: actor.userId }, slug, settings.reportThreshold)
      : Promise.resolve({ ok: true as const, value: [] }),
  ]);
  const standingOf = new Map(
    (standings.ok ? standings.value : []).map((entry) => [entry.userId, entry]),
  );
  const rows = members.ok ? members.value : [];
  // Community roles attach per community, in the module that owns them.
  const named = roles
    .filter((r) => !isCommunityRole(r.key))
    .map((r) => ({ key: r.key, name: roleDisplayName(r, t) }));
  const nameOf = new Map(named.map((r) => [r.key, r.name]));
  const when = new Intl.DateTimeFormat(tenant.locale, { dateStyle: 'medium' });
  const reasonNames: Record<string, string> = reportReasonLabels(t);

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('admin.members.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('admin.members.intro')}</p>
        </header>

        <AdminNav base={base} permissions={permissions} current="members" t={t} />

        {canRestrict && settings ? (
          <ReportedPeople
            tenant={slug}
            people={(reported.ok ? reported.value : []).map((p) => ({
              userId: p.userId,
              handle: p.handle,
              avatarSeed: p.avatarSeed,
              openReports: p.openReports,
              flagged: p.flagged,
              reasons: p.reasons.map((r) => reasonNames[r] ?? r),
              when: when.format(p.lastReportedAt),
            }))}
            labels={{
              heading: t('admin.people.heading'),
              blurb: t('admin.people.blurb'),
              none: t('admin.people.none'),
              count: t('admin.people.count'),
              flagged: t('admin.people.flagged'),
              dismiss: t('admin.people.dismiss'),
              acted: t('admin.people.acted'),
              done: t('admin.people.done'),
              working: t('admin.members.working'),
              failed: t('communities.error.failed'),
            }}
          />
        ) : null}

        {rows.length === 0 ? (
          <EmptyState title={t('admin.members.empty')} />
        ) : (
          <MembersList
            tenant={slug}
            selfUserId={actor.userId}
            canManageRoles={canManageRoles}
            canRestrict={canRestrict}
            roles={named}
            items={rows.map((m) => ({
              userId: m.userId,
              handle: m.handle,
              avatarSeed: m.avatarSeed,
              roles: m.roles.map((key) => ({ key, name: nameOf.get(key) ?? key })),
              standing:
                m.status === 'suspended'
                  ? ('suspended' as const)
                  : m.status === 'restricted'
                    ? ('restricted' as const)
                    : ('active' as const),
              standingLine: standingLineFor(standingOf.get(m.userId), (d) => when.format(d)),
              verified: m.verifiedAt !== null && m.status === 'active',
              since: t('admin.members.since', { date: when.format(m.createdAt) }),
              activity: t(`admin.members.active.${m.activity}` as MessageKey),
            }))}
            labels={{
              noProfile: t('admin.noProfile'),
              you: t('admin.members.you'),
              verified: t('admin.members.verified'),
              unverified: t('admin.members.unverified'),
              restricted: t('admin.members.restricted'),
              suspended: t('admin.members.suspended'),
              restrict: t('admin.members.restrict'),
              restrictPrompt: t('admin.members.restrictPrompt'),
              roles: t('admin.members.roles'),
              noRoles: t('admin.members.noRoles'),
              addRole: t('admin.members.addRole'),
              removeRole: t('admin.members.removeRole', { role: '{role}' }),
              suspend: t('admin.members.suspend'),
              suspendPrompt: t('admin.members.suspendPrompt'),
              reinstate: t('admin.members.reinstate'),
              working: t('admin.members.working'),
              saved: t('admin.members.saved'),
              lastAdmin: t('admin.members.lastAdmin'),
              self: t('admin.members.self'),
              failed: t('admin.members.failed'),
            }}
          />
        )}

        <p className="px-1 text-sm">
          <Link href={`${base}/account`} className="font-medium text-primary hover:underline">
            {t('admin.backToAccount')}
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
