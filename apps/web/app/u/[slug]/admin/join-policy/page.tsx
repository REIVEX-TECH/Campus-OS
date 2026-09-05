import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminNav } from '@/app/_components/admin/admin-nav';
import { PageShell } from '@/app/_components/page-shell';
import { accessForPage } from '@/lib/tenant-access';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { requireTenant } from '@/lib/timetable';
import { getTenantRegistry } from '@/lib/tenants';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type Search = { searchParams: Promise<{ saved?: string; error?: string; blocked?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('admin.joinPolicy.heading'),
    path: `${await tenantBase(slug)}/admin/join-policy`,
    noIndex: true,
  });
}

/**
 * A tenant's auto-join policy: the mode, and the email domains that self-verify.
 *
 * Gated by `manage-members`, resolved on this request; anyone without it gets a
 * 404. The write is a definer (auth_set_join_policy) that re-checks authority
 * (this member, or a platform admin under a grant), refuses consumer providers,
 * and audits distinctly. This page only shows the current values and posts a
 * change; it never seeds admins, only members.
 */
export default async function AdminJoinPolicyPage({ params, searchParams }: Params & Search) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = await requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const { permissions } = await accessForPage(slug, 'manage-members');

  const notice = sp.saved
    ? { kind: 'ok' as const, text: t('admin.joinPolicy.saved') }
    : sp.blocked
      ? { kind: 'error' as const, text: t('admin.joinPolicy.blocked', { domain: sp.blocked }) }
      : sp.error
        ? { kind: 'error' as const, text: t('admin.joinPolicy.error') }
        : null;

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('admin.joinPolicy.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('admin.joinPolicy.intro')}</p>
        </header>

        <AdminNav base={base} permissions={permissions} current="join-policy" t={t} />

        {notice ? (
          <p
            role="status"
            className={
              notice.kind === 'ok'
                ? 'ios-card rounded-2xl px-4 py-3 text-sm font-medium text-primary'
                : 'ios-card rounded-2xl px-4 py-3 text-sm font-medium text-destructive'
            }
          >
            {notice.text}
          </p>
        ) : null}

        <form
          method="post"
          action={`${base}/admin/join-policy/save`}
          className="ios-card flex flex-col gap-5 rounded-2xl p-4"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{t('admin.joinPolicy.mode')}</legend>
            <label className="flex items-start gap-2.5">
              <input
                type="radio"
                name="joinMode"
                value="domain"
                defaultChecked={tenant.joinMode === 'domain'}
                className="mt-1"
              />
              <span className="text-sm">{t('admin.joinPolicy.mode.domain')}</span>
            </label>
            <label className="flex items-start gap-2.5">
              <input
                type="radio"
                name="joinMode"
                value="invite"
                defaultChecked={tenant.joinMode === 'invite'}
                className="mt-1"
              />
              <span className="text-sm">{t('admin.joinPolicy.mode.invite')}</span>
            </label>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="allowedEmailDomains" className="text-sm font-semibold">
              {t('admin.joinPolicy.domains')}
            </label>
            <textarea
              id="allowedEmailDomains"
              name="allowedEmailDomains"
              rows={5}
              defaultValue={tenant.allowedEmailDomains.join('\n')}
              spellCheck={false}
              autoCapitalize="none"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{t('admin.joinPolicy.domainsHelp')}</p>
          </div>

          <div>
            <button
              type="submit"
              className="ios-pressable rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              {t('admin.joinPolicy.save')}
            </button>
          </div>
        </form>

        <p className="px-1 text-sm">
          <Link href={`${base}/account`} className="font-medium text-primary hover:underline">
            {t('admin.backToAccount')}
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
