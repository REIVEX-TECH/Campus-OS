import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AtSign, CalendarClock, EyeOff, LogIn, type LucideIcon } from 'lucide-react';
import { tenantRegistry } from '@campusos/tenants';
import {
  HANDLE_CHANGE_COOLDOWN_DAYS,
  HANDLE_RESERVATION_DAYS,
} from '@campusos/module-identity/handle-rules';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { ModuleIcon } from '@/app/_components/module-icon';
import { PageShell } from '@/app/_components/page-shell';
import { SignInButton } from '@/app/_components/sign-in-button';
import { currentActor } from '@/lib/auth';
import { firebaseWebConfig } from '@/lib/firebase-config';
import { translator, type MessageKey } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { MODULES } from '@/lib/modules';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/**
 * A fixed, public seed for the example avatar. It belongs to nobody, draws the
 * same picture for everyone, passes the avatar route's seed rule, needs no
 * database, and is cached immutably like any other avatar. A fresh random handle
 * on every load would read as "is this mine?", so the example is fixed and
 * labelled as one.
 */
const PREVIEW_SEED = 'signin-preview';

/** The three things a person wants answered before pressing a Google button. */
const FACTS: { key: string; Icon: LucideIcon; title: MessageKey; body: MessageKey }[] = [
  { key: 'email', Icon: EyeOff, title: 'signin.fact.email.title', body: 'signin.fact.email.body' },
  {
    key: 'handle',
    Icon: AtSign,
    title: 'signin.fact.handle.title',
    body: 'signin.fact.handle.body',
  },
  {
    key: 'change',
    Icon: CalendarClock,
    title: 'signin.fact.change.title',
    body: 'signin.fact.change.body',
  },
];

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('signin.heading'),
    path: `${await tenantBase(slug)}/signin`,
    // An account page has nothing to offer a search engine.
    noIndex: true,
  });
}

/**
 * Sign in, and what that means here.
 *
 * Nothing on this deployment is gated: timetables, free rooms, search and the
 * directories stay open. So the page shows the one thing signing in produces,
 * the same account card the account page renders once you are in, filled with
 * an example, and states the rules that govern it. It renders with no session,
 * no database and no provider, so a deployment without Firebase still explains
 * itself instead of breaking.
 */
export default async function SignInPage({ params }: Params) {
  const { slug } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);

  // Already signed in, so the account page is what they actually wanted.
  if (await currentActor()) redirect(`${base}/account`);

  const config = firebaseWebConfig();
  const example = t('signin.exampleHandle');
  const rules = { cooldown: HANDLE_CHANGE_COOLDOWN_DAYS, reserved: HANDLE_RESERVATION_DAYS };
  const later = MODULES.filter((m) => m.soon && m.needsIdentity);

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('signin.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('signin.intro')}</p>
        </header>

        {/* The card the account page shows once you are in, with an example in it. */}
        <div className="ios-card flex flex-col gap-4 rounded-2xl p-4">
          <div className="flex items-center gap-4">
            <IdentityAvatar seed={PREVIEW_SEED} label={example} size={56} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 break-words text-lg font-semibold">{example}</span>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {t('signin.exampleTag')}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">{t('signin.exampleNote')}</p>
            </div>
          </div>

          {config ? (
            <div className="flex flex-col gap-2">
              <SignInButton
                config={config}
                labels={{
                  signIn: t('signin.withGoogle'),
                  working: t('signin.working'),
                  failed: t('signin.failed'),
                }}
              />
              <p className="max-w-prose text-xs text-muted-foreground">{t('signin.popupNote')}</p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"
                aria-hidden="true"
              >
                <LogIn className="h-5 w-5" strokeWidth={2} />
              </span>
              <p className="text-sm font-medium">{t('signin.notConfigured')}</p>
            </div>
          )}
        </div>

        <section aria-labelledby="signin-facts" className="flex flex-col gap-2">
          <h2
            id="signin-facts"
            className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t('signin.factsHeading')}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-3">
            {FACTS.map(({ key, Icon, title, body }) => (
              <li key={key} className="ios-card flex flex-col gap-2 rounded-xl p-3">
                <span
                  className="grid h-9 w-9 place-items-center rounded-xl bg-muted text-foreground"
                  aria-hidden="true"
                >
                  <Icon className="h-5 w-5" strokeWidth={2} />
                </span>
                <h3 className="text-sm font-semibold">{t(title)}</h3>
                <p className="break-words text-sm text-muted-foreground">{t(body, rules)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="signin-future"
          className="ios-card flex flex-col gap-3 rounded-2xl p-4"
        >
          <div className="flex flex-col gap-0.5">
            <h2 id="signin-future" className="text-base font-semibold">
              {t('signin.futureTitle')}
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">{t('signin.futureBody')}</p>
          </div>
          {later.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {later.map((m) => (
                <li
                  key={m.key}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  <ModuleIcon name={m.icon} className="h-3.5 w-3.5" />
                  {t(`module.${m.key}.label` as MessageKey)}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <p className="px-1 text-sm">
          <Link href={`${base}/timetable`} className="font-medium text-primary hover:underline">
            {t('signin.back')}
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
