import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listNotifications } from '@campusos/module-communities/notifications';
import { listGenericInbox } from '@campusos/module-notifications/inbox';
import { buttonVariants } from '@campusos/ui';
import { MarkReadButton } from '@/app/_components/communities/mark-read-button';
import { EmptyState } from '@/app/_components/empty-state';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesEnabled } from '@/lib/communities';
import { postPath } from '@/lib/community-constants';
import { communityErrors } from '@/lib/community-labels';
import { relativeTime } from '@/lib/format';
import { translator, type MessageKey } from '@/lib/i18n';
import { notificationLineKey } from '@/lib/notifications';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type PageProps = Params & { searchParams: Promise<{ after?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('notifications.heading'),
    path: `${await tenantBase(slug)}/notifications`,
    noIndex: true,
  });
}

/** One line in the merged inbox, from either source, sorted by time. */
interface Row {
  id: string;
  createdAt: Date;
  fresh: boolean;
  href: string;
  line: string;
  detail: string | null;
  meta: string;
  actor: { handle: string; avatarSeed: string } | null;
}

/**
 * A person's inbox: communities activity plus everything else that notifies (L&F,
 * marketplace, services, messages), merged by time. Each line links to the thing
 * that happened; unread lines are bold until marked.
 */
export default async function NotificationsPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);
  const { after } = await searchParams;

  const communitiesOn = communitiesEnabled(tenant);
  const [community, generic] = await Promise.all([
    communitiesOn ? listNotifications(actor, slug, { cursor: after }) : null,
    listGenericInbox(actor, slug, 40),
  ]);

  const rows: Row[] = [];
  for (const n of community?.items ?? []) {
    const who = n.actor?.handle ?? t('notifications.someone');
    rows.push({
      id: n.id,
      createdAt: n.createdAt,
      fresh: n.readAt === null,
      href: n.postId
        ? postPath(base, n.communitySlug, n.postId, n.postTitle ?? '') +
          (n.commentId ? '#comments' : '')
        : `${base}/c/${n.communitySlug}`,
      line: t(`notifications.${n.kind}` as MessageKey, { who }),
      detail: n.postTitle ?? null,
      meta: t('notifications.in', { community: n.communityName }),
      actor: n.actor,
    });
  }
  for (const n of generic) {
    const who = n.actorHandle ?? t('notifications.someone');
    const title = typeof n.payload?.title === 'string' ? n.payload.title : null;
    rows.push({
      id: n.id,
      createdAt: n.createdAt,
      fresh: n.readAt === null,
      href: n.link ?? `${base}`,
      line: t(notificationLineKey(n.kind), { who }),
      detail: title,
      meta: '',
      actor: n.actorHandle ? { handle: n.actorHandle, avatarSeed: n.actorAvatarSeed ?? who } : null,
    });
  }
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const anyUnread = rows.some((r) => r.fresh);

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
            <h1 className="text-2xl font-bold tracking-tight">{t('notifications.heading')}</h1>
            <p className="max-w-prose text-sm text-muted-foreground">{t('notifications.intro')}</p>
          </div>
          {anyUnread ? (
            <MarkReadButton
              tenant={slug}
              labels={{
                markAll: t('notifications.markAll'),
                marked: t('notifications.marked'),
                errors: communityErrors(t),
              }}
            />
          ) : null}
        </header>

        {rows.length === 0 ? (
          <EmptyState title={t('notifications.empty')} />
        ) : (
          <ol className="ios-card flex flex-col rounded-2xl p-2">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.href}
                  className="ios-pressable flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-muted"
                >
                  {r.actor ? (
                    <IdentityAvatar seed={r.actor.avatarSeed} label={r.actor.handle} size={32} />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                    >
                      ?
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={`text-sm ${r.fresh ? 'font-semibold' : ''}`}>{r.line}</span>
                    {r.detail ? (
                      <span className="truncate text-sm text-muted-foreground">{r.detail}</span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {r.meta ? `${r.meta} · ` : ''}
                      {relativeTime(r.createdAt.toISOString(), tenant.locale)}
                    </span>
                  </span>
                  {r.fresh ? (
                    <span
                      aria-hidden="true"
                      className="mt-2 size-2 shrink-0 rounded-full bg-primary"
                    />
                  ) : null}
                </Link>
              </li>
            ))}
          </ol>
        )}
        {community?.nextCursor ? (
          <div className="px-1">
            <Link
              href={`${base}/notifications?after=${encodeURIComponent(community.nextCursor)}`}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              {t('notifications.more')}
            </Link>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
