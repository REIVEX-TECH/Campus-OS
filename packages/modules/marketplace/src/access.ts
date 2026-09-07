import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@campusos/db';

/** Verified, active (or lapsed-standing) member of this tenant, read in-tx. */
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
