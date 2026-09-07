import 'dotenv/config';
import { expireActiveListings } from '@campusos/module-marketplace/expiry';

/**
 * Expire one tenant's overdue marketplace listings. Run it from a scheduler (see
 * docs/runbooks/marketplace-expire.md): an active listing past its window becomes
 * 'expired' — out of default browse, still viewable by direct link and in the
 * seller's "my listings", where they can relist it. Prints the count.
 *
 *   pnpm marketplace:expire -- --tenant lgu
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tenant = arg('tenant');
if (!tenant) {
  console.error('usage: marketplace-expire --tenant <slug>');
  process.exit(2);
}

expireActiveListings(tenant)
  .then((count) => {
    console.log(
      count === 0 ? `nothing to expire in ${tenant}` : `expired ${count} listing(s) in ${tenant}`,
    );
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
