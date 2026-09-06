import { sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';

/**
 * Moderation for direct messages. A moderator is not a participant, so they
 * cannot read the live thread; a report captures a SNAPSHOT of the reported
 * message and the few around it, taken here in the reporter's own context, and a
 * moderator reads that through the definers (0001), gated on messages.moderate.
 */

export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'scam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportRefusal = 'not_found' | 'invalid' | 'exists' | 'rate_limited';

interface SnapshotMessage {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface QueuedReport {
  id: string;
  messageId: string;
  conversationId: string;
  reporterId: string;
  reporterHandle: string | null;
  reason: string;
  note: string | null;
  snapshot: {
    reason: string;
    note: string | null;
    message: SnapshotMessage | null;
    context: SnapshotMessage[];
  };
  createdAt: Date;
}

/** How many reports one person may file in a rolling hour. */
const REPORTS_PER_HOUR = 20;

function toSnapshot(r: {
  id: string;
  sender_id: string;
  body: string;
  created_at: string | Date;
  deleted_at: string | Date | null;
}): SnapshotMessage {
  return {
    id: r.id,
    senderId: r.sender_id,
    body: r.deleted_at ? '' : r.body,
    createdAt: (r.created_at instanceof Date ? r.created_at : new Date(r.created_at)).toISOString(),
  };
}

/**
 * Report a message. Captures the message and the few around it (context the
 * reporter can already read) into the report, so moderation never depends on
 * reading a conversation it is not part of. One report per person per message.
 */
export async function reportMessage(
  actor: { userId: string },
  tenantId: string,
  messageId: string,
  reason: ReportReason,
  note: string | null,
): Promise<Result<{ reported: boolean }, ReportRefusal>> {
  if (!REPORT_REASONS.includes(reason)) return err('invalid');
  if (note !== null && note.length > 500) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [target] = [
      ...(await tx.execute(sql`
        select id, conversation_id, sender_id, body, created_at, deleted_at
        from msg_messages where id = ${messageId}::uuid limit 1`)),
    ] as Array<{
      id: string;
      conversation_id: string;
      sender_id: string;
      body: string;
      created_at: string | Date;
      deleted_at: string | Date | null;
    }>;
    if (!target) return err('not_found'); // RLS hides messages the actor cannot see

    const [recent] = [
      ...(await tx.execute(sql`
        select count(*)::int as n from msg_reports
        where reporter_id = ${actor.userId}::uuid and created_at > now() - interval '1 hour'`)),
    ] as { n: number }[];
    if ((recent?.n ?? 0) >= REPORTS_PER_HOUR) return err('rate_limited');

    // The reported message plus up to five before and five after, in order.
    const before = [
      ...(await tx.execute(sql`
        select id, sender_id, body, created_at, deleted_at from msg_messages
        where conversation_id = ${target.conversation_id}::uuid and created_at <= ${target.created_at}
        order by created_at desc limit 6`)),
    ] as Parameters<typeof toSnapshot>[0][];
    const after = [
      ...(await tx.execute(sql`
        select id, sender_id, body, created_at, deleted_at from msg_messages
        where conversation_id = ${target.conversation_id}::uuid and created_at > ${target.created_at}
        order by created_at asc limit 5`)),
    ] as Parameters<typeof toSnapshot>[0][];
    const context = [...before.reverse(), ...after].map(toSnapshot);
    const snapshot = { reason, note, message: toSnapshot(target), context };

    const inserted = [
      ...(await tx.execute(sql`
        insert into msg_reports (tenant_id, message_id, conversation_id, reporter_id, reason, note, snapshot)
        values (${tenantId}, ${messageId}::uuid, ${target.conversation_id}::uuid, ${actor.userId}::uuid,
                ${reason}, ${note}, ${JSON.stringify(snapshot)}::jsonb)
        on conflict (message_id, reporter_id) do nothing
        returning id`)),
    ];
    return ok({ reported: inserted.length > 0 });
  });
}

/** The open message reports of one tenant, for a moderator (definer-gated). */
export async function moderationQueue(
  actor: { userId: string },
  tenantId: string,
): Promise<QueuedReport[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select id, message_id, conversation_id, reporter_id, reporter_handle,
               reason, note, snapshot, created_at
        from auth_msg_report_queue(${tenantId})`)),
    ] as Array<{
      id: string;
      message_id: string;
      conversation_id: string;
      reporter_id: string;
      reporter_handle: string | null;
      reason: string;
      note: string | null;
      snapshot: QueuedReport['snapshot'];
      created_at: string | Date;
    }>;
    return rows.map((r) => ({
      id: r.id,
      messageId: r.message_id,
      conversationId: r.conversation_id,
      reporterId: r.reporter_id,
      reporterHandle: r.reporter_handle,
      reason: r.reason,
      note: r.note,
      snapshot: r.snapshot,
      createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    }));
  });
}

export type Resolution = 'removed' | 'dismissed';

/** Resolve the open reports on a message (removing it, or dismissing them). */
export async function resolveReports(
  actor: { userId: string },
  tenantId: string,
  messageId: string,
  resolution: Resolution,
): Promise<Result<{ resolved: number }, 'invalid'>> {
  if (resolution !== 'removed' && resolution !== 'dismissed') return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select auth_msg_resolve_reports(${tenantId}, ${messageId}::uuid, ${resolution}) as n`)),
    ] as { n: number }[];
    return ok({ resolved: row?.n ?? 0 });
  });
}

/** Whether the actor may moderate messages here (for a page gate). */
export async function canModerate(actor: { userId: string }, tenantId: string): Promise<boolean> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select 1 from auth_effective_permissions(${actor.userId}::uuid, ${tenantId})
        where permission = 'messages.moderate' limit 1`)),
    ];
    return rows.length > 0;
  });
}
