import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listInbox, listRequests } from '@campusos/module-messages/service';
import { EmptyState } from '@/app/_components/empty-state';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { RequestCard } from '@/app/_components/messages/request-card';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { relativeTime } from '@/lib/format';
import { translator } from '@/lib/i18n';
import { requireMessages } from '@/lib/messages';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type PageProps = Params & { searchParams: Promise<{ tab?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('messages.heading'),
    path: `${await tenantBase(slug)}/messages`,
    noIndex: true,
  });
}

/** The signed-in member's conversations and inbound requests. */
export default async function MessagesInboxPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireMessages(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const { tab } = await searchParams;
  const showRequests = tab === 'requests';
  const [conversations, requests] = await Promise.all([
    listInbox(actor.userId, slug),
    listRequests(actor.userId, slug),
  ]);

  const tabLink = (active: boolean) =>
    `ios-pressable rounded-lg px-3 py-1.5 text-sm font-semibold ${
      active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('messages.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {showRequests ? t('messages.requestsIntro') : t('messages.intro')}
          </p>
        </header>

        <nav className="flex flex-wrap gap-1 px-1" aria-label={t('messages.heading')}>
          <Link href={`${base}/messages`} className={tabLink(!showRequests)}>
            {t('messages.tab.messages')}
          </Link>
          <Link href={`${base}/messages?tab=requests`} className={tabLink(showRequests)}>
            {t('messages.tab.requests')}
            {requests.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                {requests.length}
              </span>
            ) : null}
          </Link>
        </nav>

        {showRequests ? (
          requests.length === 0 ? (
            <EmptyState title={t('messages.requestsEmpty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {requests.map((r) => (
                <RequestCard
                  key={r.id}
                  tenant={slug}
                  request={{
                    id: r.id,
                    fromHandle: r.fromHandle,
                    fromAvatarSeed: r.fromAvatarSeed,
                    fromUserId: r.fromUserId,
                    message: r.message,
                  }}
                  labels={{
                    accept: t('messages.request.accept'),
                    decline: t('messages.request.decline'),
                    block: t('messages.request.block'),
                    unknownMember: t('messages.unknownMember'),
                    noPreview: t('messages.noPreview'),
                    failed: t('messages.failed'),
                  }}
                />
              ))}
            </ul>
          )
        ) : conversations.length === 0 ? (
          <EmptyState title={t('messages.empty')} />
        ) : (
          <ul className="ios-card flex flex-col rounded-2xl p-2">
            {conversations.map((c) => {
              const name = c.otherHandle ?? t('messages.unknownMember');
              return (
                <li key={c.id}>
                  <Link
                    href={`${base}/messages/${c.id}`}
                    className="ios-pressable flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-muted"
                  >
                    <IdentityAvatar
                      seed={c.otherAvatarSeed ?? c.otherUserId}
                      label={name}
                      size={40}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-semibold">{name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {c.outbound
                          ? t('messages.request.sent')
                          : (c.lastMessagePreview ?? t('messages.noPreview'))}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {c.lastMessageAt && !c.outbound ? (
                        <span className="text-[11px] text-muted-foreground">
                          {relativeTime(c.lastMessageAt.toISOString(), tenant.locale)}
                        </span>
                      ) : null}
                      {c.unread > 0 ? (
                        <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                          {c.unread}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
