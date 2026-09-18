import 'dotenv/config';
import { withMigrationClient } from '@campusos/db/migrate';
import { resetDemo } from './demo/reset';

/**
 * Reset the `demo` tenant to its seeded, known state: wipe its content and re-seed.
 * Owner-run and idempotent (`pnpm demo:reset`). Only touches `demo`. See
 * docs/runbooks/demo-tenant.md.
 */
async function main(): Promise<void> {
  await withMigrationClient(resetDemo);
  console.log('✓ reset the demo tenant');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
