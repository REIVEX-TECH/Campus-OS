import Link from 'next/link';
import { buttonVariants, Card } from '@campusos/ui';
import { EnterTenantButton } from '@/app/_components/admin/enter-tenant-button';
import { platformAdmin } from '@/lib/auth';
import { grantModalLabels } from '@/lib/grant-labels';
import { translator, type MessageKey, type Translate } from '@/lib/i18n';
import { getTenantRegistry, tenantConfigSources } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

/**
 * Bare `/admin` on the PLATFORM host (campusos.reivex.io). A tenant host's
 * `/admin` is rewritten to /u/{slug}/admin by middleware, so this route only
 * serves the platform host (and the bare dev host).
 *
 * For a platform administrator: every university the platform serves, where
 * its configuration comes from, and the way to add or edit one. For everyone
 * else the same page as before, a heading and the way in, and nothing that
 * says an admin area exists behind it.
 */
export default async function PlatformAdmin({
  searchParams,
}: {
  searchParams: Promise<{ grant?: string; tenant?: string }>;
}) {
  const t = translator('en');
  const admin = await platformAdmin();
  if (!admin) return <Placeholder t={t} />;

  const [registry, sources] = await Promise.all([getTenantRegistry(), tenantConfigSources()]);
  const tenants = registry.all();

  // A grant that ended mid-session redirects here with a typed signal; name the
  // tenant so the way back in is obvious. Informational: it clears on navigation.
  const sp = await searchParams;
  const expired = sp.grant === 'expired';
  const expiredTenant =
    expired && sp.tenant ? (registry.resolveBySlug(sp.tenant)?.displayName ?? null) : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t('platform.admin.heading')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t('platform.admin.tenantsIntro')}
        </p>
      </header>

      {expired ? (
        <div className="ios-card flex flex-col gap-1 rounded-2xl p-4" role="status">
          <span className="text-sm font-semibold">{t('platform.grant.expired.heading')}</span>
          <span className="text-sm text-muted-foreground">
            {expiredTenant
              ? t('platform.grant.expired.body', { tenant: expiredTenant })
              : t('platform.grant.expired.bodyGeneric')}
          </span>
        </div>
      ) : null}

      <nav className="flex flex-wrap gap-3 text-sm">
        <Link href="/admin/roles" className="font-medium text-primary hover:underline">
          {t('platform.roles.heading')}
        </Link>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/tenants/new" className={buttonVariants({ size: 'sm' })}>
          {t('platform.admin.newTenant')}
        </Link>
        <Link href="/" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          {t('platform.admin.home')}
        </Link>
      </div>
      <ul className="flex flex-col gap-2">
        {tenants.map((tenant) => (
          <li key={tenant.slug} className="flex items-stretch gap-2">
            <Link
              href={`/admin/tenants/${tenant.slug}`}
              className="block flex-1 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="ios-pressable flex h-full items-center justify-between gap-4 p-4">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base font-semibold">{tenant.displayName}</span>
                  <span className="text-xs text-muted-foreground">{tenant.slug}</span>
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {t(`platform.admin.source.${sources.get(tenant.slug) ?? 'file'}` as MessageKey)}
                </span>
              </Card>
            </Link>
            <div className="flex items-center">
              <EnterTenantButton
                tenantSlug={tenant.slug}
                tenantName={tenant.displayName}
                enterLabel={t('platform.grant.enter')}
                labels={grantModalLabels(t)}
              />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Placeholder({ t }: { t: Translate }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight">{t('platform.admin.heading')}</h1>
        <p className="max-w-prose text-base text-muted-foreground">{t('platform.admin.body')}</p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <Link className={buttonVariants()} href="/login">
          {t('platform.admin.signIn')}
        </Link>
        <Link className={buttonVariants({ variant: 'outline' })} href="/">
          {t('platform.admin.home')}
        </Link>
      </div>
    </main>
  );
}
