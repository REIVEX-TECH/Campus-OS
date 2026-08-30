import 'dotenv/config';
import { applyMigrations, runBaseMigrations } from '@campusos/db/migrate';
import { manifest as timetableManifest } from '@campusos/module-timetable/manifest';

// Base (@campusos/db) migrations run first, then each module's migrations in
// manifest order. Register a module by adding its manifest here.
const modules = [timetableManifest];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required to run migrations');
  process.exit(1);
}

async function main(url: string): Promise<void> {
  console.log('→ base migrations (@campusos/db)…');
  await runBaseMigrations(url);
  for (const module of modules) {
    console.log(`→ module migrations (${module.id})…`);
    await applyMigrations(url, module.migrations.folder);
  }
  console.log('✓ all migrations applied');
}

main(databaseUrl).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
