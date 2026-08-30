import 'dotenv/config';
import { createLguSource } from '@campusos/adapter-timetable-lgu';
import { runIngestion } from '@campusos/core/ingestion';
import { sqlClient } from '@campusos/db/client';
import { TimetableSink } from '@campusos/module-timetable/sink';
import { tenantRegistry } from '@campusos/tenants';

// Composition root for LGU ingestion. Kept here (not in the adapter package) so
// the adapter stays pure with respect to the database (CLAUDE.md §4).
const tenantSlug = process.env.INGEST_TENANT ?? 'lgu';

async function main(): Promise<void> {
  const tenant = tenantRegistry.resolveBySlug(tenantSlug);
  if (!tenant) {
    console.error(`unknown tenant: ${tenantSlug}`);
    process.exit(1);
  }

  const source = createLguSource();
  const sink = new TimetableSink(tenant.slug);
  const result = await runIngestion(source, sink, { logger: (m) => console.log(m) });

  if (!result.ok) {
    console.error(`ingestion failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const { runId, stats } = result.value;
  console.log(
    `✓ ingest ${tenant.slug} run=${runId} inserted=${stats.inserted} closed=${stats.closed} ` +
      `unchanged=${stats.unchanged} unknown=${stats.unknowns}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void sqlClient.end();
  });
