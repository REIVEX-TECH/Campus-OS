import Link from 'next/link';
import { Card } from '@campusos/ui';
import type { TimetableAnalytics } from '@campusos/module-timetable/read';
import { FreshnessLine } from '@/app/_components/freshness';
import { SignOutButton } from '@/app/_components/sign-out-button';
import { requireTenantAdmin } from '@/lib/auth';
import { translator, type MessageKey, type Translate } from '@/lib/i18n';
import { getQueries, requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-2xl font-bold tabular-nums tracking-tight">{value}</span>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </Card>
  );
}

/** A labelled horizontal bar. The count is shown as text, so the bar is decorative. */
function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const width = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

function CoverageRow({
  label,
  have,
  total,
  t,
}: {
  label: string;
  have: number;
  total: number;
  t: Translate;
}) {
  const pct = total === 0 ? 0 : Math.round((have / total) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t('admin.analytics.coverageMeta', { have, total, pct })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function AdminAnalyticsPage({ params }: Props) {
  const { slug } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  await requireTenantAdmin(slug);
  const base = await tenantBase(slug);
  const queries = getQueries(slug);
  const [analytics, freshness]: [
    TimetableAnalytics,
    Awaited<ReturnType<typeof queries.freshness>>,
  ] = await Promise.all([queries.analytics(), queries.freshness()]);

  const stats = [
    { key: 'terms', value: analytics.totals.terms },
    { key: 'programs', value: analytics.totals.programs },
    { key: 'sections', value: analytics.totals.sections },
    { key: 'courses', value: analytics.totals.courses },
    { key: 'teachers', value: analytics.totals.teachers },
    { key: 'rooms', value: analytics.totals.rooms },
    { key: 'classes', value: analytics.totals.entries },
  ] as const;

  const kindMax = Math.max(0, ...analytics.entriesByKind.map((k) => k.count));
  const dayMax = Math.max(0, ...analytics.entriesByDay.map((d) => d.count));
  const hasClasses = analytics.totals.entries > 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('admin.analytics.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('admin.analytics.intro')}</p>
          <FreshnessLine freshness={freshness} locale={tenant.locale} t={t} />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`${base}/admin/verification`}
            className="ios-pressable rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {t('admin.nav.verification')}
          </Link>
          <Link
            href={`${base}/admin/rooms`}
            className="ios-pressable rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {t('admin.nav.rooms')}
          </Link>
          <SignOutButton
            label={t('admin.rooms.signOut')}
            working={t('signin.signingOut')}
            redirectTo={base || '/'}
          />
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('admin.analytics.totals')}
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map((s) => (
            <li key={s.key}>
              <StatCard label={t(`admin.analytics.stat.${s.key}` as MessageKey)} value={s.value} />
            </li>
          ))}
        </ul>
      </section>

      {hasClasses ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="flex flex-col gap-3">
            <h2 className="px-1 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t('admin.analytics.coverage')}
            </h2>
            <Card className="flex flex-col gap-4 p-4">
              <CoverageRow
                label={t('admin.analytics.withTeacher')}
                have={analytics.coverage.withTeacher}
                total={analytics.coverage.entries}
                t={t}
              />
              <CoverageRow
                label={t('admin.analytics.withRoom')}
                have={analytics.coverage.withRoom}
                total={analytics.coverage.entries}
                t={t}
              />
            </Card>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="px-1 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t('admin.analytics.byKind')}
            </h2>
            <Card className="flex flex-col gap-3 p-4">
              {analytics.entriesByKind.map((k) => (
                <BarRow
                  key={k.kind}
                  label={t(`timetable.kind.${k.kind}` as MessageKey)}
                  value={k.count}
                  max={kindMax}
                />
              ))}
            </Card>
          </section>

          <section className="flex flex-col gap-3 lg:col-span-2">
            <h2 className="px-1 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t('admin.analytics.byDay')}
            </h2>
            <Card className="flex flex-col gap-3 p-4">
              {analytics.entriesByDay.map((d) => (
                <BarRow
                  key={d.dayOfWeek}
                  label={t(`timetable.dayShort.${d.dayOfWeek}` as MessageKey)}
                  value={d.count}
                  max={dayMax}
                />
              ))}
            </Card>
          </section>

          <section className="flex flex-col gap-3 lg:col-span-2">
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <li>
                <StatCard
                  label={t('admin.analytics.pendingTeachers')}
                  value={analytics.pending.teachers}
                />
              </li>
              <li>
                <StatCard
                  label={t('admin.analytics.pendingSections')}
                  value={analytics.pending.sections}
                />
              </li>
            </ul>
          </section>
        </div>
      ) : (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {t('admin.analytics.empty')}
        </Card>
      )}
    </div>
  );
}
