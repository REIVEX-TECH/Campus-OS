import { sql } from 'drizzle-orm';
import { withTenant } from '@campusos/db';

/**
 * Auto-expiry sweep. An open item nobody resolved eventually falls out of
 * default browse: past its `expires_at` it becomes 'expired' — still viewable by
 * direct link and in the reporter's "my items", just not in the open list. The
 * reporter can push the window out at any time (one-tap extend), and the
 * "expiring soon" badge on my-items is computed live from `expires_at`, so it
 * does not depend on this sweep having run.
 *
 * This is a maintenance run (no actor): it connects in the tenant context and
 * the permissive tenant policy admits the update, exactly like the communities
 * archive sweep. It only ever moves 'open' items whose window has passed, and
 * touches nothing else.
 *
 * Notifying the reporter through a channel (push/email) is deferred with the
 * shared notifications concern (§4, see docs/overnight/DECISIONS.md); the
 * `expiry_notified_at` column is reserved for that reminder's idempotency.
 */
export async function expireOpenItems(tenantId: string): Promise<{ expired: string[] }> {
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update lf_items
           set status = 'expired'
        where tenant_id = ${tenantId}
          and status = 'open'
          and deleted_at is null
          and expires_at is not null
          and expires_at <= now()
        returning id`)),
    ] as { id: string }[];
    return { expired: rows.map((r) => r.id) };
  });
}
