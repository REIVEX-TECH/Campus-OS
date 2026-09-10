import Link from 'next/link';
import type { RideSummary } from '@campusos/module-rides/posts';
import type { Translate } from '@/lib/i18n';

/** Time of day in the tenant timezone, e.g. "8:00 AM". */
function timeInTz(when: Date, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(when);
}

/** One ride in the browse list. The whole card links to the ride page. */
export function RideCard({
  ride,
  base,
  t,
  timezone,
  locale,
}: {
  ride: RideSummary;
  base: string;
  t: Translate;
  timezone: string;
  locale: string;
}) {
  const kindLabel = t(ride.kind === 'offer' ? 'rides.kind.offer' : 'rides.kind.request');
  const seatsLeft =
    ride.kind === 'offer' && ride.seatsAvailable !== null
      ? ride.seatsAvailable > 0
        ? t('rides.seatsLeft').replace('{n}', String(ride.seatsAvailable))
        : t('rides.full')
      : null;
  return (
    <Link
      href={`${base}/rides/${ride.id}`}
      className="ios-card ios-pressable flex flex-col gap-1.5 rounded-2xl p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            ride.kind === 'offer' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}
        >
          {kindLabel}
        </span>
        {ride.womenOnly ? (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
            {t('rides.womenOnly.badge')}
          </span>
        ) : null}
        <span className="text-[11px] text-muted-foreground">
          {timeInTz(ride.departAt, timezone, locale)}
        </span>
        {seatsLeft ? (
          <span className="ml-auto text-[11px] font-medium text-muted-foreground">{seatsLeft}</span>
        ) : null}
      </div>
      <p className="truncate text-[15px] font-semibold">
        {ride.originText} <span aria-hidden>&rarr;</span> {ride.destText}
      </p>
      {ride.authorHandle ? (
        <p className="text-[13px] text-muted-foreground">@{ride.authorHandle}</p>
      ) : null}
    </Link>
  );
}
