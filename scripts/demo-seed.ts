import 'dotenv/config';
import { withMigrationClient } from '@campusos/db/migrate';
import { seedDemo } from './demo/seed';

/**
 * Seed the `demo` tenant end to end: the tenant anchor + config (with its banner),
 * system roles, seeded personas, and illustrative content across every enabled
 * module. Owner-run and idempotent (`pnpm demo:seed`). See docs/runbooks/demo-tenant.md.
 */
async function main(): Promise<void> {
  await withMigrationClient(seedDemo);
  console.log('✓ seeded the demo tenant');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
