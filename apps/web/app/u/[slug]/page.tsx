import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { tenantRegistry } from '@campusos/tenants';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({ tenant, title: tenant.displayName, path: `/u/${slug}` });
}

export default async function TenantHome({ params }: Params) {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) notFound();
  const t = translator(tenant.locale);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{tenant.displayName}</h1>
      <p className="text-muted-foreground max-w-prose">{tenant.seo.description}</p>
      <Link className={buttonVariants()} href={`/u/${slug}/timetable`}>
        {t('timetable.viewTimetable')}
      </Link>
    </main>
  );
}
