import 'dotenv/config';
import { universitiesRepository } from '@campusos/db';
import { getSqlClient } from '@campusos/db/client';
import { tenantRegistry } from '@campusos/tenants';

// Seeds a `universities` row for each configured tenant. The file-based tenant
// config is the source of truth for branding/SEO/modules; this row is the
// relational anchor that scoped tables reference by slug.
async function main(): Promise<void> {
  const tenants = tenantRegistry.all();
  for (const tenant of tenants) {
    await universitiesRepository.upsert({
      slug: tenant.slug,
      name: tenant.displayName,
      timezone: tenant.timezone,
      locale: tenant.locale,
    });
  }
  console.log(`✓ seeded ${tenants.length} tenant(s): ${tenants.map((t) => t.slug).join(', ')}`);
  await getSqlClient().end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
