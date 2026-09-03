import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { canChangeHandle, nextChangeAllowedAt } from '@campusos/module-identity/handle-rules';
import { HandleForm } from '@/app/_components/handle-form';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { PageShell } from '@/app/_components/page-shell';
import { SignOutButton } from '@/app/_components/sign-out-button';
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

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('account.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('account.intro')}</p>
        </header>

        <section className="ios-card flex flex-wrap items-center gap-4 rounded-2xl p-4">
          <IdentityAvatar seed={actor.avatarSeed} label={actor.handle} size={56} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-lg font-semibold">{actor.handle}</p>
            <p className="text-xs text-muted-foreground">
              {t('account.emailNote', { email: actor.email })}
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
              reroll: t('account.reroll'),
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
      </div>
    </PageShell>
  );
}
