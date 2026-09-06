import 'dotenv/config';
import { expireOpenItems } from '@campusos/module-lost-found/expiry';

/**
 * Expire one tenant's overdue Lost & Found items. Run it from a scheduler (see
 * docs/runbooks/lost-found-expire.md): an open item past its window becomes
 * 'expired' — out of default browse, still viewable by direct link and in the
 * reporter's "my items". It prints what it expired and touches nothing else.
 *
 *   pnpm lostfound:expire -- --tenant lgu
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tenant = arg('tenant');
if (!tenant) {
  console.error('usage: lost-found-expire --tenant <slug>');
  process.exit(2);
}

expireOpenItems(tenant)
  .then(({ expired }) => {
    console.log(
      expired.length === 0
        ? `nothing to expire in ${tenant}`
        : `expired ${expired.length} item(s) in ${tenant}`,
    );
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
