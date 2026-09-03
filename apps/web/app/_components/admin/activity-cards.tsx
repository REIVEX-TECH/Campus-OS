import { Card } from '@campusos/ui';
import type { TenantActivity } from '@campusos/module-identity/analytics';
import { scaleToPercent } from '@/lib/activity-format';
import type { Translate } from '@/lib/i18n';
import { roleDisplayName } from '@/lib/role-names';
import { BarRow, StatCard } from './analytics-parts';

/**
 * The people side of the dashboard: how many, how recently, by role, and the
 * verification queue. Timing only. The chart is decorative; each day carries
 * its numbers as text for a screen reader.
 */
export function ActivityCards({
  activity,
  days,
  locale,
  t,
}: {
  activity: TenantActivity;
  days: number;
  locale: string;
  t: Translate;
}) {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const signIns = scaleToPercent(activity.days.map((d) => d.signIns));
  const lastActive = scaleToPercent(activity.days.map((d) => d.lastActive));
  const roleMax = Math.max(0, ...activity.byRole.map((r) => r.members));
  const oldest = activity.queue.oldestPendingAt;
  const waitedDays = oldest ? Math.floor((Date.now() - oldest.getTime()) / 86_400_000) : null;

  return (
    <>
      <section aria-labelledby="admin-people" className="flex flex-col gap-3">
        <h2
          id="admin-people"
          className="px-1 text-sm font-medium uppercase tracking-wide text-muted-foreground"
        >
          {t('admin.analytics.people')}
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <li>
            <StatCard label={t('admin.analytics.stat.members')} value={activity.totals.members} />
          </li>
          <li>
            <StatCard
              label={t('admin.analytics.stat.activeDay')}
              value={activity.totals.activeDay}
            />
          </li>
          <li>
            <StatCard
              label={t('admin.analytics.stat.activeWeek')}
              value={activity.totals.activeWeek}
            />
          </li>
          <li>
            <StatCard
              label={t('admin.analytics.stat.activeMonth')}
              value={activity.totals.activeMonth}
            />
          </li>
        </ul>
      </section>

      <section aria-labelledby="admin-signins" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5 px-1">
          <h2
            id="admin-signins"
            className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
          >
            {t('admin.analytics.signIns', { days })}
          </h2>
          <p className="max-w-prose text-xs text-muted-foreground">
            {t('admin.analytics.signInsIntro')}
          </p>
        </div>
        <Card className="flex flex-col gap-3 p-4">
          <ol
            className="grid h-28 items-end gap-1"
            style={{ gridTemplateColumns: `repeat(${activity.days.length}, minmax(0, 1fr))` }}
          >
            {activity.days.map((d, i) => {
              const when = new Date(`${d.day}T00:00:00`);
              return (
                <li key={d.day} className="flex h-full flex-col justify-end gap-1">
                  <span className="sr-only">
                    {t('admin.analytics.dayPoint', {
                      date: date.format(when),
                      signIns: d.signIns,
                      active: d.lastActive,
                    })}
                  </span>
                  <div className="flex h-full items-end justify-center gap-0.5" aria-hidden="true">
                    <div
                      className="w-full max-w-3 rounded-t-sm bg-primary"
                      style={{ height: `${signIns[i]}%` }}
                    />
                    <div
                      className="w-full max-w-3 rounded-t-sm bg-muted-foreground/30"
                      style={{ height: `${lastActive[i]}%` }}
                    />
                  </div>
                  <span
                    className="truncate text-center text-[10px] text-muted-foreground"
                    aria-hidden="true"
                  >
                    {weekday.format(when).slice(0, 2)}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-primary" />
              {t('admin.analytics.legendSignIns')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-muted-foreground/30" />
              {t('admin.analytics.legendActive')}
            </span>
          </div>
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section aria-labelledby="admin-by-role" className="flex flex-col gap-3">
          <h2
            id="admin-by-role"
            className="px-1 text-sm font-medium uppercase tracking-wide text-muted-foreground"
          >
            {t('admin.analytics.byRole')}
          </h2>
          <Card className="flex flex-col gap-3 p-4">
            {activity.byRole.map((r) => (
              <BarRow key={r.key} label={roleDisplayName(r, t)} value={r.members} max={roleMax} />
            ))}
          </Card>
        </section>

        <section aria-labelledby="admin-queue-stats" className="flex flex-col gap-3">
          <h2
            id="admin-queue-stats"
            className="px-1 text-sm font-medium uppercase tracking-wide text-muted-foreground"
          >
            {t('admin.analytics.queue')}
          </h2>
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-2xl font-bold tabular-nums tracking-tight">
              {activity.queue.pending}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {t('admin.analytics.queuePending')}
            </span>
            <p className="pt-2 text-sm text-muted-foreground">
              {waitedDays === null
                ? t('admin.analytics.queueNone')
                : t('admin.analytics.queueOldest', { days: waitedDays })}
            </p>
          </Card>
        </section>
      </div>
    </>
  );
}
