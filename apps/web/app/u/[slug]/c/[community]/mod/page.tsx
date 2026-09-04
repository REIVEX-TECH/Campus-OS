import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { communityBySlug } from '@campusos/module-communities/communities';
import { listModLog, listQueue } from '@campusos/module-communities/queue';
import { buttonVariants } from '@campusos/ui';
import { ModLog } from '@/app/_components/communities/mod-log';
import { ModQueue } from '@/app/_components/communities/mod-queue';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
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

type Params = { params: Promise<{ slug: string; community: string }> };
type PageProps = Params & { searchParams: Promise<{ tab?: string; after?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, community } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  const c = await communityBySlug(slug, community);
  if (!c) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('mod.heading', { name: c.name }),
    path: `${await tenantBase(slug)}/c/${c.slug}/mod`,
    noIndex: true,
  });
}

/**
 * A community's mod tools: the queue of open reports and the log of what was
 * done. Anyone without `communities.moderate` here (or oversight in the
 * tenant) gets a 404, the same page a stranger sees for a community that does
 * not exist. Revealing an anonymous author is not offered here; that belongs
 * to the tenant's oversight page and its permission.
 */
export default async function ModPage({ params, searchParams }: PageProps) {
  const { slug, community: communitySlug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const community = await communityBySlug(slug, communitySlug);
  if (!community) notFound();
  const actor = await currentActor();
  if (!actor) notFound();
  const queue = await listQueue(actor, slug, community.id);
  if (!queue.ok) notFound();
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const query = await searchParams;
  const tab = query.tab === 'log' ? 'log' : 'queue';
  const log =
    tab === 'log' ? await listModLog(actor, slug, community.id, { cursor: query.after }) : null;
  const here = `${base}/c/${community.slug}/mod`;

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{community.name}</p>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('mod.heading', { name: community.name })}
          </h1>
        </header>
        <nav aria-label={t('mod.tools')} className="flex flex-wrap gap-1 px-1">
          {(['queue', 'log'] as const).map((k) => (
            <Link
              key={k}
              href={k === 'queue' ? here : `${here}?tab=log`}
              aria-current={k === tab ? 'page' : undefined}
              className={`ios-pressable rounded-lg px-3 py-1.5 text-sm font-semibold ${
                k === tab
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`mod.tab.${k}` as MessageKey)}
            </Link>
          ))}
          <Link
            href={`${base}/c/${community.slug}/members`}
            className="ios-pressable rounded-lg px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            {t('mod.sanction.heading')}
          </Link>
        </nav>

        {tab === 'queue' ? (
          <ModQueue
            tenant={slug}
            canUnmask={false}
            items={queue.value.map((q) => ({
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
            labels={{
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
            }}
          />
        ) : log?.ok ? (
          <>
            <ModLog
              entries={log.value.items}
              base={base}
              communitySlug={community.slug}
              locale={tenant.locale}
              isModerator
              t={t}
            />
            {log.value.nextCursor ? (
              <div className="px-1">
                <Link
                  href={`${here}?tab=log&after=${encodeURIComponent(log.value.nextCursor)}`}
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                >
                  {t('mod.logMore')}
                </Link>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
