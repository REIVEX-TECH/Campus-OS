import { getQueries } from '@/lib/timetable';
import { getTenantRegistry } from '@/lib/tenants';
import { evaluateIngestHealth, type TenantFreshness } from '@/lib/ingest-health';

export const dynamic = 'force-dynamic';

// Cron runs the ingest every 12h (see docs/DEPLOY-VPS.md), so a healthy last-successful
// run is at most ~12h old; the default threshold adds a two-hour buffer so a slow run does
// not false-alarm. Override with INGEST_STALE_HOURS.
const DEFAULT_STALE_HOURS = 14;

/**
 * Ingest freshness for uptime monitors (Uptime Kuma etc.): 200 when every monitored
 * tenant's last successful ingest is within the window, 503 when any is stale. The JSON
 * body lists each tenant so an alert says which one and how old. Unauthenticated and
 * side-effect free; it exposes only ingest timestamps, nothing sensitive.
 *
 * Monitored tenants: those with timetable enabled, narrowed to INGEST_HEALTH_TENANTS
 * (comma-separated slugs) when set. A tenant that has never ingested is reported but never
 * marks the check stale (there is no working ingest to have stopped).
 */
export async function GET(): Promise<Response> {
  const staleHours = Number(process.env.INGEST_STALE_HOURS) || DEFAULT_STALE_HOURS;
  const only = (process.env.INGEST_HEALTH_TENANTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const registry = await getTenantRegistry();
  const tenants = registry
    .all()
    .filter(
      (t) => t.enabledModules.includes('timetable') && (only.length === 0 || only.includes(t.slug)),
    );

  const rows: TenantFreshness[] = await Promise.all(
    tenants.map(async (t) => ({
      slug: t.slug,
      lastSuccessfulAt: (await getQueries(t.slug).freshness()).lastSuccessfulAt,
    })),
  );

  const result = evaluateIngestHealth(rows, new Date(), staleHours);
  return Response.json(result, {
    status: result.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
