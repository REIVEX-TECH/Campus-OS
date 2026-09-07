import { sql } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { marketplaceReports } from './schema/marketplace';
import { deleteListingPhotoRows } from './write';

/**
 * Reporting and moderation.
 *
 * Any member may report a listing (their own row under RLS). Moderators, holders
 * of marketplace.moderate, read the queue and resolve reports through definers that
 * gate on the permission, and remove a listing with an ordinary permission-checked
 * update. Removal also deletes the listing's photo files.
 */
export type ReportTarget = 'mkt_listing';
export type ModerationRefusal = 'not_allowed' | 'not_found' | 'invalid';

export interface QueueEntry {
  reportId: string;
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  note: string | null;
  createdAt: Date;
  reporterHandle: string | null;
  listingId: string | null;
  listingTitle: string | null;
}

async function canModerate(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = [
    ...(await tx.execute(sql`
      select 1 from auth_effective_permissions(${userId}::uuid, ${tenantId}) p
      where p.permission = 'marketplace.moderate' limit 1`)),
  ];
  return rows.length > 0;
}

/** Report a listing. Idempotent per reporter per target. */
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
      .insert(marketplaceReports)
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
          marketplaceReports.targetType,
          marketplaceReports.targetId,
          marketplaceReports.reporterId,
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
               reporter_handle, listing_id, listing_title
        from auth_mkt_report_queue(${tenantId})`)),
    ] as Array<{
      report_id: string;
      target_type: string;
      target_id: string;
      reason: string;
      note: string | null;
      created_at: string | Date;
      reporter_handle: string | null;
      listing_id: string | null;
      listing_title: string | null;
    }>;
    return rows.map((r) => ({
      reportId: r.report_id,
      targetType: r.target_type as ReportTarget,
      targetId: r.target_id,
      reason: r.reason,
      note: r.note,
      createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
      reporterHandle: r.reporter_handle,
      listingId: r.listing_id,
      listingTitle: r.listing_title,
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
      select auth_mkt_resolve_reports(${tenantId}, ${targetType}, ${targetId}::uuid, 'dismissed')`);
    return ok({});
  });
}

/** Remove a listing and resolve its reports. Moderator only. The listing's photo
 *  rows are deleted and their storage keys returned for the caller to remove the
 *  files. */
export async function removeListing(
  actor: { userId: string },
  tenantId: string,
  listingId: string,
  reason: string,
): Promise<Result<{ photoKeys: string[] }, ModerationRefusal>> {
  const r = reason.trim();
  if (r.length < 2 || r.length > 300) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canModerate(tx, actor.userId, tenantId))) return err('not_allowed');
    const updated = [
      ...(await tx.execute(sql`
        update mkt_listings
        set status = 'removed', removed_at = now(), removed_by = ${actor.userId}::uuid,
            removal_reason = ${r}, edited_at = now()
        where id = ${listingId}::uuid and tenant_id = ${tenantId} and deleted_at is null
        returning id`)),
    ];
    if (updated.length === 0) return err('not_found');
    await tx.execute(sql`
      select auth_mkt_resolve_reports(${tenantId}, 'mkt_listing', ${listingId}::uuid, 'removed')`);
    return ok({ photoKeys: await deleteListingPhotoRows(tx, listingId) });
  });
}
