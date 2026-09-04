import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTenantRegistry } from '@/lib/tenants';
import { standingFor } from '@campusos/module-identity/standing';
import { AppShell } from '@/app/_components/app-shell';
import { StandingNotice } from '@/app/_components/standing-notice';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { accentStyle } from '@/lib/branding';
import { tenantBase } from '@/lib/tenant-url';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return { title: 'Not found' };
  return {
    title: { default: tenant.displayName, template: tenant.seo.titleTemplate },
    description: tenant.seo.description,
    keywords: tenant.seo.keywords,
  };
}

export default async function TenantLayout({ children, params }: Params & { children: ReactNode }) {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) notFound();
  const base = await tenantBase(slug);
  // Standing gates the whole tenant, so it is answered once, here, rather than
  // by every page remembering to ask. A suspended person sees the notice and
  // nothing else; a restricted one reads on with the notice above it, because
  // taking their reading away as well would be a punishment nobody chose.
  const actor = await currentActor();
  const standing = actor ? await standingFor(actor.userId, slug) : null;
  const t = translator(tenant.locale);
  const when = new Intl.DateTimeFormat(tenant.locale, { dateStyle: 'medium' });
  const notice =
    standing && standing.status !== 'active' ? (
      <StandingNotice
        tenant={slug}
        status={standing.status}
        reason={standing.reason}
        until={standing.until ? when.format(standing.until) : null}
        appealNote={standing.appealNote}
        labels={{
          restricted: t('standing.restricted'),
          suspended: t('standing.suspended'),
          restrictedBody: t('standing.restrictedBody'),
          suspendedBody: t('standing.suspendedBody'),
          reason: t('standing.reason'),
          untilDate: t('standing.untilDate', { date: '{date}' }),
          untilLifted: t('standing.untilLifted'),
          appeal: t('standing.appeal'),
          appealPlaceholder: t('standing.appealPlaceholder'),
          appealSend: t('standing.appealSend'),
          appealSent: t('standing.appealSent'),
          appealStanding: t('standing.appealStanding'),
          failed: t('standing.failed'),
        }}
      />
    ) : null;

  // Inject the tenant accent server-side (no FOUC). The inline style carries the
  // raw light and dark inputs; the `[data-tenant]` rules in globals.css resolve
  // --primary from them per theme, so the whole subtree follows.
  return (
    <div data-tenant={tenant.slug} style={accentStyle(tenant.branding.colors.primary)}>
      <AppShell
        tenantName={tenant.displayName}
        tenantSlug={tenant.slug}
        base={base}
        locale={tenant.locale}
        enabledModules={tenant.enabledModules}
      >
        {notice ? (
          <div className="flex flex-col gap-5">
            {notice}
            {standing?.status === 'suspended' ? null : children}
          </div>
        ) : (
          children
        )}
      </AppShell>
    </div>
  );
}
