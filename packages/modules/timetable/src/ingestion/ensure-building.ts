import { and, eq, isNull } from 'drizzle-orm';
import type { TenantTransaction } from '@campusos/db';
import { buildings, campuses } from '@campusos/db/schema';

const DEFAULT_CAMPUS = 'Main Campus';
const UNASSIGNED_BUILDING = 'Unassigned Building';

/**
 * Find-or-create the tenant's default "Unassigned Building", returning its id.
 * Crawled rooms carry no building, so auto-created rooms land here (rooms require
 * a building_id). Matched BY NAME, not "first building found", so a tenant that
 * already has real buildings still gets a dedicated unassigned building rather
 * than an arbitrary existing one. Reuses any existing campus, else creates the
 * default campus. Must run inside withTenant so the tenant RLS context is set.
 */
export async function ensureUnassignedBuilding(
  tx: TenantTransaction,
  tenantId: string,
): Promise<string> {
  const existing = await tx
    .select({ id: buildings.id })
    .from(buildings)
    .where(
      and(
        eq(buildings.tenantId, tenantId),
        eq(buildings.name, UNASSIGNED_BUILDING),
        isNull(buildings.deletedAt),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  const camp = await tx
    .select({ id: campuses.id })
    .from(campuses)
    .where(and(eq(campuses.tenantId, tenantId), isNull(campuses.deletedAt)))
    .limit(1);
  let campusId = camp[0]?.id;
  if (!campusId) {
    const ins = await tx
      .insert(campuses)
      .values({ tenantId, name: DEFAULT_CAMPUS })
      .returning({ id: campuses.id });
    campusId = ins[0]?.id;
    if (!campusId) throw new Error('campus insert returned no row');
  }

  const b = await tx
    .insert(buildings)
    .values({ tenantId, campusId, name: UNASSIGNED_BUILDING })
    .returning({ id: buildings.id });
  const buildingId = b[0]?.id;
  if (!buildingId) throw new Error('building insert returned no row');
  return buildingId;
}
