import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { JsonLd } from '@/app/_components/json-ld';
import { ModuleIcon } from '@/app/_components/module-icon';
import { PageShell } from '@/app/_components/page-shell';
import { translator, type MessageKey } from '@/lib/i18n';
import { universityLd } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { MODULES } from '@/lib/modules';
import { baseUrlFromHost } from '@/lib/tenant';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({ tenant, title: tenant.displayName, path: (await tenantBase(slug)) || '/' });
}

export default async function TenantHome({ params }: Params) {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) notFound();
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const host = (await headers()).get('host') ?? '';
  const tenantUrl = `${baseUrlFromHost(host)}${base}`;

  const rail = (
    <div className="ios-card flex flex-col gap-2 rounded-2xl p-4">
      <h2 className="text-sm font-semibold">{t('hub.about')}</h2>
      <p className="text-sm text-muted-foreground">{tenant.seo.description}</p>
    </div>
  );

  return (
    <PageShell rail={rail}>
      <JsonLd data={universityLd(tenant, tenantUrl)} />
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold tracking-tight">{tenant.displayName}</h1>
          <p className="max-w-prose text-muted-foreground">{tenant.seo.description}</p>
        </header>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
          {MODULES.map((m) => (
            <li key={m.key}>
              <Link
                href={m.soon ? `${base}/soon/${m.key}` : `${base}${m.path ?? ''}`}
                className="ios-card ios-pressable flex h-full flex-col gap-2 rounded-2xl p-4 hover:shadow-[var(--shadow-card-strong)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-muted text-foreground">
                    <ModuleIcon name={m.icon} className="h-5 w-5" />
                  </span>
                  {m.soon ? (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {t('modules.comingSoon')}
                    </span>
                  ) : null}
                </div>
                <span className="text-lg font-semibold">
                  {t(`module.${m.key}.label` as MessageKey)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t(`module.${m.key}.desc` as MessageKey)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </PageShell>
  );
}
