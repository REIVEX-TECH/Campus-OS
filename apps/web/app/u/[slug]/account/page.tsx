import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { canChangeHandle, nextChangeAllowedAt } from '@campusos/module-identity/handle-rules';
import { avatarOptionPage, avatarOptionSeed } from '@campusos/module-identity/avatar-seed';
import { isVerified, membershipFor } from '@campusos/module-identity/membership';
import { latestRequest } from '@campusos/module-identity/verification';
import { HandleForm } from '@/app/_components/handle-form';
import { AccountAvatarButton } from '@/app/_components/account-avatar-button';
import { PageShell } from '@/app/_components/page-shell';
import { SignOutButton } from '@/app/_components/sign-out-button';
import { VerificationRequestForm } from '@/app/_components/verification-request-form';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
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
  const tenant = requireTenant(slug);
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
                <VerificationRequestForm
                  tenant={slug}
                  labels={{
                    fullName: t('account.verification.fullName'),
                    rollNumber: t('account.verification.rollNumber'),
                    note: t('account.verification.note'),
                    submit: t('account.verification.submit'),
                    submitting: t('account.verification.submitting'),
                    sent: t('account.verification.sent'),
                    errorFormat: t('account.verification.errorFormat'),
                    errorOpen: t('account.verification.errorOpen'),
                    errorRate: t('account.verification.errorRate'),
                    errorVerified: t('account.verification.errorVerified'),
                    errorGeneric: t('account.verification.errorGeneric'),
                  }}
                />
              </>
            )}
          </section>
        )}

        {membership?.role === 'tenant_admin' && membership.status === 'active' ? (
          <p className="px-1 text-sm">
            <Link
              href={`${base}/admin/verification`}
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
