import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { buttonVariants, Card } from '@campusos/ui';
import { tenantRegistry } from '@campusos/tenants';
import { translator, type MessageKey } from '@/lib/i18n';
import { websiteLd } from '@/lib/json-ld';
import { baseUrlFromHost } from '@/lib/tenant';
import { tenantUrlForHost } from '@/lib/tenant-routing';
import { JsonLd } from './_components/json-ld';
import { PlatformHeader } from './_components/platform-header';

export const dynamic = 'force-dynamic';

const GITHUB_URL = 'https://github.com/REIVEX-TECH/Campus-OS';
const APP_DOMAIN = process.env.APP_DOMAIN ?? 'localhost:3000';

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get('host') ?? APP_DOMAIN;
  const baseUrl = baseUrlFromHost(host);
  const url = `${baseUrl}/`;
  const t = translator('en');
  const title = 'CampusOS';
  const description = t('platform.description');
  return {
    metadataBase: new URL(baseUrl),
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: title, type: 'website', locale: 'en' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

const FEATURES = [
  { key: 'timetable', icon: '📅' },
  { key: 'find', icon: '🔎' },
  { key: 'modular', icon: '🧩' },
  { key: 'open', icon: '🔓' },
] as const;

export default async function PlatformHome() {
  const t = translator('en');
  const tenants = tenantRegistry.all();
  // Host-reflective: the landing is served on the platform host, so a tenant is
  // a subdomain of THIS host (single hop, no legacy redirect). Path-based in dev.
  const host = (await headers()).get('host') ?? '';
  const baseUrl = baseUrlFromHost(host);
  const tenantUrl = (slug: string): string => tenantUrlForHost(slug, host) ?? `/u/${slug}`;

  return (
    <div className="flex min-h-screen flex-col">
      <JsonLd data={websiteLd({ url: `${baseUrl}/`, description: t('platform.description') })} />
      <PlatformHeader />
      <main className="mx-auto w-full max-w-[120rem] flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <section className="flex max-w-3xl flex-col gap-4">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            {t('platform.hero.title')}
          </h1>
          <p className="text-lg text-muted-foreground">{t('platform.hero.body')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a className={buttonVariants()} href="#universities">
              {t('platform.hero.browse')}
            </a>
            <a
              className={buttonVariants({ variant: 'outline' })}
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('platform.github')}
            </a>
          </div>
        </section>

        <section className="mt-12 flex flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t('platform.features.heading')}
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <li key={f.key} className="ios-card flex h-full flex-col gap-2 rounded-2xl p-5">
                <span className="text-2xl" aria-hidden="true">
                  {f.icon}
                </span>
                <span className="text-lg font-semibold">
                  {t(`platform.feature.${f.key}.title` as MessageKey)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t(`platform.feature.${f.key}.body` as MessageKey)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section id="universities" className="mt-12 flex scroll-mt-20 flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t('platform.universities')}
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tenants.map((tenant) => (
              <li key={tenant.slug}>
                <Link
                  href={tenantUrl(tenant.slug)}
                  className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card className="ios-pressable flex h-full items-center justify-between gap-4 p-5">
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
      </main>
    </div>
  );
}
