import Link from 'next/link';
import type { TenantConfig } from '@campusos/core/tenant';
import { TenantForm } from '@/app/_components/platform/tenant-form';
import { requirePlatformAdmin } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { tenantFormLabels } from '@/lib/tenant-form-labels';

export const dynamic = 'force-dynamic';

/** What a new university starts from. Every field is the platform admin's to change. */
const BLANK: TenantConfig = {
  slug: '',
  displayName: '',
  aliases: [],
  timezone: 'Asia/Karachi',
  locale: 'en',
  timeFormat: '12h',
  branding: { colors: { primary: '#0b5d3b' }, logoPath: '/tenants/logo.svg' },
  allowedEmailDomains: [],
  joinMode: 'domain',
  enabledModules: ['timetable'],
  moduleSettings: {},
  seo: { titleTemplate: '%s · CampusOS', description: '', keywords: [], aliases: [] },
};

/** Create a university. Platform administrators only; 404 to anyone else. */
export default async function NewTenantPage() {
  await requirePlatformAdmin();
  const t = translator('en');
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t('platform.admin.new.heading')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t('platform.admin.new.intro')}</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t('platform.admin.new.firstAdmin')}
        </p>
      </header>
      <TenantForm
        mode="create"
        initial={BLANK}
        labels={tenantFormLabels(t, t('platform.admin.create'), t('platform.admin.created'))}
      />
      <p className="text-sm">
        <Link href="/admin" className="font-medium text-primary hover:underline">
          {t('platform.admin.back')}
        </Link>
      </p>
    </main>
  );
}
