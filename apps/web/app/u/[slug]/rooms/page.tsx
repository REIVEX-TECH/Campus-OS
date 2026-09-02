import type { Metadata } from 'next';
import { Building2 } from 'lucide-react';
import { tenantRegistry } from '@campusos/tenants';
import { Directory, type DirectoryItem } from '@/app/_components/profile/directory';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { countText, translator } from '@/lib/i18n';
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
    title: translator(tenant.locale)('rooms.heading'),
    path: `${await tenantBase(slug)}/rooms`,
  });
}

/** The room directory: every room with published classes, searchable. */
export default async function RoomsDirectory({ params }: Params) {
  const { slug } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const rooms = await getQueries(slug).listRoomsWithCounts();

  // A subtitle that reads the same on every card tells the reader nothing. Many
  // tenants keep all their rooms in one building (or in the importer's single
  // placeholder), so the building only earns its line when it actually varies.
  const showBuilding = new Set(rooms.map((r) => r.building)).size > 1;

  const items: DirectoryItem[] = rooms.map((r) => ({
    id: r.id,
    kind: 'place',
    href: `${base}/rooms/${r.id}`,
    title: r.name,
    ...(showBuilding ? { subtitle: r.building } : {}),
    meta: `${countText(tenant.locale, 'classes', r.classes)}, ${countText(tenant.locale, 'days', r.days)}`,
  }));

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('rooms.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('rooms.intro')}</p>
        </header>

        {items.length === 0 ? (
          <EmptyState title={t('rooms.empty')} icon={Building2} />
        ) : (
          <Directory
            items={items}
            searchLabel={t('rooms.search')}
            countTemplate={t('rooms.count', { count: '{count}' })}
            emptyTemplate={t('rooms.none', { q: '{q}' })}
          />
        )}
      </div>
    </PageShell>
  );
}
