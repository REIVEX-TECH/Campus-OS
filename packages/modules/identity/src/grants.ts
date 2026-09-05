import { sql } from 'drizzle-orm';
import { withActor, withTenantMutation, type TenantWriteContext } from '@campusos/db';
import { recordAudit } from './audit';

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

/**
 * Record one audit line for a tenant-admin action in the resolved write context.
 *
 * For mutations that do NOT go through a 0019 definer (a tenant-isolated write
 * such as a room rename), this leaves the grant-attributable trail the definer
 * paths get for free: run under `withTenantMutation`, so a grant stamps its use
 * row and the `audit_log_stamp_grant` trigger stamps the line with the grant id.
 * Callers use it for the grant path, so god-mode access is always logged.
 */
export async function auditTenantAdminAction(
  actorUserId: string,
  tenantId: string,
  access: TenantWriteContext,
  entry: {
    action: string;
    targetType?: string;
    targetId?: string;
    meta?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await withTenantMutation(actorUserId, tenantId, access, (tx) =>
    recordAudit(tx, { actorUserId, tenantId, ...entry }),
  );
}
