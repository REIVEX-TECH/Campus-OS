import { eq } from 'drizzle-orm';
import { getDb } from '../client';
import { withMigrationClient } from '../migrate';
import { universities, type NewUniversity, type University } from '../schema/tenant';

/**
 * The tenant registry table is not tenant-scoped (a row IS a tenant), so these
 * queries run without a tenant context. Used by the seed script.
 *
 * Reads go through the application pool: `universities` is public to read. The
 * WRITE goes through the owner connection, because since 0017 `universities` is
 * platform-admin-write under RLS and the application role -- which is what the
 * seed and the tests hold -- is not one. Writing a universities row is a
 * bootstrap act the owner performs, not something a request does; the tenant
 * CRUD path (`createTenant`) writes it as the acting platform admin instead.
 */
export const universitiesRepository = {
  list(): Promise<University[]> {
    return getDb().select().from(universities);
  },

  async getBySlug(slug: string): Promise<University | null> {
    const rows = await getDb()
      .select()
      .from(universities)
      .where(eq(universities.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  },

  async upsert(input: NewUniversity): Promise<University> {
    return withMigrationClient(async (client) => {
      const rows = await client<
        {
          id: string;
          slug: string;
          name: string;
          timezone: string;
          locale: string;
          created_at: Date;
          updated_at: Date;
        }[]
      >`
        insert into universities (slug, name, timezone, locale)
        values (${input.slug}, ${input.name}, ${input.timezone}, ${input.locale ?? 'en'})
        on conflict (slug) do update
          set name = excluded.name,
              timezone = excluded.timezone,
              locale = excluded.locale,
              updated_at = now()
        returning id, slug, name, timezone, locale, created_at, updated_at`;
      const row = rows[0];
      if (!row) throw new Error('universities upsert returned no row');
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        timezone: row.timezone,
        locale: row.locale,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  },
};
