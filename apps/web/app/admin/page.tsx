import Link from 'next/link';
import { buttonVariants } from '@campusos/ui';
import { translator } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

/**
 * Bare `/admin` on the PLATFORM host (campusos.reivex.io). A tenant host's
 * `/admin` is rewritten to /u/{slug}/admin by middleware, so this route only
 * serves the platform host (and the bare dev host). Placeholder for the future
 * platform super-admin (the identity module); it exists so `/admin` is not a 404.
 */
export default function PlatformAdmin() {
  const t = translator('en');
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight">{t('platform.admin.heading')}</h1>
        <p className="max-w-prose text-base text-muted-foreground">{t('platform.admin.body')}</p>
      </header>
      <div>
        <Link className={buttonVariants({ variant: 'outline' })} href="/">
          {t('platform.admin.home')}
        </Link>
      </div>
    </main>
  );
}
