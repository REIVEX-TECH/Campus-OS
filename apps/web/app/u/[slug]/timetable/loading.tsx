import { translator } from '@/lib/i18n';

// Shown while the timetable picker loads (its terms + sections + freshness reads
// are the heaviest on a tenant page). Scoped to this route on purpose: a
// route-group-wide loading boundary would stream every tenant page, which turns
// a `notFound()` / `redirect()` into a committed 200. This route never does
// either (the tenant is already resolved by the layout), so streaming is safe.
export default function Loading() {
  const t = translator('en');
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only" role="status">
        {t('a11y.loading')}
      </span>
      <div className="flex flex-col gap-2" aria-hidden="true">
        <div className="h-8 w-64 max-w-full animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
