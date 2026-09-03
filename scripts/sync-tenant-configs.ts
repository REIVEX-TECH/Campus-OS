import 'dotenv/config';
import { tenantConfigSchema } from '@campusos/core/tenant';
import { withMigrationClient } from '@campusos/db/migrate';
import { fileTenantConfigs } from '@campusos/tenants';

/**
 * Copy every file tenant config into the database, as the schema owner.
 *
 * Idempotent: an existing row is replaced with the file's content at the next
 * version, so running it twice changes nothing but the version. `--check` only
 * reports which tenants have a row and at what version. Read
 * docs/runbooks/tenant-config-to-db.md before running it against production.
 */
async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const configs = fileTenantConfigs.map((c) => tenantConfigSchema.parse(c));

  await withMigrationClient(async (sql) => {
    if (check) {
      const rows = await sql<{ slug: string; version: number; updated_at: Date }[]>`
        select slug, version, updated_at from tenant_configs order by slug`;
      for (const config of configs) {
        const row = rows.find((r) => r.slug === config.slug);
        console.log(
          row
            ? `${config.slug}: database, version ${row.version}, updated ${row.updated_at.toISOString()}`
            : `${config.slug}: file only`,
        );
      }
      return;
    }
    for (const config of configs) {
      await sql`
        insert into universities (slug, name, timezone, locale)
        values (${config.slug}, ${config.displayName}, ${config.timezone}, ${config.locale})
        on conflict (slug) do update
          set name = excluded.name, timezone = excluded.timezone, locale = excluded.locale,
              updated_at = now()`;
      const [row] = await sql<{ version: number }[]>`
        insert into tenant_configs (slug, config)
        values (${config.slug}, ${sql.json(config)})
        on conflict (slug) do update
          set config = excluded.config, version = tenant_configs.version + 1,
              updated_at = now(), updated_by = null
        returning version`;
      console.log(`${config.slug}: written at version ${row?.version ?? 1}`);
    }
    console.log('✓ tenant configs synced');
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
