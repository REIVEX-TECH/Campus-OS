'use client';

import Link from 'next/link';
import { buttonVariants } from '@campusos/ui';
import { translator } from '@/lib/i18n';
import { ApplyTheme } from './_components/apply-theme';

/**
 * Segment error boundary. Renders inside the root layout, so a runtime error
 * shows a clean themed page instead of a bare fallback. `reset()` retries the
 * render. Next already logs the error server-side; we do not log it here (no
 * client logging of error details). The default locale is used (this can fire
 * outside a tenant).
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = translator('en');
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <ApplyTheme />
      <h1 className="text-3xl font-bold tracking-tight">{t('error.title')}</h1>
      <p className="max-w-prose text-muted-foreground">{t('error.body')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className={buttonVariants()}>
          {t('error.retry')}
        </button>
        <Link className={buttonVariants({ variant: 'outline' })} href="/">
          {t('error.home')}
        </Link>
      </div>
    </main>
  );
}
