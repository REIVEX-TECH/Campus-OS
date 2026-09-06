import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTenantRegistry } from '@/lib/tenants';
import { canChangeHandle, nextChangeAllowedAt } from '@campusos/module-identity/handle-rules';
import { avatarOptionPage, avatarOptionSeed } from '@campusos/module-identity/avatar-seed';
import { isVerified, membershipFor } from '@campusos/module-identity/membership';
import { effectivePermissions } from '@campusos/module-identity/rbac';
import { latestRequest } from '@campusos/module-identity/verification';
import { HandleForm } from '@/app/_components/handle-form';
import { AccountAvatarButton } from '@/app/_components/account-avatar-button';
import { PageShell } from '@/app/_components/page-shell';
import { communitiesEnabled } from '@/lib/communities';
import { SignOutButton } from '@/app/_components/sign-out-button';
import { GetVerified } from '@/app/_components/get-verified';
import { currentActor } from '@/lib/auth';
import { firstAdminSection } from '@/lib/admin-sections';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
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
    title: translator(tenant.locale)('account.heading'),
    path: `${await tenantBase(slug)}/account`,
    noIndex: true,
  });
}

/**
 * Your account: the anonymous handle and avatar everyone else sees.
 *
 * The email appears once, described as private, so it is clear which address
 * signs you in without ever suggesting it is public. Everything else on this
 * page is the public half of the identity.
 */
export default async function AccountPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);

  const actor = await currentActor();
  // Nothing here means anything signed out, and the sign in page is where the
  // reader can do something about that.
  if (!actor) redirect(`${base}/signin`);

  const changeable = canChangeHandle(actor.handleChangedAt);
  const nextAllowed = nextChangeAllowedAt(actor.handleChangedAt);
  // Private to the person and the university. Never a public badge.
  const membership = await membershipFor(actor.userId, slug);
  const verified = isVerified(membership);
  // The admin link goes wherever the person's permissions open, if anywhere.
  const adminHome = firstAdminSection(await effectivePermissions(actor.userId, slug));
  const request = verified ? null : await latestRequest(actor.userId, slug);
  // The first page of avatars, rendered with the page so the picker opens full.
  const avatarOptions = avatarOptionPage(0).map((option) => ({
    option,
    seed: avatarOptionSeed(actor.userId, option),
  }));

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('account.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('account.intro')}</p>
        </header>

        <section className="ios-card flex flex-wrap items-center gap-4 rounded-2xl p-4">
          <AccountAvatarButton
            seed={actor.avatarSeed}
            handle={actor.handle}
            options={avatarOptions}
            labels={{
              change: t('account.avatar.change'),
              title: t('account.avatar.title'),
              intro: t('account.avatar.intro'),
              preview: t('account.avatar.preview'),
              shuffle: t('account.avatar.shuffle'),
              save: t('account.avatar.save'),
              saving: t('account.avatar.saving'),
              cancel: t('account.avatar.cancel'),
              close: t('account.avatar.close'),
              failed: t('account.avatar.failed'),
              option: t('account.avatar.option'),
            }}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-lg font-semibold">{actor.handle}</p>
            <p className="text-xs text-muted-foreground">
              {t('account.emailNote', { email: actor.email })}
            </p>
            <p className="text-xs text-muted-foreground">
              {isVerified(membership)
                ? t('account.verified', { tenant: tenant.displayName })
                : t('account.notVerified', { tenant: tenant.displayName })}
            </p>
          </div>
          <div className="ml-auto">
            <SignOutButton label={t('signin.signOut')} working={t('signin.signingOut')} />
          </div>
        </section>

        <section className="ios-card flex flex-col gap-3 rounded-2xl p-4">
          <HandleForm
            handle={actor.handle}
            canChange={changeable}
            labels={{
              label: t('account.handleLabel'),
              hint: t('account.handleHint'),
              save: t('account.save'),
              saving: t('account.saving'),
              saved: t('account.saved'),
              lockedUntil: t('account.lockedUntil', {
                date: nextAllowed ? nextAllowed.toLocaleDateString(tenant.locale) : '',
              }),
              errorFormat: t('account.errorFormat'),
              errorReserved: t('account.errorReserved'),
              errorTaken: t('account.errorTaken'),
              errorTooSoon: t('account.errorTooSoon'),
            }}
          />
        </section>

        {communitiesEnabled(tenant) ? (
          <section className="ios-card flex flex-col gap-2 rounded-2xl p-4">
            <h2 className="text-sm font-semibold">{t('account.communities.heading')}</h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {(
                [
                  ['profile', `${base}/people/${actor.handle}`],
                  ['saved', `${base}/saved`],
                  ['hidden', `${base}/hidden`],
                  ['blocked', `${base}/blocked`],
                  ['notifications', `${base}/notifications`],
                ] as const
              ).map(([key, href]) => (
                <li key={key}>
                  <Link href={href} className="font-medium text-primary hover:underline">
                    {t(`account.communities.${key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {verified ? null : (
          <section
            aria-labelledby="account-verification"
            className="ios-card flex flex-col gap-3 rounded-2xl p-4"
          >
            <div className="flex flex-col gap-0.5">
              <h2 id="account-verification" className="text-base font-semibold">
                {t('account.verification.heading')}
              </h2>
              <p className="max-w-prose text-sm text-muted-foreground">
                {t('account.verification.intro')}
              </p>
            </div>
            {request?.status === 'pending' ? (
              <p className="text-sm" role="status">
                {t('account.verification.pending')}
              </p>
            ) : (
              <>
                {request?.status === 'rejected' ? (
                  <p className="text-sm text-muted-foreground">
                    {t('account.verification.rejected')}
                  </p>
                ) : null}
                <div>
                  <GetVerified />
                </div>
              </>
            )}
          </section>
        )}

        {adminHome ? (
          <p className="px-1 text-sm">
            <Link
              href={`${base}${adminHome.path}`}
              className="font-medium text-primary hover:underline"
            >
              {t('account.admin.open')}
            </Link>
          </p>
        ) : null}
      </div>
    </PageShell>
  );
}
