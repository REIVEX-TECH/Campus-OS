import 'dotenv/config';
import { expireMessages } from '@campusos/module-messages/expiry';

/**
 * Hard-delete one tenant's expired ephemeral messages. Run it often from a
 * scheduler (see docs/runbooks/messages-cleanup.md): read queries already hide
 * expired messages, this removes them from the table. It prints how many it
 * deleted and touches nothing else.
 *
 *   pnpm messages:cleanup -- --tenant lgu
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tenant = arg('tenant');
if (!tenant) {
  console.error('usage: messages-cleanup --tenant <slug>');
  process.exit(2);
}

expireMessages(tenant)
  .then(({ deleted }) => {
    console.log(`deleted ${deleted} expired message(s) in ${tenant}`);
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
