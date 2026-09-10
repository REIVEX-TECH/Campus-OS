import 'dotenv/config';
import { applyMigrations, migrationDatabaseUrl, runBaseMigrations } from '@campusos/db/migrate';
import { manifest as campusMapManifest } from '@campusos/module-campus-map/manifest';
import { manifest as communitiesManifest } from '@campusos/module-communities/manifest';
import { manifest as identityManifest } from '@campusos/module-identity/manifest';
import { manifest as lostFoundManifest } from '@campusos/module-lost-found/manifest';
import { manifest as marketplaceManifest } from '@campusos/module-marketplace/manifest';
import { manifest as messagesManifest } from '@campusos/module-messages/manifest';
import { manifest as moneyManifest } from '@campusos/module-money/manifest';
import { manifest as notificationsManifest } from '@campusos/module-notifications/manifest';
import { manifest as ridesManifest } from '@campusos/module-rides/manifest';
import { manifest as timetableManifest } from '@campusos/module-timetable/manifest';

// Base (@campusos/db) migrations run first, then each module's migrations in
// manifest order. Register a module by adding its manifest here.
const modules = [
  timetableManifest,
  identityManifest,
  communitiesManifest,
  // Notifications owns the shared table communities creates, so it runs right after.
  notificationsManifest,
  lostFoundManifest,
  messagesManifest,
  marketplaceManifest,
  moneyManifest,
  // Rides uses auth_blocked_between (communities) and public_profiles (identity),
  // both created earlier, so it runs last.
  ridesManifest,
  // Campus map references the base buildings/campuses tables (created by the base
  // migrations) and the role templates (identity), both present by now.
  campusMapManifest,
];

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
