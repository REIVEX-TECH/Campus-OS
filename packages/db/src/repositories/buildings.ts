import { buildings, type Building } from '../schema/tenant';
import { TenantScopedRepository } from './tenant-scoped';

export class BuildingRepository extends TenantScopedRepository {
  list(): Promise<Building[]> {
    return this.run((tx) => tx.select().from(buildings));
  }

  create(input: { campusId: string; name: string; code?: string | null }): Promise<Building> {
    return this.run(async (tx) => {
      const rows = await tx
        .insert(buildings)
        .values({
          tenantId: this.tenantId,
          campusId: input.campusId,
          name: input.name,
          code: input.code ?? null,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('buildings insert returned no row');
      return row;
    });
  }
}
