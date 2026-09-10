import type { Metadata } from 'next';
import { PostRideForm } from '@/app/_components/rides/post-ride-form';
import { PageShell } from '@/app/_components/page-shell';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';
import { requireRides, ridesSettings } from '@/lib/rides';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('rides.post'),
    path: `${await tenantBase(slug)}/rides/post`,
  });
}

export default async function PostRidePage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireRides(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const settings = ridesSettings(tenant);

  return (
    <PageShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <h1 className="px-1 text-2xl font-bold tracking-tight">{t('rides.post')}</h1>
        <PostRideForm
          base={base}
          tenant={slug}
          maxSeats={settings.maxSeatsPerOffer}
          labels={{
            kind: t('rides.form.kind'),
            offer: t('rides.kind.offer'),
            request: t('rides.kind.request'),
            origin: t('rides.form.origin'),
            originPlaceholder: t('rides.form.originPlaceholder'),
            dest: t('rides.form.dest'),
            destPlaceholder: t('rides.form.destPlaceholder'),
            departAt: t('rides.form.departAt'),
            seats: t('rides.form.seats'),
            womenOnly: t('rides.womenOnly.label'),
            womenOnlyNote: t('rides.womenOnly.note'),
            notes: t('rides.form.notes'),
            notesHint: t('rides.form.notesHint'),
            optional: t('rides.form.optional'),
            submit: t('rides.form.submit'),
            submitting: t('rides.form.submitting'),
            failed: t('rides.form.failed'),
            contactInfo: t('rides.form.contactInfo'),
            past: t('rides.form.past'),
          }}
        />
      </div>
    </PageShell>
  );
}
