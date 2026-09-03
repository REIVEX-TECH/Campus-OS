import type { Metadata } from 'next';
import Link from 'next/link';
import { tenantRegistry } from '@campusos/tenants';
import { listMembers, listPendingRequests } from '@campusos/module-identity/verification';
import { MemberVerify } from '@/app/_components/admin/member-verify';
import { VerificationQueue } from '@/app/_components/admin/verification-queue';
import { EmptyState } from '@/app/_components/empty-state';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { PageShell } from '@/app/_components/page-shell';
import { requireTenantAdmin } from '@/lib/auth';
import { translator, type MessageKey } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('admin.verification.heading'),
    path: `${await tenantBase(slug)}/admin/verification`,
    noIndex: true,
  });
}

/**
 * The tenant admin's queue: who is asking to be verified, and who is a member.
 *
 * Gated by the tenant_admin role on a membership row, read on this request;
 * anyone else gets a 404, so the page's existence says nothing about who holds
 * the role. Every action below is re-checked on the server inside its own
 * transaction. Handles only: no email is read anywhere on this page.
 */
export default async function AdminVerificationPage({ params }: Params) {
  const { slug } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const { actor } = await requireTenantAdmin(slug);

  const [pending, members] = await Promise.all([
    listPendingRequests({ userId: actor.userId }, slug),
    listMembers({ userId: actor.userId }, slug),
  ]);
  const queue = pending.ok ? pending.value : [];
  const memberRows = members.ok ? members.value : [];
  const when = new Intl.DateTimeFormat(tenant.locale, { dateStyle: 'medium' });

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('admin.verification.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t('admin.verification.intro')}
          </p>
        </header>

        <nav aria-label={t('admin.nav.label')} className="flex flex-wrap items-center gap-2 px-1">
          <Link
            href={`${base}/admin/rooms`}
            className="ios-pressable rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {t('admin.nav.rooms')}
          </Link>
          <Link
            href={`${base}/admin/analytics`}
            className="ios-pressable rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {t('admin.nav.analytics')}
          </Link>
        </nav>

        <section aria-labelledby="admin-queue" className="flex flex-col gap-2">
          <h2
            id="admin-queue"
            className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t('admin.queue.heading')}
          </h2>
          {queue.length === 0 ? (
            <EmptyState title={t('admin.queue.empty')} />
          ) : (
            <VerificationQueue
              tenant={slug}
              items={queue.map((r) => ({
                id: r.id,
                handle: r.handle,
                avatarSeed: r.avatarSeed,
                fullName: r.fullName,
                rollNumber: r.rollNumber,
                note: r.note,
                requested: t('admin.queue.requested', { date: when.format(r.createdAt) }),
              }))}
              labels={{
                approve: t('admin.queue.approve'),
                reject: t('admin.queue.reject'),
                working: t('admin.queue.working'),
                decided: t('admin.queue.decided'),
                alreadyDecided: t('admin.queue.alreadyDecided'),
                self: t('admin.queue.self'),
                failed: t('admin.queue.failed'),
                fullName: t('admin.queue.fullName'),
                rollNumber: t('admin.queue.rollNumber'),
                note: t('admin.queue.note'),
                noProfile: t('admin.noProfile'),
              }}
            />
          )}
        </section>

        <section
          aria-labelledby="admin-verify"
          className="ios-card flex flex-col gap-3 rounded-2xl p-4"
        >
          <div className="flex flex-col gap-0.5">
            <h2 id="admin-verify" className="text-base font-semibold">
              {t('admin.verify.heading')}
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">{t('admin.verify.intro')}</p>
          </div>
          <MemberVerify
            tenant={slug}
            labels={{
              handle: t('admin.verify.handle'),
              submit: t('admin.verify.submit'),
              working: t('admin.verify.working'),
              done: t('admin.verify.done'),
              already: t('admin.verify.already'),
              notFound: t('admin.verify.notFound'),
              self: t('admin.verify.self'),
              failed: t('admin.verify.failed'),
            }}
          />
        </section>

        <section aria-labelledby="admin-members" className="flex flex-col gap-2">
          <h2
            id="admin-members"
            className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t('admin.members.heading')}
          </h2>
          {memberRows.length === 0 ? (
            <EmptyState title={t('admin.members.empty')} />
          ) : (
            <ul className="ios-card flex flex-col rounded-2xl p-2">
              {memberRows.map((m) => (
                <li key={m.userId} className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <IdentityAvatar
                    seed={m.avatarSeed}
                    label={m.handle ?? t('admin.noProfile')}
                    size={32}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate text-sm font-medium">
                      {m.handle ?? t('admin.noProfile')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t(`admin.members.role.${m.role}` as MessageKey)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {m.verifiedAt && m.status === 'active'
                      ? t('admin.members.verified')
                      : t('admin.members.unverified')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="px-1 text-sm">
          <Link href={`${base}/account`} className="font-medium text-primary hover:underline">
            {t('admin.backToAccount')}
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
