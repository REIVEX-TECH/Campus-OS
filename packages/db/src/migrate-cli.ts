import { runBaseMigrations } from './migrate';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required to run migrations');
  process.exit(1);
}

runBaseMigrations(databaseUrl)
  .then(() => {
    console.log('base migrations applied');
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
