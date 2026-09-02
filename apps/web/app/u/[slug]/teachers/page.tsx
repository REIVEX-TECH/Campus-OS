import type { Metadata } from 'next';
import { tenantRegistry } from '@campusos/tenants';
import { Directory, type DirectoryItem } from '@/app/_components/profile/directory';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getQueries, requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('teachers.heading'),
    path: `${await tenantBase(slug)}/teachers`,
  });
}

/** The teacher directory: everyone with published classes, searchable. */
export default async function TeachersDirectory({ params }: Params) {
  const { slug } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const teachers = await getQueries(slug).listTeachersWithCounts();

  const items: DirectoryItem[] = teachers.map((x) => ({
    id: x.id,
    href: `${base}/teachers/${x.id}`,
    title: x.name,
    meta: t('teachers.meta', { classes: x.classes, courses: x.courses }),
    badge: x.status === 'pending' ? t('timetable.unverified') : undefined,
  }));

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('teachers.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('teachers.intro')}</p>
        </header>

        {items.length === 0 ? (
          <EmptyState title={t('teachers.empty')} />
        ) : (
          <Directory
            items={items}
            searchLabel={t('teachers.search')}
            countTemplate={t('teachers.count', { count: '{count}' })}
            emptyTemplate={t('teachers.none', { q: '{q}' })}
          />
        )}
      </div>
    </PageShell>
  );
}
