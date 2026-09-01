import 'dotenv/config';
import { getSqlClient } from '@campusos/db/client';
import { AdminRoomsRepository } from '@campusos/module-timetable/repositories';
import { tenantRegistry } from '@campusos/tenants';

// One-shot backfill for the room auto-create rollout. Rooms now auto-create on
// ingest, but rooms left pending by PRIOR crawls still show TBA. This resolves
// them: it populates dedup_key on existing rooms and, for each pending room
// value, finds-or-creates the canonical room and relinks its TBA entries in
// place (content_hash recomputed, so a following ingest is a no-op).
//
// Run AFTER `pnpm db:migrate:all` (which adds rooms.dedup_key) and BEFORE the
// next ingest. Idempotent, so it is safe to run more than once. Set
// INGEST_TENANT to limit it to one tenant; otherwise every configured tenant is
// processed. All work is tenant-scoped through the repository (withTenant + RLS),
// which is why this is a script and not a migration (a migration runs with no
// tenant context, so RLS would silently touch zero rows).
const only = process.env.INGEST_TENANT;

async function main(): Promise<void> {
  const tenants = only
    ? [tenantRegistry.resolveBySlug(only)].filter((t) => t !== null)
    : tenantRegistry.all();
  if (only && tenants.length === 0) {
    console.error(`unknown tenant: ${only}`);
    process.exitCode = 1;
    return;
  }

  // Ensure rooms.dedup_key exists. On a fresh database the base migration adds
  // it, but on an already-migrated database that migration can be skipped by
  // drizzle's shared migration watermark (the base and module folders share one),
  // so create it idempotently here before the per-tenant backfill runs.
  await getSqlClient()`alter table rooms add column if not exists dedup_key text`;

  for (const tenant of tenants) {
    const r = await new AdminRoomsRepository(tenant.slug).backfillRooms();
    console.log(
      `✓ backfill ${tenant.slug} keys=${r.keysBackfilled} rooms=${r.roomsCreated} ` +
        `relinked=${r.entriesRelinked} resolved=${r.pendingResolved}`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void getSqlClient().end();
  });
