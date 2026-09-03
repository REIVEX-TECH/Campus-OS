import type { Metadata } from 'next';
import Link from 'next/link';
import { getTenantRegistry } from '@/lib/tenants';
import { listMembers } from '@campusos/module-identity/members';
import { listRoles } from '@campusos/module-identity/rbac';
import { AdminNav } from '@/app/_components/admin/admin-nav';
import { MembersList } from '@/app/_components/admin/members-list';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { requirePermission } from '@/lib/auth';
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
export default async function AdminMembersPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const { actor, permissions } = await requirePermission(slug, 'manage-members');
  const canManageRoles = permissions.has('manage-roles');

  const [members, roles] = await Promise.all([
    listMembers({ userId: actor.userId }, slug),
    listRoles(actor.userId, slug),
  ]);
  const rows = members.ok ? members.value : [];
  const named = roles.map((r) => ({ key: r.key, name: roleDisplayName(r, t) }));
  const nameOf = new Map(named.map((r) => [r.key, r.name]));
  const when = new Intl.DateTimeFormat(tenant.locale, { dateStyle: 'medium' });

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('admin.members.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('admin.members.intro')}</p>
        </header>

        <AdminNav base={base} permissions={permissions} current="members" t={t} />

        {rows.length === 0 ? (
          <EmptyState title={t('admin.members.empty')} />
        ) : (
          <MembersList
            tenant={slug}
            selfUserId={actor.userId}
            canManageRoles={canManageRoles}
            roles={named}
            items={rows.map((m) => ({
              userId: m.userId,
              handle: m.handle,
              avatarSeed: m.avatarSeed,
              roles: m.roles.map((key) => ({ key, name: nameOf.get(key) ?? key })),
              suspended: m.status === 'suspended',
              verified: m.verifiedAt !== null && m.status === 'active',
              since: t('admin.members.since', { date: when.format(m.createdAt) }),
              activity: t(`admin.members.active.${m.activity}` as MessageKey),
            }))}
            labels={{
              noProfile: t('admin.noProfile'),
              you: t('admin.members.you'),
              verified: t('admin.members.verified'),
              unverified: t('admin.members.unverified'),
              suspended: t('admin.members.suspended'),
              roles: t('admin.members.roles'),
              noRoles: t('admin.members.noRoles'),
              addRole: t('admin.members.addRole'),
              removeRole: t('admin.members.removeRole', { role: '{role}' }),
              suspend: t('admin.members.suspend'),
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
