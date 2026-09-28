/**
 * Ingest freshness evaluation for the health endpoint (docs/DEPLOY-VPS.md).
 *
 * A silent 22-day ingest failure (cron running but not persisting) is worse than a loud
 * one, so this powers a monitorable endpoint. The freshness signal is the last SUCCESSFUL
 * `ingestion_runs` row, not `max(created_at)` on `timetable_entries`: the ingest is
 * idempotent and only inserts a new versioned row when the timetable actually changes, so
 * a stable schedule (nights, weekends, mid-semester) legitimately has no new entry for
 * days. Monitoring the last successful run instead alerts on the ingest stopping, not on
 * the timetable simply not changing.
 *
 * A tenant that has never had a successful run (lastSuccessfulAt null) is not monitored:
 * there is no working ingest that could have stopped. Only a tenant with a prior success
 * that has since gone stale is flagged. Pure so it is unit-tested directly.
 */

export interface TenantFreshness {
  slug: string;
  /** ISO timestamp of the last successful ingestion run, or null if never ingested. */
  lastSuccessfulAt: string | null;
}

export interface TenantHealth {
  slug: string;
  lastSuccessfulAt: string | null;
  ageHours: number | null;
  stale: boolean;
}

export interface IngestHealth {
  ok: boolean;
  staleHours: number;
  checkedAt: string;
  tenants: TenantHealth[];
}

export function evaluateIngestHealth(
  rows: readonly TenantFreshness[],
  now: Date,
  staleHours: number,
): IngestHealth {
  const tenants: TenantHealth[] = rows.map((r) => {
    const last = r.lastSuccessfulAt ? Date.parse(r.lastSuccessfulAt) : NaN;
    const ageHours = Number.isNaN(last) ? null : (now.getTime() - last) / 3_600_000;
    return {
      slug: r.slug,
      lastSuccessfulAt: r.lastSuccessfulAt,
      ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
      // Never-ingested (null) is not a failure to alert on; only a prior success gone stale.
      stale: ageHours !== null && ageHours > staleHours,
    };
  });
  return {
    ok: tenants.every((t) => !t.stale),
    staleHours,
    checkedAt: now.toISOString(),
    tenants,
  };
}
