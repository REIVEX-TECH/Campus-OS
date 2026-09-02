import { LogoMark } from '@/app/_components/logo-mark';
import { translator } from '@/lib/i18n';

// Shown while the timetable picker loads (its terms + sections + freshness reads
// are the heaviest on a tenant page). Scoped to this route on purpose: a
// route-group-wide loading boundary would stream every tenant page, which turns
// a `notFound()` / `redirect()` into a committed 200. This route never does
// either (the tenant is already resolved by the layout), so streaming is safe.
export default function Loading() {
  const t = translator('en');
  return (
    <div className="flex flex-col gap-5">
      <span className="sr-only" role="status">
        {t('a11y.loading')}
      </span>
      <div className="flex items-center gap-3" aria-hidden="true">
        <LogoMark size={28} className="shrink-0 animate-pulse motion-reduce:animate-none" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-6 w-56 max-w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}
