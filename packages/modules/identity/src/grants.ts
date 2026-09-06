import { sql } from 'drizzle-orm';
import {
  withActor,
  withActorInTenant,
  withTenantMutation,
  type TenantWriteContext,
} from '@campusos/db';
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
export interface TenantGrantRecord {
  grantId: string;
  /** The platform admin's public handle; never their email. */
  adminHandle: string;
  reason: string;
  openedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  /** How many transactions acted under the grant. */
  uses: number;
}

/**
 * The platform grants into this tenant, for the tenant's OWN admins to see who
 * entered and why. `auth_tenant_grants_for_tenant` (0018) reads from membership,
 * not through a grant, and requires restrict-members, so a visiting platform
 * admin gets nothing; the tenant's resident admins get the full record.
 */
export async function tenantGrantsFor(
  actorUserId: string,
  tenantId: string,
): Promise<TenantGrantRecord[]> {
  return withActorInTenant(actorUserId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(
        sql`select grant_id, admin_handle, reason, opened_at, expires_at, revoked_at, uses
            from auth_tenant_grants_for_tenant(${tenantId})`,
      )),
    ] as {
      grant_id: string;
      admin_handle: string;
      reason: string;
      opened_at: string | Date;
      expires_at: string | Date;
      revoked_at: string | Date | null;
      uses: string | number;
    }[];
    const asDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v));
    return rows.map((r) => ({
      grantId: r.grant_id,
      adminHandle: r.admin_handle,
      reason: r.reason,
      openedAt: asDate(r.opened_at),
      expiresAt: asDate(r.expires_at),
      revokedAt: r.revoked_at == null ? null : asDate(r.revoked_at),
      uses: typeof r.uses === 'number' ? r.uses : Number(r.uses),
    }));
  });
}

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
