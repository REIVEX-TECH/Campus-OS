import 'dotenv/config';
import { sweepRides } from '@campusos/module-rides/lifecycle';

/**
 * Sweep one tenant's rides. Run it from a scheduler (see docs/runbooks/rides-sweep.md):
 * a ride past `--hours` (default 2, the module's `completeAfterHours` default) after
 * departure becomes 'completed' if it carried an accepted seat, else 'expired', and
 * each recurring offer that just ended spawns its next occurrence in the tenant
 * timezone. It prints the three counts and is idempotent, so a re-run is safe.
 *
 *   pnpm rides:sweep -- --tenant lgu
 *   pnpm rides:sweep -- --tenant lgu --hours 3
 *
 * Pass --hours to match a tenant that raised its `completeAfterHours` setting.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tenant = arg('tenant');
if (!tenant) {
  console.error('usage: rides-sweep --tenant <slug> [--hours <n>]');
  process.exit(2);
}
const hoursArg = arg('hours');
const completeAfterHours = hoursArg ? Number(hoursArg) : undefined;
if (hoursArg && (!Number.isInteger(completeAfterHours) || completeAfterHours! < 1)) {
  console.error('--hours must be a positive integer');
  process.exit(2);
}

sweepRides(tenant, completeAfterHours ? { completeAfterHours } : {})
  .then(({ completed, expired, spawned }) => {
    console.log(
      `rides sweep ${tenant}: completed ${completed}, expired ${expired}, spawned ${spawned}`,
    );
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
