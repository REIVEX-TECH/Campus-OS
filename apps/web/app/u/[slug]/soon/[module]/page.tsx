import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { buttonVariants } from '@campusos/ui';
import { translator, type MessageKey } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { soonModule } from '@/lib/modules';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; module: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, module } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  const mod = soonModule(module);
  if (!tenant || !mod) return {};
  const label = translator(tenant.locale)(`module.${mod.key}.label` as MessageKey);
  return pageMetadata({ tenant, title: label, path: `${await tenantBase(slug)}/soon/${module}` });
}

export default async function ComingSoonPage({ params }: Params) {
  const { slug, module } = await params;
  const tenant = requireTenant(slug);
  const mod = soonModule(module);
  if (!mod) notFound();
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 text-center">
      <span className="text-5xl" aria-hidden="true">
        {mod.icon}
      </span>
      <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        {t('modules.comingSoon')}
      </span>
      <h1 className="text-2xl font-bold tracking-tight">
        {t(`module.${mod.key}.label` as MessageKey)}
      </h1>
      <p className="max-w-prose text-muted-foreground">
        {t(`module.${mod.key}.desc` as MessageKey)}
      </p>
      <p className="text-sm text-muted-foreground">{t('modules.soonBody')}</p>
      <Link className={buttonVariants({ variant: 'outline' })} href={base || '/'}>
        {t('modules.back')}
      </Link>
    </div>
  );
}
