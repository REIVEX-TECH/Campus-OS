import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TenantForm } from '@/app/_components/platform/tenant-form';
import { requirePlatformAdmin } from '@/lib/auth';
import { translator, type MessageKey } from '@/lib/i18n';
import { tenantFormLabels } from '@/lib/tenant-form-labels';
import { getTenantRegistry, tenantConfigSources } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/**
 * Edit a university. Platform administrators only; 404 to anyone else, and to
 * a slug the registry does not know. Saving writes the database row, which is
 * how a file tenant moves into the database.
 */
export default async function EditTenantPage({ params }: Params) {
  await requirePlatformAdmin();
  const { slug } = await params;
  const t = translator('en');
  const [registry, sources] = await Promise.all([getTenantRegistry(), tenantConfigSources()]);
  const tenant = registry.resolveBySlug(slug);
  if (!tenant || tenant.slug !== slug) notFound();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {t('platform.admin.edit.heading', { name: tenant.displayName })}
          </h1>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {t(`platform.admin.source.${sources.get(slug) ?? 'file'}` as MessageKey)}
          </span>
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t('platform.admin.edit.intro')}
        </p>
      </header>
      <TenantForm
        mode="edit"
        initial={tenant}
        labels={tenantFormLabels(t, t('platform.admin.save'), t('platform.admin.saved'))}
      />
      <p className="text-sm">
        <Link href="/admin" className="font-medium text-primary hover:underline">
          {t('platform.admin.back')}
        </Link>
      </p>
    </main>
  );
}
