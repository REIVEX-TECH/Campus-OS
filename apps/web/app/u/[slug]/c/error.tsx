'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { translator } from '@/lib/i18n';

/**
 * The communities segment's error boundary: a card inside the shell rather
 * than the bare fallback, a retry, and a way back to the feed. Next logs the
 * error on the server; nothing about it is shown or logged here. The default
 * locale is used, as the root boundary does.
 */
export default function CommunitiesError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = translator('en');
  const pathname = usePathname();
  // Everything under /c belongs to the feed, on a path or a tenant host alike.
  const feed = pathname.slice(0, pathname.indexOf('/c') + 2);
  return (
    <div className="ios-card mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-2xl p-6 text-center">
      <h1 className="text-xl font-bold tracking-tight">{t('error.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('error.body')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className={buttonVariants({ size: 'sm' })}>
          {t('error.retry')}
        </button>
        <Link href={feed} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          {t('communities.back')}
        </Link>
      </div>
    </div>
  );
}
