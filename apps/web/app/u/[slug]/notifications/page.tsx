import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listNotifications } from '@campusos/module-communities/notifications';
import { buttonVariants } from '@campusos/ui';
import { MarkReadButton } from '@/app/_components/communities/mark-read-button';
import { EmptyState } from '@/app/_components/empty-state';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
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

/**
 * A person's inbox: who replied, what a moderator did. Each line links to the
 * post; unread lines are bold until marked. An anonymous actor is "Someone",
 * because the row never carried them.
 */
export default async function NotificationsPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);
  const { after } = await searchParams;
  const page = await listNotifications(actor, slug, { cursor: after });
  const unread = page.items.some((n) => n.readAt === null);

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
            <h1 className="text-2xl font-bold tracking-tight">{t('notifications.heading')}</h1>
            <p className="max-w-prose text-sm text-muted-foreground">{t('notifications.intro')}</p>
          </div>
          {unread ? (
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

        {page.items.length === 0 ? (
          <EmptyState title={t('notifications.empty')} />
        ) : (
          <ol className="ios-card flex flex-col rounded-2xl p-2">
            {page.items.map((n) => {
              const who = n.actor?.handle ?? t('notifications.someone');
              const line = t(`notifications.${n.kind}` as MessageKey, { who });
              const href = n.postId
                ? postPath(base, n.communitySlug, n.postId, n.postTitle ?? '') +
                  (n.commentId ? '#comments' : '')
                : `${base}/c/${n.communitySlug}`;
              const fresh = n.readAt === null;
              return (
                <li key={n.id}>
                  <Link
                    href={href}
                    className="ios-pressable flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-muted"
                  >
                    {n.actor ? (
                      <IdentityAvatar seed={n.actor.avatarSeed} label={n.actor.handle} size={32} />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                      >
                        ?
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`text-sm ${fresh ? 'font-semibold' : ''}`}>{line}</span>
                      {n.postTitle ? (
                        <span className="truncate text-sm text-muted-foreground">
                          {n.postTitle}
                        </span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {t('notifications.in', { community: n.communityName })} ·{' '}
                        {relativeTime(n.createdAt.toISOString(), tenant.locale)}
                      </span>
                    </span>
                    {fresh ? (
                      <span
                        aria-hidden="true"
                        className="mt-2 size-2 shrink-0 rounded-full bg-primary"
                      />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        {page.nextCursor ? (
          <div className="px-1">
            <Link
              href={`${base}/notifications?after=${encodeURIComponent(page.nextCursor)}`}
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
