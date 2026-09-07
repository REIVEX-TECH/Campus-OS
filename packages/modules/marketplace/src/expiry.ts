import { sql } from 'drizzle-orm';
import { withTenant } from '@campusos/db';

/**
 * Auto-expiry sweep. An active listing past its expires_at drops out of default
 * browse by moving to 'expired'; the seller can relist it (setListingStatus back
 * to 'active') or it stays as a record. A maintenance run with no actor: it goes
 * through the tenant context, and mkt_listings' SELECT policy is tenant-based (not
 * per-user), so the UPDATE's row scan sees the tenant's rows and the sweep works
 * as a plain app-role update (unlike a participant-scoped table, which would need
 * an owner-run definer). It touches nothing else.
 */
export async function expireActiveListings(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update mkt_listings set status = 'expired', edited_at = now()
        where tenant_id = ${tenantId} and status = 'active' and deleted_at is null
          and expires_at is not null and expires_at <= now()
        returning id`)),
    ];
    return rows.length;
  });
}
