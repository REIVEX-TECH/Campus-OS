import 'dotenv/config';
import { recomputeKarma } from '@campusos/module-communities/karma';

/**
 * Rebuild one tenant's karma from its votes.
 *
 * Karma is a cache of a derivation, and this is the derivation. Run it when
 * the numbers look wrong, after restoring a backup, or after changing
 * `karmaVotePerDayCap`, which changes how much of each day's voting counts and
 * so changes every total that was ever capped.
 *
 * It reads every author, including the authors of anonymous items, so it
 * connects as the owner and is not something a request can reach.
 *
 *   pnpm communities:karma -- --tenant lgu
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tenant = arg('tenant');
if (!tenant) {
  console.error('usage: communities-karma --tenant <slug>');
  process.exit(2);
}

recomputeKarma(tenant)
  .then((counted) => {
    console.log(`recomputed karma for ${tenant} from ${counted} votes`);
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
