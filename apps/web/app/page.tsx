import Link from 'next/link';
import { buttonVariants, Card } from '@campusos/ui';
import { tenantRegistry } from '@campusos/tenants';
import { translator } from '@/lib/i18n';
import { tenantOrigin } from '@/lib/tenant-routing';

export const dynamic = 'force-dynamic';

const GITHUB_URL = 'https://github.com/REIVEX-TECH/Campus-OS';

/** Link to a tenant's instance: its {slug}.TENANT_BASE_DOMAIN subdomain in
 * production, the /u/{slug} path fallback in local dev. Driven by the registry
 * (no hardcoding). */
function tenantUrl(slug: string): string {
  return tenantOrigin(slug) ?? `/u/${slug}`;
}

export default function PlatformHome() {
  const t = translator('en');
  const tenants = tenantRegistry.all();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-10 p-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-5xl font-bold tracking-tight">CampusOS</h1>
        <p className="text-xl text-muted-foreground">{t('platform.tagline')}</p>
        <p className="max-w-prose text-base text-muted-foreground">{t('platform.description')}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('platform.universities')}
        </h2>
        <ul className="flex flex-col gap-3">
          {tenants.map((tenant) => (
            <li key={tenant.slug}>
              <Link
                href={tenantUrl(tenant.slug)}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="flex items-center justify-between gap-4 p-5">
                  <span className="text-lg font-semibold">{tenant.displayName}</span>
                  <span className="text-sm font-medium text-muted-foreground">
                    {t('platform.openInstance', { name: tenant.displayName })}
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer>
        <a
          className={buttonVariants({ variant: 'outline' })}
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('platform.github')}
        </a>
      </footer>
    </main>
  );
}
