import { and, eq, isNull } from 'drizzle-orm';
import type { TenantTransaction } from '@campusos/db';
import { buildings, campuses } from '@campusos/db/schema';
import { inferBuildingCode } from '../domain/room-key';

const DEFAULT_CAMPUS = 'Main Campus';
export const UNASSIGNED_BUILDING = 'Unassigned Building';

/** The tenant's campus, creating the default one if it has none. */
async function ensureCampus(tx: TenantTransaction, tenantId: string): Promise<string> {
  const camp = await tx
    .select({ id: campuses.id })
    .from(campuses)
    .where(and(eq(campuses.tenantId, tenantId), isNull(campuses.deletedAt)))
    .limit(1);
  if (camp[0]) return camp[0].id;
  const ins = await tx
    .insert(campuses)
    .values({ tenantId, name: DEFAULT_CAMPUS })
    .returning({ id: campuses.id });
  const campusId = ins[0]?.id;
  if (!campusId) throw new Error('campus insert returned no row');
  return campusId;
}

/**
 * Find-or-create the tenant's default "Unassigned Building", returning its id.
 * A room whose name declares no building lands here (rooms require a
 * building_id). Matched BY NAME, not "first building found", so a tenant that
 * already has real buildings still gets a dedicated unassigned one rather than
 * an arbitrary existing one. Must run inside withTenant so the RLS context is set.
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

  const campusId = await ensureCampus(tx, tenantId);
  const b = await tx
    .insert(buildings)
    .values({ tenantId, campusId, name: UNASSIGNED_BUILDING })
    .returning({ id: buildings.id });
  const buildingId = b[0]?.id;
  if (!buildingId) throw new Error('building insert returned no row');
  return buildingId;
}

/**
 * Find-or-create a building by its short code ("NB", "OB"), returning its id.
 *
 * The code is the only building signal a crawl carries, so it is what a
 * building is keyed on. The display name starts as the code itself and is the
 * tenant admin's to change in the rooms admin; a rename never touches the code,
 * so later crawls still resolve to the same building.
 */
export async function ensureBuildingByCode(
  tx: TenantTransaction,
  tenantId: string,
  code: string,
): Promise<string> {
  const existing = await tx
    .select({ id: buildings.id })
    .from(buildings)
    .where(
      and(eq(buildings.tenantId, tenantId), eq(buildings.code, code), isNull(buildings.deletedAt)),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  const campusId = await ensureCampus(tx, tenantId);
  const b = await tx
    .insert(buildings)
    .values({ tenantId, campusId, name: code, code })
    .returning({ id: buildings.id });
  const buildingId = b[0]?.id;
  if (!buildingId) throw new Error('building insert returned no row');
  return buildingId;
}

/**
 * Where a room named like this belongs: the building its trailing code names,
 * or the unassigned placeholder when the name declares none. The one decision
 * both the ingest sink and the backfill make, so they cannot make it differently.
 */
export async function ensureBuildingForRoom(
  tx: TenantTransaction,
  tenantId: string,
  roomName: string,
): Promise<string> {
  const code = inferBuildingCode(roomName);
  return code ? ensureBuildingByCode(tx, tenantId, code) : ensureUnassignedBuilding(tx, tenantId);
}
