import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantRegistry } from '@/lib/tenants';
import { isVerified, membershipFor } from '@campusos/module-identity/membership';
import { isVerifyPromptDismissed } from '@campusos/module-identity/verification';
import { currentActor } from '@/lib/auth';
import { JsonLd } from '@/app/_components/json-ld';
import { LogoMark } from '@/app/_components/logo-mark';
import { ModuleIcon } from '@/app/_components/module-icon';
import { PageShell } from '@/app/_components/page-shell';
import { VerifyPromptCard } from '@/app/_components/verify-prompt-card';
import { translator, type MessageKey } from '@/lib/i18n';
import { universityLd } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { MODULES } from '@/lib/modules';
import { baseUrlFromHost } from '@/lib/tenant';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({ tenant, title: tenant.displayName, path: (await tenantBase(slug)) || '/' });
}

export default async function TenantHome({ params }: Params) {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) notFound();
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const host = (await headers()).get('host') ?? '';
  const tenantUrl = `${baseUrlFromHost(host)}${base}`;

  // A gentle, dismissible nudge for a signed-in member who is not yet verified.
  // Dismissal is remembered per account, and a verified person never sees it.
  const actor = await currentActor();
  let showVerifyPrompt = false;
  if (actor) {
    const membership = await membershipFor(actor.userId, slug);
    showVerifyPrompt =
      membership !== null &&
      !isVerified(membership) &&
      !(await isVerifyPromptDismissed(actor.userId, slug));
  }

  const live = MODULES.filter((m) => !m.soon);
  // The rail card: who this is, what is here, and what it costs to read. It
  // carried only a heading and the SEO blurb before, which read as a stub.
  const rail = (
    <div className="ios-card flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-center gap-2.5">
        <LogoMark size={28} className="shrink-0" />
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-sm font-semibold text-foreground">{t('hub.about')}</h2>
          <p className="truncate text-xs text-muted-foreground">{tenant.displayName}</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{tenant.seo.description}</p>
      <ul className="flex flex-wrap gap-1.5">
        {live.map((m) => (
          <li
            key={m.key}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
          >
            <ModuleIcon name={m.icon} className="h-3.5 w-3.5" />
            {t(`module.${m.key}.label` as MessageKey)}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t('hub.aboutOpen')}</p>
    </div>
  );

  return (
    <PageShell rail={rail}>
      <JsonLd data={universityLd(tenant, tenantUrl)} />
      <div className="flex flex-col gap-5 sm:gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">{tenant.displayName}</h1>
          <p className="max-w-prose text-muted-foreground">{tenant.seo.description}</p>
        </header>

        {showVerifyPrompt ? (
          <VerifyPromptCard
            tenant={slug}
            labels={{
              heading: t('verify.prompt.heading'),
              body: t('verify.prompt.body'),
              dismiss: t('verify.prompt.dismiss'),
            }}
          />
        ) : null}

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-3">
          {MODULES.map((m) => (
            <li key={m.key}>
              <Link
                href={m.soon ? `${base}/soon/${m.key}` : `${base}${m.path ?? ''}`}
                className="ios-card ios-pressable flex h-full flex-col gap-1.5 rounded-2xl p-3.5 hover:shadow-[var(--shadow-card-strong)] sm:gap-2 sm:p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-muted text-foreground">
                    <ModuleIcon name={m.icon} className="h-5 w-5" />
                  </span>
                  {m.soon ? (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {t('modules.comingSoon')}
                    </span>
                  ) : null}
                </div>
                <span className="text-lg font-semibold">
                  {t(`module.${m.key}.label` as MessageKey)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t(`module.${m.key}.desc` as MessageKey)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </PageShell>
  );
}
