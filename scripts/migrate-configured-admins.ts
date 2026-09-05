import 'dotenv/config';
import { tenantConfigSchema } from '@campusos/core/tenant';
import { withMigrationClient } from '@campusos/db/migrate';
import { fileTenantConfigs } from '@campusos/tenants';

/**
 * One-time, owner-run migration of config-seeded tenant admins into real
 * membership rows, so `adminEmails` self-seeding can be retired afterwards.
 *
 * For every tenant's EFFECTIVE adminEmails (database config wins over the file,
 * matching the runtime registry), it seeds a `tenant_admin` membership for each
 * listed address that already has an account, via the owner-only definer
 * `auth_migrate_configured_admin` (audited `membership.migrated_from_config`).
 * Idempotent. An address with no account yet reports `no_user`: that person signs
 * in once and is granted through the roles UI (the bootstrap path).
 *
 * `--check` reports what WOULD be migrated without writing.
 *
 * Read docs/runbooks/retire-admin-emails.md before running against production.
 * Run with the OWNER connection (MIGRATION_DATABASE_URL).
 */
async function main(): Promise<void> {
  const check = process.argv.includes('--check');

  await withMigrationClient(async (sql) => {
    // Effective adminEmails per tenant: database config wins over the file.
    const effective = new Map<string, string[]>();
    for (const raw of fileTenantConfigs) {
      const c = tenantConfigSchema.parse(raw);
      effective.set(c.slug, c.adminEmails);
    }
    const dbRows = await sql<{ slug: string; config: unknown }[]>`
      select slug, config from tenant_configs`;
    for (const row of dbRows) {
      const parsed = tenantConfigSchema.safeParse(row.config);
      if (parsed.success) effective.set(row.slug, parsed.data.adminEmails);
    }

    let migrated = 0;
    let missing = 0;
    for (const [slug, emails] of effective) {
      for (const email of emails) {
        if (check) {
          console.log(`${slug}: would migrate ${email}`);
          continue;
        }
        const [r] = await sql<{ result: string }[]>`
          select auth_migrate_configured_admin(${slug}, ${email}) as result`;
        const result = r?.result ?? 'error';
        console.log(`${slug}: ${email} -> ${result}`);
        if (result === 'migrated' || result === 'upgraded') migrated += 1;
        if (result === 'no_user') missing += 1;
      }
    }

    if (check) {
      console.log('\n(dry run) nothing written.');
      return;
    }
    console.log(`\n✓ ${migrated} admin membership(s) seeded from config.`);
    if (missing > 0) {
      console.log(
        `${missing} address(es) had no account yet: they sign in once, then a ` +
          `platform admin grants them tenant_admin from the roles UI.`,
      );
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
