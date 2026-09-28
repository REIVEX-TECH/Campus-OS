import 'dotenv/config';
import { createLguSource } from '@campusos/adapter-timetable-lgu';
import { runIngestion } from '@campusos/core/ingestion';
import { getSqlClient } from '@campusos/db/client';
import { TimetableSink } from '@campusos/module-timetable/sink';
import { tenantRegistry } from '@campusos/tenants';

// Composition root for LGU ingestion. Kept here (not in the adapter package) so
// the adapter stays pure with respect to the database (CLAUDE.md §4).
const tenantSlug = process.env.INGEST_TENANT ?? 'lgu';

/**
 * Optional push heartbeat, so a scheduler that runs this can be monitored directly (a
 * silent 22-day failure is worse than a loud one). Set INGEST_HEALTHCHECK_URL to a
 * healthchecks.io-style check URL: a successful run pings it, a failed run pings `/fail`,
 * and a check that hears nothing within its window raises the alarm. Best effort: a ping
 * that fails never fails the ingest, and no URL means no ping. Complements the pull
 * endpoint /api/health/ingest.
 */
async function pingHealthcheck(ok: boolean): Promise<void> {
  const base = process.env.INGEST_HEALTHCHECK_URL;
  if (!base) return;
  const url = ok ? base : `${base.replace(/\/+$/, '')}/fail`;
  try {
    await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    console.warn(`healthcheck ping failed: ${error instanceof Error ? error.message : error}`);
  }
}

async function main(): Promise<boolean> {
  const tenant = tenantRegistry.resolveBySlug(tenantSlug);
  if (!tenant) {
    console.error(`unknown tenant: ${tenantSlug}`);
    return false;
  }

  const source = createLguSource();
  const sink = new TimetableSink(tenant.slug);
  const result = await runIngestion(source, sink, { logger: (m) => console.log(m) });

  if (!result.ok) {
    console.error(`ingestion failed: ${result.error.message}`);
    return false;
  }

  const { runId, stats } = result.value;
  console.log(
    `✓ ingest ${tenant.slug} run=${runId} inserted=${stats.inserted} closed=${stats.closed} ` +
      `unchanged=${stats.unchanged} unknown=${stats.unknowns}`,
  );
  return true;
}

main()
  .then(async (ok) => {
    await pingHealthcheck(ok);
    if (!ok) process.exitCode = 1;
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await pingHealthcheck(false);
    process.exitCode = 1;
  })
  .finally(() => {
    void getSqlClient().end();
  });
