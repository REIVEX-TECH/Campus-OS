import { translator } from '@/lib/i18n';

/**
 * The shape of a directory while its list loads: the search control and a grid
 * of cards at the real size, so the page does not jump when the names arrive.
 */
export function DirectorySkeleton({ locale = 'en' }: { locale?: string }) {
  const t = translator(locale);
  return (
    <div className="flex flex-col gap-5">
      <span className="sr-only" role="status">
        {t('a11y.loading')}
      </span>
      <div className="flex flex-col gap-1 px-1" aria-hidden="true">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>
      <div
        className="h-10 w-full max-w-sm animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
        aria-hidden="true"
      />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 9 }).map((_, i) => (
          <li key={i} className="ios-card flex items-center gap-3 rounded-2xl p-3">
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="h-3.5 w-32 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <span className="h-3 w-24 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
