import { sql } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';

/**
 * Rides reporting and moderation, mirroring Lost & Found (0002). Any member may
 * report a ride or a person (their own row under RLS); once open reports on a ride
 * reach the tenant threshold it auto-hides pending a moderator. Moderators — holders
 * of rides.moderate — read the queue and resolve reports through definers gated on
 * the permission, and remove a ride with a permission-checked update.
 */

export type ReportTarget = 'ride_post' | 'user';
export type ModerationRefusal = 'not_allowed' | 'not_found' | 'invalid';

async function canModerate(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = [
    ...(await tx.execute(sql`
      select 1 from auth_effective_permissions(${userId}::uuid, ${tenantId}) p
      where p.permission = 'rides.moderate' limit 1`)),
  ];
  return rows.length > 0;
}

/**
 * Report a ride or a person. Idempotent per reporter per target. When open reports
 * on a ride reach `reportThreshold`, the ride is hidden from browse pending a
 * moderator (who can dismiss to un-hide, or remove).
 */
export async function reportTarget(
  actor: { userId: string },
  tenantId: string,
  targetType: ReportTarget,
  targetId: string,
  reason: string,
  reportThreshold: number,
  note?: string,
): Promise<Result<Record<string, never>, ModerationRefusal>> {
  const r = reason.trim();
  if (r.length < 2 || r.length > 60) return err('invalid');
  if (note && note.length > 1000) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    await tx.execute(sql`
      insert into ride_reports (tenant_id, target_type, target_id, reporter_id, reason, note)
      values (${tenantId}, ${targetType}, ${targetId}::uuid, ${actor.userId}::uuid, ${r},
              ${note?.trim() ? note.trim() : null})
      on conflict (target_type, target_id, reporter_id) do nothing`);
    if (targetType === 'ride_post') {
      const [counted] = [
        ...(await tx.execute(sql`
          select count(*)::int as n from ride_reports
          where target_type = 'ride_post' and target_id = ${targetId}::uuid and status = 'open'`)),
      ] as { n: number }[];
      if ((counted?.n ?? 0) >= reportThreshold) {
        await tx.execute(sql`
          update ride_posts set hidden_at = now(), updated_at = now()
          where id = ${targetId}::uuid and tenant_id = ${tenantId}
            and hidden_at is null and removed_at is null`);
      }
    }
    return ok({});
  });
}

export interface QueueEntry {
  reportId: string;
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  note: string | null;
  createdAt: Date;
  reporterHandle: string | null;
  rideOrigin: string | null;
  rideDest: string | null;
  reportedHandle: string | null;
}

/** The open-report queue, for a moderator. Empty for anyone without the permission. */
export async function moderationQueue(
  actor: { userId: string },
  tenantId: string,
): Promise<QueueEntry[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select report_id, target_type, target_id, reason, note, created_at,
               reporter_handle, ride_origin, ride_dest, reported_handle
        from auth_rides_report_queue(${tenantId})`)),
    ] as Array<{
      report_id: string;
      target_type: string;
      target_id: string;
      reason: string;
      note: string | null;
      created_at: string | Date;
      reporter_handle: string | null;
      ride_origin: string | null;
      ride_dest: string | null;
      reported_handle: string | null;
    }>;
    return rows.map((r) => ({
      reportId: r.report_id,
      targetType: r.target_type as ReportTarget,
      targetId: r.target_id,
      reason: r.reason,
      note: r.note,
      createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
      reporterHandle: r.reporter_handle,
      rideOrigin: r.ride_origin,
      rideDest: r.ride_dest,
      reportedHandle: r.reported_handle,
    }));
  });
}

/** Dismiss the open reports on a target and un-hide a ride. Moderator only. */
export async function dismissReports(
  actor: { userId: string },
  tenantId: string,
  targetType: ReportTarget,
  targetId: string,
): Promise<Result<Record<string, never>, ModerationRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canModerate(tx, actor.userId, tenantId))) return err('not_allowed');
    await tx.execute(sql`
      select auth_rides_resolve_reports(${tenantId}, ${targetType}, ${targetId}::uuid, 'dismissed')`);
    if (targetType === 'ride_post') {
      await tx.execute(sql`
        update ride_posts set hidden_at = null, updated_at = now()
        where id = ${targetId}::uuid and tenant_id = ${tenantId}`);
    }
    return ok({});
  });
}

/** Remove a ride and resolve its reports. Moderator only. */
export async function removeRide(
  actor: { userId: string },
  tenantId: string,
  rideId: string,
  reason: string,
): Promise<Result<Record<string, never>, ModerationRefusal>> {
  const r = reason.trim();
  if (r.length < 2 || r.length > 300) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canModerate(tx, actor.userId, tenantId))) return err('not_allowed');
    const updated = [
      ...(await tx.execute(sql`
        update ride_posts
        set status = 'cancelled', removed_at = now(), removed_by = ${actor.userId}::uuid,
            removal_reason = ${r}, updated_at = now()
        where id = ${rideId}::uuid and tenant_id = ${tenantId} and removed_at is null
        returning id`)),
    ];
    if (updated.length === 0) return err('not_found');
    await tx.execute(sql`
      select auth_rides_resolve_reports(${tenantId}, 'ride_post', ${rideId}::uuid, 'removed')`);
    return ok({});
  });
}
