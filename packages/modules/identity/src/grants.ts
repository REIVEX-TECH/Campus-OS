import { sql } from 'drizzle-orm';
import { withActor } from '@campusos/db';

/**
 * Revoke (close) a platform tenant grant, as the acting user.
 *
 * `auth_revoke_tenant_grant` (0018) authorises by the grant's own admin (a
 * platform admin closing the grant they hold), a platform admin, or a tenant
 * admin with restrict-members; it is a no-op for an already-closed grant. Opening
 * a grant goes through `withPlatformGrant` in @campusos/db; this is the matching
 * close, kept here so application code never hand-writes the definer call.
 */
export async function revokeTenantGrant(
  actorUserId: string,
  grantId: string,
  reason?: string,
): Promise<void> {
  await withActor(actorUserId, (tx) =>
    tx.execute(sql`select auth_revoke_tenant_grant(${grantId}::uuid, ${reason ?? null})`),
  );
}
