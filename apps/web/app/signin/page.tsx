import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { SignInButton } from '@/app/_components/sign-in-button';
import { currentActor } from '@/lib/auth';
import { firebaseWebConfig } from '@/lib/firebase-config';
import { translator } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

/**
 * Sign in on the PLATFORM host. A tenant host's /signin is rewritten to the
 * tenant's own page by middleware, so this one serves the platform host alone.
 * Signing in here joins no university; it exists so a platform administrator
 * has a door, and it looks the same to everyone.
 */
export default async function PlatformSignInPage() {
  const t = translator('en');
  if (await currentActor()) redirect('/admin');
  const config = firebaseWebConfig();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('platform.signin.heading')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t('platform.signin.intro')}</p>
      </header>
      {config ? (
        <SignInButton
          config={config}
          tenant={null}
          labels={{
            signIn: t('signin.withGoogle'),
            working: t('signin.working'),
            failed: t('signin.failed'),
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('platform.signin.notConfigured')}</p>
      )}
      <div>
        <Link className={buttonVariants({ variant: 'outline' })} href="/">
          {t('platform.admin.home')}
        </Link>
      </div>
    </main>
  );
}
