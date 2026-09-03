import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { tenantRegistry } from '@campusos/tenants';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { SignInButton, type FirebaseWebConfig } from '@/app/_components/sign-in-button';
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
    title: translator(tenant.locale)('signin.heading'),
    path: `${await tenantBase(slug)}/signin`,
    // An account page has nothing to offer a search engine.
    noIndex: true,
  });
}

/**
 * The web config the browser needs to talk to Firebase. Every value is public by
 * design: it identifies the project, it does not authorise anything. The secret
 * side of sign in is that the server verifies the returned token itself.
 */
function firebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!apiKey || !authDomain || !projectId) return null;
  return { apiKey, authDomain, projectId };
}

/**
 * Sign in, and nothing more.
 *
 * Nothing on this deployment is gated yet: timetables, free rooms, search and
 * the directories all stay open. An account exists so that the parts which do
 * need to know who you are have something to know, and so the handle you will
 * post under can be created before it is needed anywhere.
 */
export default async function SignInPage({ params }: Params) {
  const { slug } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);

  // Already signed in, so the account page is what they actually wanted.
  if (await currentActor()) redirect(`${base}/account`);

  const config = firebaseWebConfig();

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('signin.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('signin.intro')}</p>
        </header>

        {config ? (
          <div className="px-1">
            <SignInButton
              config={config}
              labels={{
                signIn: t('signin.withGoogle'),
                working: t('signin.working'),
                failed: t('signin.failed'),
              }}
            />
          </div>
        ) : (
          <EmptyState title={t('signin.notConfigured')} icon={LogIn} />
        )}
      </div>
    </PageShell>
  );
}
