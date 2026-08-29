import { campuses, type Campus } from '../schema/tenant';
import { TenantScopedRepository } from './tenant-scoped';

export class CampusRepository extends TenantScopedRepository {
  list(): Promise<Campus[]> {
    return this.run((tx) => tx.select().from(campuses));
  }

  create(input: { name: string; code?: string | null }): Promise<Campus> {
    return this.run(async (tx) => {
      const rows = await tx
        .insert(campuses)
        .values({ tenantId: this.tenantId, name: input.name, code: input.code ?? null })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('campuses insert returned no row');
      return row;
    });
  }
}
