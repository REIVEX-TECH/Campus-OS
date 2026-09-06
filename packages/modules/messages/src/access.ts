import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@campusos/db';

/**
 * A verified member in good standing, read inside the caller's transaction. The
 * `standing_until <= now()` clause mirrors auth_effective_permissions (identity
 * 0014), so an expired suspension does not leave a member unable to message.
 * (This reads the shared `tenant_memberships` row in the tenant context, the same
 * way the communities and lost-found modules check verification.)
 */
export async function isVerifiedMember(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = [
    ...(await tx.execute(sql`
      select 1 from tenant_memberships
      where user_id = ${userId}::uuid and tenant_id = ${tenantId}
        and verified_at is not null
        and (status = 'active' or (standing_until is not null and standing_until <= now()))
      limit 1`)),
  ];
  return rows.length > 0;
}

/** Whether the target is a member of this tenant at all (verified or not). */
export async function isMember(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = [
    ...(await tx.execute(sql`
      select 1 from tenant_memberships
      where user_id = ${userId}::uuid and tenant_id = ${tenantId} limit 1`)),
  ];
  return rows.length > 0;
}
