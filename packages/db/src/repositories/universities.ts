import { eq } from 'drizzle-orm';
import { db } from '../client';
import { universities, type NewUniversity, type University } from '../schema/tenant';

/**
 * The tenant registry table is not tenant-scoped (a row IS a tenant), so these
 * queries run without a tenant context. Used by the seed script.
 */
export const universitiesRepository = {
  list(): Promise<University[]> {
    return db.select().from(universities);
  },

  async getBySlug(slug: string): Promise<University | null> {
    const rows = await db.select().from(universities).where(eq(universities.slug, slug)).limit(1);
    return rows[0] ?? null;
  },

  async upsert(input: NewUniversity): Promise<University> {
    const rows = await db
      .insert(universities)
      .values(input)
      .onConflictDoUpdate({
        target: universities.slug,
        set: {
          name: input.name,
          timezone: input.timezone,
          locale: input.locale ?? 'en',
          updatedAt: new Date(),
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('universities upsert returned no row');
    return row;
  },
};
