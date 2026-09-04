import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { listBlocked } from '@campusos/module-communities/blocks';
import { BlockButton } from '@/app/_components/communities/block-button';
import { EmptyState } from '@/app/_components/empty-state';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { requireCommunities } from '@/lib/communities';
import { communityErrors } from '@/lib/community-labels';
import { translator } from '@/lib/i18n';
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
    title: translator(tenant.locale)('blocked.heading'),
    path: `${await tenantBase(slug)}/blocked`,
    noIndex: true,
  });
}

/** Who this person has blocked, and a way back. Their own list; nobody else's. */
export default async function BlockedPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);
  const blocked = await listBlocked(actor, slug);
  const when = new Intl.DateTimeFormat(tenant.locale, { dateStyle: 'medium' });
  const button =
    'ios-pressable inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('blocked.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('blocked.intro')}</p>
        </header>
        {blocked.length === 0 ? (
          <EmptyState title={t('blocked.none')} />
        ) : (
          <ul className="ios-card flex flex-col rounded-2xl p-2">
            {blocked.map((b) => (
              <li key={b.userId} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <IdentityAvatar seed={b.avatarSeed} label={b.handle} size={32} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-medium">{b.handle}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('blocked.since', { date: when.format(b.since) })}
                  </p>
                </div>
                <BlockButton
                  tenant={slug}
                  userId={b.userId}
                  blocked
                  labels={{
                    block: t('posts.block', { handle: b.handle }),
                    unblock: t('blocked.unblock'),
                    done: t('posts.blocked'),
                    errors: communityErrors(t),
                  }}
                  className={button}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
