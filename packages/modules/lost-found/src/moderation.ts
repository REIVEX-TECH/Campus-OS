import { sql } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { lostFoundReports } from './schema/lost-found';
import { deleteItemPhotoRows } from './write';

/**
 * Reporting and moderation.
 *
 * Any member may report an item or a claim (their own row under RLS). Moderators
 * — holders of lostfound.moderate — read the queue and resolve reports through
 * definers that gate on the permission, and remove an item with an ordinary
 * permission-checked update.
 */
export type ReportTarget = 'lf_item' | 'lf_claim';
export type ModerationRefusal = 'not_allowed' | 'not_found' | 'invalid';

export interface QueueEntry {
  reportId: string;
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  note: string | null;
  createdAt: Date;
  reporterHandle: string | null;
  itemId: string | null;
  itemTitle: string | null;
  claimMessage: string | null;
}

async function canModerate(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = [
    ...(await tx.execute(sql`
      select 1 from auth_effective_permissions(${userId}::uuid, ${tenantId}) p
      where p.permission = 'lostfound.moderate' limit 1`)),
  ];
  return rows.length > 0;
}

/** Report an item or claim. Idempotent per reporter per target. */
export async function reportTarget(
  actor: { userId: string },
  tenantId: string,
  targetType: ReportTarget,
  targetId: string,
  reason: string,
  note?: string,
): Promise<Result<Record<string, never>, ModerationRefusal>> {
  const r = reason.trim();
  if (r.length < 2 || r.length > 60) return err('invalid');
  if (note && note.length > 1000) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    await tx
      .insert(lostFoundReports)
      .values({
        tenantId,
        targetType,
        targetId,
        reporterId: actor.userId,
        reason: r,
        note: note?.trim() ? note.trim() : null,
      })
      .onConflictDoNothing({
        target: [
          lostFoundReports.targetType,
          lostFoundReports.targetId,
          lostFoundReports.reporterId,
        ],
      });
    return ok({});
  });
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
               reporter_handle, item_id, item_title, claim_message
        from auth_lf_report_queue(${tenantId})`)),
    ] as Array<{
      report_id: string;
      target_type: string;
      target_id: string;
      reason: string;
      note: string | null;
      created_at: string | Date;
      reporter_handle: string | null;
      item_id: string | null;
      item_title: string | null;
      claim_message: string | null;
    }>;
    return rows.map((r) => ({
      reportId: r.report_id,
      targetType: r.target_type as ReportTarget,
      targetId: r.target_id,
      reason: r.reason,
      note: r.note,
      createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
      reporterHandle: r.reporter_handle,
      itemId: r.item_id,
      itemTitle: r.item_title,
      claimMessage: r.claim_message,
    }));
  });
}

/** Dismiss the open reports on a target without removing it. Moderator only. */
export async function dismissReports(
  actor: { userId: string },
  tenantId: string,
  targetType: ReportTarget,
  targetId: string,
): Promise<Result<Record<string, never>, ModerationRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canModerate(tx, actor.userId, tenantId))) return err('not_allowed');
    await tx.execute(sql`
      select auth_lf_resolve_reports(${tenantId}, ${targetType}, ${targetId}::uuid, 'dismissed')`);
    return ok({});
  });
}

/** Remove an item and resolve its reports. Moderator only. The item is down for
 *  good, so its photo ROWS are deleted and the storage keys returned for the caller
 *  to remove from object storage. */
export async function removeItem(
  actor: { userId: string },
  tenantId: string,
  itemId: string,
  reason: string,
): Promise<Result<{ photoKeys: string[] }, ModerationRefusal>> {
  const r = reason.trim();
  if (r.length < 2 || r.length > 300) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canModerate(tx, actor.userId, tenantId))) return err('not_allowed');
    const updated = [
      ...(await tx.execute(sql`
        update lf_items
        set status = 'removed', removed_at = now(), removed_by = ${actor.userId}::uuid,
            removal_reason = ${r}, edited_at = now()
        where id = ${itemId}::uuid and tenant_id = ${tenantId} and deleted_at is null
        returning id`)),
    ];
    if (updated.length === 0) return err('not_found');
    await tx.execute(sql`
      select auth_lf_resolve_reports(${tenantId}, 'lf_item', ${itemId}::uuid, 'removed')`);
    return ok({ photoKeys: await deleteItemPhotoRows(tx, itemId) });
  });
}
