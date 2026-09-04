import 'dotenv/config';
import { applyMigrations, migrationDatabaseUrl, runBaseMigrations } from '@campusos/db/migrate';
import { manifest as communitiesManifest } from '@campusos/module-communities/manifest';
import { manifest as identityManifest } from '@campusos/module-identity/manifest';
import { manifest as timetableManifest } from '@campusos/module-timetable/manifest';

// Base (@campusos/db) migrations run first, then each module's migrations in
// manifest order. Register a module by adding its manifest here.
const modules = [timetableManifest, identityManifest, communitiesManifest];

// Migrations are DDL, so they run as the schema owner rather than the runtime
// role. See docs/db-role-split.md.
const databaseUrl = migrationDatabaseUrl();

async function main(url: string): Promise<void> {
  console.log('→ base migrations (@campusos/db)…');
  await runBaseMigrations(url);
  for (const module of modules) {
    console.log(`→ module migrations (${module.id})…`);
    // Each module keeps its own bookkeeping table: drizzle applies only
    // migrations dated after the last one recorded, so a shared table makes one
    // module silently skip another's whenever their dates interleave.
    await applyMigrations(url, module.migrations.folder, module.migrations.table);
  }
  console.log('✓ all migrations applied');
}

main(databaseUrl).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
