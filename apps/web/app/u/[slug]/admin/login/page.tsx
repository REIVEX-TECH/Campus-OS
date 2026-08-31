import { redirect } from 'next/navigation';
import { Button, Field, Input } from '@campusos/ui';
import { adminConfigured, isAdminAuthed } from '@/lib/admin-auth';
import { translator } from '@/lib/i18n';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function AdminLoginPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { error } = await searchParams;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  if (await isAdminAuthed(slug)) redirect(`${base}/admin/rooms`);

  const errorText =
    error === 'invalid'
      ? t('admin.login.error')
      : error === 'rate'
        ? t('admin.login.rateLimited')
        : undefined;

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('admin.login.heading')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('admin.login.intro', { tenant: tenant.displayName })}
        </p>
      </div>

      {!adminConfigured() ? (
        <p className="rounded-md bg-surface p-4 text-sm text-surface-foreground">
          {t('admin.login.disabled')}
        </p>
      ) : (
        <form method="post" action={`${base}/admin/login/submit`} className="flex flex-col gap-4">
          <Field label={t('admin.login.passwordLabel')} htmlFor="secret" error={errorText}>
            <Input
              id="secret"
              name="secret"
              type="password"
              required
              autoComplete="current-password"
              aria-describedby={errorText ? 'secret-error' : undefined}
            />
          </Field>
          <Button type="submit">{t('admin.login.submit')}</Button>
        </form>
      )}
    </main>
  );
}
