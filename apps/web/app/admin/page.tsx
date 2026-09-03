import Link from 'next/link';
import { buttonVariants, Card } from '@campusos/ui';
import { platformAdmin } from '@/lib/auth';
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
export default async function PlatformAdmin() {
  const t = translator('en');
  const admin = await platformAdmin();
  if (!admin) return <Placeholder t={t} />;

  const [registry, sources] = await Promise.all([getTenantRegistry(), tenantConfigSources()]);
  const tenants = registry.all();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t('platform.admin.heading')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t('platform.admin.tenantsIntro')}
        </p>
      </header>
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
          <li key={tenant.slug}>
            <Link
              href={`/admin/tenants/${tenant.slug}`}
              className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="ios-pressable flex items-center justify-between gap-4 p-4">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base font-semibold">{tenant.displayName}</span>
                  <span className="text-xs text-muted-foreground">{tenant.slug}</span>
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {t(`platform.admin.source.${sources.get(tenant.slug) ?? 'file'}` as MessageKey)}
                </span>
              </Card>
            </Link>
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
        <Link className={buttonVariants()} href="/signin">
          {t('platform.admin.signIn')}
        </Link>
        <Link className={buttonVariants({ variant: 'outline' })} href="/">
          {t('platform.admin.home')}
        </Link>
      </div>
    </main>
  );
}
