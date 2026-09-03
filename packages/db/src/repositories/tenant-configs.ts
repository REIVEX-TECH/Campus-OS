import { eq, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { tenantConfigs, universities } from '../schema';
import type { TenantTransaction } from '../tenant-context';

/**
 * Tenant configuration rows, and the universities row each one keys on.
 *
 * Reads need no context: the rows are readable everywhere, because they are
 * what renders a tenant's public pages. Writes run inside a caller's
 * transaction, where the row policies decide whether the actor may write at
 * all; nothing here decides that.
 */

export interface TenantConfigRow {
  slug: string;
  config: unknown;
  version: number;
  updatedAt: Date;
}

/** Every stored tenant configuration. */
export async function listTenantConfigs(): Promise<TenantConfigRow[]> {
  const rows = await getDb().select().from(tenantConfigs);
  return rows.map((r) => ({
    slug: r.slug,
    config: r.config,
    version: r.version,
    updatedAt: r.updatedAt,
  }));
}

export interface TenantIdentity {
  slug: string;
  name: string;
  timezone: string;
  locale: string;
}

/**
 * Insert the universities row a tenant's scoped tables and RLS key on. False
 * when the slug is already taken: a no-op on conflict rather than an error, so
 * two people creating the same tenant at once end with one tenant and one
 * refusal instead of an aborted transaction.
 */
export async function insertUniversity(tx: TenantTransaction, u: TenantIdentity): Promise<boolean> {
  const inserted = await tx
    .insert(universities)
    .values({ slug: u.slug, name: u.name, timezone: u.timezone, locale: u.locale })
    .onConflictDoNothing({ target: universities.slug })
    .returning({ slug: universities.slug });
  return inserted.length > 0;
}

/** Keep the universities row in step with a changed configuration. */
export async function updateUniversity(tx: TenantTransaction, u: TenantIdentity): Promise<void> {
  await tx
    .update(universities)
    .set({ name: u.name, timezone: u.timezone, locale: u.locale, updatedAt: new Date() })
    .where(eq(universities.slug, u.slug));
}

/** A tenant's configuration: a first row at version 1, or the next version of the existing one. */
export async function writeTenantConfig(
  tx: TenantTransaction,
  input: { slug: string; config: unknown; updatedBy: string | null },
): Promise<{ version: number }> {
  const [row] = await tx
    .insert(tenantConfigs)
    .values({ slug: input.slug, config: input.config, updatedBy: input.updatedBy })
    .onConflictDoUpdate({
      target: tenantConfigs.slug,
      set: {
        config: input.config,
        version: sql`${tenantConfigs.version} + 1`,
        updatedAt: new Date(),
        updatedBy: input.updatedBy,
      },
    })
    .returning({ version: tenantConfigs.version });
  return { version: row?.version ?? 1 };
}
