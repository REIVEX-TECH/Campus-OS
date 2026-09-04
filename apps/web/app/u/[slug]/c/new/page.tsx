import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CommunityForm } from '@/app/_components/communities/community-form';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
import { communityFormLabels } from '@/lib/community-labels';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('communities.create.heading'),
    path: `${await tenantBase(slug)}/c/new`,
    noIndex: true,
  });
}

/** Start a community. Signed in to see the form; verified to submit it, which the server decides. */
export default async function NewCommunityPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  if (!(await currentActor())) redirect(`${base}/signin`);
  const settings = communitiesSettings(tenant);

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('communities.create.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t('communities.create.intro')}
          </p>
        </header>
        <div className="ios-card rounded-2xl p-4">
          <CommunityForm
            tenant={slug}
            base={base}
            mode="create"
            initial={{
              name: '',
              description: '',
              allowAnonymous: settings.anonymousPosting === 'on',
              allowedKinds: ['text', 'link'],
              visibility: 'public',
              modLogPublic: false,
              // A new community asks for nothing beyond what the university does.
              minKarmaToPost: 0,
              minKarmaToComment: 0,
              minKarmaToJoin: 0,
              minAccountAgeDays: 0,
              requireVerified: true,
            }}
            anonymousAllowedByTenant={settings.anonymousPosting === 'on'}
            labels={communityFormLabels(t, 'create')}
          />
        </div>
        <p className="px-1 text-sm">
          <Link href={`${base}/c`} className="font-medium text-primary hover:underline">
            {t('communities.back')}
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
