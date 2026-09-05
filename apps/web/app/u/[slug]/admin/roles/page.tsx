import type { Metadata } from 'next';
import Link from 'next/link';
import { PERMISSIONS } from '@campusos/core';
import { getTenantRegistry } from '@/lib/tenants';
import { listRoles } from '@campusos/module-identity/rbac';
import { AdminNav } from '@/app/_components/admin/admin-nav';
import { RoleList } from '@/app/_components/admin/role-list';
import { PageShell } from '@/app/_components/page-shell';
import { accessForPage } from '@/lib/tenant-access';
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
    title: translator(tenant.locale)('admin.roles.heading'),
    path: `${await tenantBase(slug)}/admin/roles`,
    noIndex: true,
  });
}

/**
 * What each role in this university may do.
 *
 * Read only: which roles exist and what they carry is a platform level
 * definition, and `manage-roles` here means granting them on the members
 * page. Gated on that permission all the same, so the page and the control it
 * explains open together, and 404 to anyone without it.
 */
export default async function AdminRolesPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const { actor, permissions } = await accessForPage(slug, 'manage-roles');

  const roles = await listRoles(actor.userId, slug);
  const permissionLabels = Object.fromEntries(
    PERMISSIONS.map((p) => [p, t(`admin.roles.permission.${p}` as MessageKey)]),
  );
  // Built in roles first, then the tenant's own, each group by name.
  const ordered = [...roles].sort(
    (a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name),
  );

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('admin.roles.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('admin.roles.intro')}</p>
        </header>

        <AdminNav base={base} permissions={permissions} current="roles" t={t} />

        <RoleList
          roles={ordered.map((r) => ({
            key: r.key,
            name: roleDisplayName(r, t),
            isSystem: r.isSystem,
            permissions: r.permissions,
          }))}
          permissionLabels={permissionLabels}
          labels={{
            builtIn: t('admin.roles.builtIn'),
            permissions: t('admin.roles.permissions'),
            none: t('admin.roles.none'),
            definitionNote: t('admin.roles.definitionNote'),
          }}
        />

        <p className="px-1 text-sm">
          <Link href={`${base}/account`} className="font-medium text-primary hover:underline">
            {t('admin.backToAccount')}
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
