import { eq } from 'drizzle-orm';
import { rooms, type Room } from '../schema/tenant';
import { TenantScopedRepository } from './tenant-scoped';

export class RoomRepository extends TenantScopedRepository {
  list(): Promise<Room[]> {
    return this.run((tx) => tx.select().from(rooms));
  }

  /**
   * Query rooms with an explicit tenant_id filter. Under another tenant's
   * context this returns nothing — RLS ANDs its own predicate, so a forged
   * tenant_id cannot leak rows. Exists to prove isolation; app code must never
   * pass a tenant_id filter.
   */
  listByTenantIdFilter(tenantId: string): Promise<Room[]> {
    return this.run((tx) => tx.select().from(rooms).where(eq(rooms.tenantId, tenantId)));
  }

  create(input: { buildingId: string; name: string; capacity?: number | null }): Promise<Room> {
    return this.run(async (tx) => {
      const rows = await tx
        .insert(rooms)
        .values({
          tenantId: this.tenantId,
          buildingId: input.buildingId,
          name: input.name,
          capacity: input.capacity ?? null,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('rooms insert returned no row');
      return row;
    });
  }
}
