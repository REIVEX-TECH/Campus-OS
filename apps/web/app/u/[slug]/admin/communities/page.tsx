import type { Metadata } from 'next';
import { listCommunitiesForOversight } from '@campusos/module-communities/oversight';
import { listHeld, listQueue } from '@campusos/module-communities/queue';
import { AdminNav } from '@/app/_components/admin/admin-nav';
import { ModQueue } from '@/app/_components/communities/mod-queue';
import { OversightList } from '@/app/_components/communities/oversight-list';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { accessForPage } from '@/lib/tenant-access';
import { requireCommunities } from '@/lib/communities';
import { postPath } from '@/lib/community-constants';
import { communityErrors } from '@/lib/community-labels';
import { relativeTime } from '@/lib/format';
import { translator, type MessageKey } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('oversight.heading'),
    path: `${await tenantBase(slug)}/admin/communities`,
    noIndex: true,
  });
}

/**
 * The tenant over its communities: approve what waits, dissolve with a
 * reason, and work the open reports of every community in one queue. This is
 * the one page that offers to reveal an anonymous author, and only to a
 * person who holds `communities.unmask`, only from a report; the database
 * function does the check and writes the audit line in the same transaction.
 */
export default async function AdminCommunitiesPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const { actor, permissions } = await accessForPage(slug, 'communities.oversee');
  const me = { userId: actor.userId };
  const [communities, queue, held] = await Promise.all([
    listCommunitiesForOversight(me, slug),
    listQueue(me, slug, null),
    listHeld(me, slug, null),
  ]);
  const rows = communities.ok ? communities.value : [];
  const canUnmask = permissions.has('communities.unmask');

  const queueLabels = {
    empty: t('mod.queueEmpty'),
    post: t('mod.post'),
    comment: t('mod.comment'),
    reports: t('mod.reports', { count: '{count}' }),
    reportsOne: t('mod.reportsOne'),
    anonymousAuthor: t('mod.anonymousAuthor'),
    alreadyRemoved: t('mod.alreadyRemoved'),
    open: t('mod.open'),
    approve: t('mod.approve'),
    approved: t('mod.approved'),
    remove: t('mod.remove'),
    removeReason: t('mod.removeReason'),
    removed: t('mod.removed'),
    confirm: t('mod.confirm'),
    cancel: t('mod.cancel'),
    unmask: t('mod.unmask'),
    unmaskConfirm: t('mod.unmaskConfirm'),
    unmasked: t('mod.unmasked', { handle: '{handle}' }),
    errors: communityErrors(t),
  };

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('oversight.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('oversight.intro')}</p>
        </header>

        <AdminNav base={base} permissions={permissions} current="communities" t={t} />

        <section aria-labelledby="oversight-queue" className="flex flex-col gap-2">
          <h2
            id="oversight-queue"
            className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t('oversight.queue')}
          </h2>
          {canUnmask ? (
            <p className="px-1 text-xs text-muted-foreground">{t('oversight.unmaskNote')}</p>
          ) : null}
          <ModQueue
            tenant={slug}
            canUnmask={canUnmask}
            items={(queue.ok ? queue.value : []).map((q) => ({
              itemType: q.itemType,
              itemId: q.itemId,
              communityId: q.communityId,
              communityName: q.communityName,
              href: postPath(base, q.communitySlug, q.postId, q.title),
              title: q.title,
              excerpt: q.excerpt,
              isAnonymous: q.isAnonymous,
              removed: q.removedAt !== null,
              reportCount: q.reportCount,
              reasons: q.reasons.map((r) => t(`posts.report.reason.${r}` as MessageKey)),
              reportIds: q.reportIds,
              when: relativeTime(q.lastReportedAt.toISOString(), tenant.locale),
            }))}
            labels={queueLabels}
          />
        </section>

        <section aria-labelledby="oversight-held" className="flex flex-col gap-2">
          <h2
            id="oversight-held"
            className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t('oversight.held')}
          </h2>
          <ModQueue
            tenant={slug}
            canUnmask={false}
            items={(held.ok ? held.value : []).map((h) => ({
              itemType: h.itemType,
              itemId: h.itemId,
              communityId: h.communityId,
              communityName: h.communityName,
              href: postPath(base, h.communitySlug, h.postId, h.title),
              title: h.title,
              excerpt: h.excerpt,
              isAnonymous: h.isAnonymous,
              removed: true,
              reportCount: 0,
              reasons: [t(`mod.held.${h.reason}` as MessageKey)],
              reportIds: [],
              when: relativeTime(h.heldAt.toISOString(), tenant.locale),
            }))}
            labels={{ ...queueLabels, empty: t('mod.heldEmpty'), alreadyRemoved: '' }}
          />
        </section>

        <section aria-labelledby="oversight-communities" className="flex flex-col gap-2">
          <h2
            id="oversight-communities"
            className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t('oversight.communities')}
          </h2>
          {rows.length === 0 ? (
            <EmptyState title={t('communities.empty')} />
          ) : (
            <OversightList
              tenant={slug}
              items={rows.map((c) => ({
                id: c.id,
                href: `${base}/c/${c.slug}`,
                name: c.name,
                pending: c.approvalStatus === 'pending',
                restricted: c.visibility === 'restricted',
                archived: c.archivedAt !== null,
                members: t('communities.members', { count: c.memberCount }),
                openReports:
                  c.openReports > 0 ? t('oversight.openReports', { count: c.openReports }) : null,
              }))}
              labels={{
                pending: t('oversight.pendingBadge'),
                restricted: t('oversight.restrictedBadge'),
                approve: t('oversight.approve'),
                approved: t('oversight.approved'),
                dissolve: t('oversight.dissolve'),
                dissolveReason: t('oversight.dissolveReason'),
                dissolved: t('oversight.dissolved'),
                archive: t('oversight.archive'),
                reopen: t('oversight.reopen'),
                archivedBadge: t('communities.archived'),
                toggled: t('oversight.toggled'),
                confirm: t('mod.confirm'),
                cancel: t('mod.cancel'),
                errors: communityErrors(t),
              }}
            />
          )}
        </section>
      </div>
    </PageShell>
  );
}
