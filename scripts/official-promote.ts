import 'dotenv/config';
import { withMigrationClient } from '@campusos/db/migrate';
import { setOfficial } from './official/promote';

/**
 * Promote (or demote) an account to a first-party official account. Owner-run,
 * because is_official is not writable by the app (identity 0035). See
 * docs/runbooks/official-account.md.
 *
 *   pnpm official:promote -- --tenant lgu --handle Some_Handle_1234
 *   pnpm official:promote -- --tenant lgu --handle Some_Handle_1234 --demote
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tenant = arg('tenant');
const handle = arg('handle');
const demote = process.argv.includes('--demote');
if (!tenant || !handle) {
  console.error('usage: official:promote --tenant <slug> --handle <handle> [--demote]');
  process.exit(2);
}

withMigrationClient((sql) => setOfficial(sql, { tenant, handle, official: !demote }))
  .then((r) => {
    console.log(
      r.official
        ? `✓ ${r.handle} is now an official account`
        : `✓ ${r.handle} is no longer an official account`,
    );
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
