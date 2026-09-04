import 'dotenv/config';
import { archiveIdle } from '@campusos/module-communities/archive';

/**
 * Archive the communities of one tenant that nobody has posted in for a
 * while. Run it from a scheduler (see docs/runbooks/communities-archive.md)
 * with the tenant's `archiveAfterMonths`; it prints what it archived and
 * touches nothing else.
 *
 *   pnpm communities:archive -- --tenant lgu --months 6
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tenant = arg('tenant');
const months = Number(arg('months'));
if (!tenant || !Number.isInteger(months) || months < 1) {
  console.error('usage: communities-archive --tenant <slug> --months <n>');
  process.exit(2);
}

archiveIdle(tenant, months)
  .then(({ archived }) => {
    console.log(
      archived.length === 0
        ? `nothing to archive in ${tenant}`
        : `archived in ${tenant}: ${archived.join(', ')}`,
    );
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
