import { Card } from '@campusos/ui';
import { tenantGrantsFor } from '@campusos/module-identity/grants';
import { AdminNav } from '@/app/_components/admin/admin-nav';
import { EmptyState } from '@/app/_components/empty-state';
import { SignOutButton } from '@/app/_components/sign-out-button';
import { accessForPage } from '@/lib/tenant-access';
import { translator } from '@/lib/i18n';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/**
 * The tenant's own record of platform-administrator access: which platform admin
 * entered, when, why, and whether the grant is still open. Read straight from
 * membership (auth_tenant_grants_for_tenant), so a visiting platform admin sees
 * nothing here even under a grant; the university's own admins see everything.
 */
export default async function PlatformAccessPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  const t = translator(tenant.locale);
  const { actor, permissions } = await accessForPage(slug, 'restrict-members');
  const base = await tenantBase(slug);
  const grants = await tenantGrantsFor(actor.userId, slug);

  const fmt = new Intl.DateTimeFormat(tenant.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: tenant.timezone,
  });
  const now = Date.now();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('admin.platformAccess.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t('admin.platformAccess.intro')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AdminNav base={base} permissions={permissions} current="platform-access" t={t} />
          <SignOutButton
            label={t('admin.platformAccess.signOut')}
            working={t('signin.signingOut')}
            redirectTo={base || '/'}
          />
        </div>
      </header>

      {grants.length === 0 ? (
        <EmptyState title={t('admin.platformAccess.none', { tenant: tenant.displayName })} />
      ) : (
        <Card className="flex flex-col gap-4 p-4">
          <ul className="flex flex-col gap-4">
            {grants.map((g) => {
              const status = g.revokedAt
                ? t('admin.platformAccess.ended', { when: fmt.format(g.revokedAt) })
                : g.expiresAt.getTime() > now
                  ? t('admin.platformAccess.open', { when: fmt.format(g.expiresAt) })
                  : t('admin.platformAccess.expired', { when: fmt.format(g.expiresAt) });
              return (
                <li key={g.grantId} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-semibold">{g.adminHandle}</span>
                    <span className="text-sm text-muted-foreground">{status}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {t('admin.platformAccess.entered', { when: fmt.format(g.openedAt) })}
                  </span>
                  <span className="text-sm">
                    {t('admin.platformAccess.reason')}: {g.reason}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
