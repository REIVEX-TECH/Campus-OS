import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { canInCommunity, canInTenant, isVerifiedMember, LIMITS, type Refusal } from './access';
import {
  commentsRead,
  communityBans,
  moderationActions,
  postsRead,
  reports,
} from './schema/communities';

/**
 * The first slice of moderation: reporting, banning, and the audited unmask.
 * The queue, removals, locks and pins follow in A6 on the same tables.
 */

export const REPORT_REASONS = [
  'harassment',
  'hate',
  'adult',
  'personal_information',
  'threats',
  'spam',
  'misinformation',
  'community_rule',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const reportInputSchema = z.object({
  itemType: z.enum(['post', 'comment']),
  itemId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(500).optional(),
});

export type ReportInput = z.input<typeof reportInputSchema>;

/** Report a post or comment. Verified members, one report per person per item, ten an hour. */
export async function reportItem(
  actor: { userId: string },
  tenantId: string,
  input: ReportInput,
): Promise<Result<{ id: string }, Refusal>> {
  const parsed = reportInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const r = parsed.data;
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .where(
        and(
          eq(reports.tenantId, tenantId),
          eq(reports.reporterId, actor.userId),
          sql`${reports.createdAt} > now() - interval '1 hour'`,
        ),
      );
    if ((recent?.n ?? 0) >= LIMITS.reportsPerHour) return err('rate_limited');

    let communityId: string | null = null;
    if (r.itemType === 'post') {
      const [post] = await tx
        .select({ communityId: postsRead.communityId })
        .from(postsRead)
        .where(eq(postsRead.id, r.itemId));
      communityId = post?.communityId ?? null;
    } else {
      const [comment] = await tx
        .select({ communityId: postsRead.communityId })
        .from(commentsRead)
        .innerJoin(postsRead, eq(postsRead.id, commentsRead.postId))
        .where(eq(commentsRead.id, r.itemId));
      communityId = comment?.communityId ?? null;
    }
    if (!communityId) return err('not_found');

    const [inserted] = await tx
      .insert(reports)
      .values({
        tenantId,
        communityId,
        itemType: r.itemType,
        itemId: r.itemId,
        reporterId: actor.userId,
        reason: r.reason,
        note: r.note ?? null,
      })
      .onConflictDoNothing({ target: [reports.itemType, reports.itemId, reports.reporterId] })
      .returning({ id: reports.id });
    if (!inserted) return err('exists');
    return ok({ id: inserted.id });
  });
}

/**
 * Reveal the author of an anonymous item. The database function does every
 * check and writes the audit line in the same transaction, or raises; the
 * transaction is this call alone, so a refusal is a rejected promise and
 * nothing else. Requires `communities.unmask`, which no role holds by default,
 * and an open report naming the item.
 */
export async function unmaskAuthor(
  actor: { userId: string },
  tenantId: string,
  itemType: 'post' | 'comment',
  itemId: string,
  reportId: string,
): Promise<Result<{ userId: string }, 'not_allowed' | 'not_found'>> {
  try {
    const rows = await withActorInTenant(actor.userId, tenantId, async (tx) => [
      ...(await tx.execute(
        sql`select communities_unmask(${itemType}, ${itemId}::uuid, ${reportId}::uuid) as user_id`,
      )),
    ]);
    const userId = (rows[0] as { user_id?: string } | undefined)?.user_id;
    return userId ? ok({ userId }) : err('not_found');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42501') return err('not_allowed');
    if (code === '22023') return err('not_found');
    throw error;
  }
}

export const banInputSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  /** Minutes from now; omit for permanent. */
  minutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 365)
    .optional(),
});

/**
 * Ban a person from a community (`communities.moderate` there, or
 * `communities.oversee`), or from every community (`communities.oversee`,
 * `communityId` null). Logged to the community's mod log, or to the audit log
 * when tenant wide. Never oneself.
 */
export async function banMember(
  actor: { userId: string },
  tenantId: string,
  communityId: string | null,
  userId: string,
  input: z.input<typeof banInputSchema>,
): Promise<Result<{ id: string }, Refusal>> {
  const parsed = banInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  if (userId === actor.userId) return err('self');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const allowed = communityId
      ? (await canInCommunity(tx, actor.userId, tenantId, communityId, 'communities.moderate')) ||
        (await canInTenant(tx, actor.userId, tenantId, 'communities.oversee'))
      : await canInTenant(tx, actor.userId, tenantId, 'communities.oversee');
    if (!allowed) return err('not_allowed');
    const until = parsed.data.minutes ? new Date(Date.now() + parsed.data.minutes * 60_000) : null;
    const [ban] = await tx
      .insert(communityBans)
      .values({
        tenantId,
        communityId,
        userId,
        reason: parsed.data.reason,
        until,
        createdBy: actor.userId,
      })
      .returning({ id: communityBans.id });
    if (communityId) {
      await tx.insert(moderationActions).values({
        tenantId,
        communityId,
        actorId: actor.userId,
        action: 'ban',
        targetType: 'user',
        targetId: userId,
        reason: parsed.data.reason,
        meta: { until: until?.toISOString() ?? null },
      });
    } else {
      await tx.execute(sql`
        insert into audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
        values (${actor.userId}::uuid, ${tenantId}, 'communities.tenant_banned', 'user', ${userId},
                jsonb_build_object('until', ${until?.toISOString() ?? null}::text))`);
    }
    return ok({ id: ban!.id });
  });
}
