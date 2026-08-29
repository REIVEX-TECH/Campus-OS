import 'dotenv/config';
import { runBaseMigrations } from '@campusos/db/migrate';

// Applies base (@campusos/db) migrations first, then each enabled module's
// migrations in manifest order. Module folders are registered here as modules
// land (e.g. @campusos/module-timetable in the timetable phase).
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required to run migrations');
  process.exit(1);
}

async function main(url: string): Promise<void> {
  console.log('→ base migrations (@campusos/db)…');
  await runBaseMigrations(url);
  console.log('✓ all migrations applied');
}

main(databaseUrl).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
