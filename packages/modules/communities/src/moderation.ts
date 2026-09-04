import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { canInCommunity, canInTenant, isVerifiedMember, LIMITS, type Refusal } from './access';
import { HIDDEN_BY_REPORTS, SYSTEM_ACTOR } from './automod';
import type { CommunitiesSettings } from './manifest';
import {
  comments,
  commentsRead,
  communityBans,
  moderationActions,
  posts,
  postsRead,
  publicProfiles,
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
  /**
   * `user` reports the person rather than one thing they wrote, for somebody
   * who is a problem across a university rather than in one thread (§13).
   */
  itemType: z.enum(['post', 'comment', 'user']),
  itemId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(500).optional(),
});

export type ReportInput = z.input<typeof reportInputSchema>;

/**
 * Report a post, a comment, or a person. Verified members, one report per
 * person per target, ten an hour.
 *
 * An item at the tenant's threshold of open reports hides itself (stored
 * removed with a reason code) until a moderator approves or removes it. A
 * person never does: hiding is what happens to a post, and the answers to a
 * person are restriction and suspension, which a human takes and signs. What
 * repeated reports about somebody do is raise a flag on the tenant's queue.
 */
export async function reportItem(
  actor: { userId: string },
  tenantId: string,
  input: ReportInput,
  settings?: Pick<CommunitiesSettings, 'reportThreshold'>,
): Promise<Result<{ id: string; hidden: boolean }, Refusal>> {
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

    // A person belongs to no community, so the report belongs to the tenant.
    // Their own account is not reportable, and neither is an account that is
    // not here: a report nobody in this university can act on is noise.
    if (r.itemType === 'user') {
      if (r.itemId === actor.userId) return err('self');
      const [target] = await tx
        .select({ userId: publicProfiles.userId })
        .from(publicProfiles)
        .where(eq(publicProfiles.userId, r.itemId));
      if (!target) return err('not_found');
      const [made] = await tx
        .insert(reports)
        .values({
          tenantId,
          communityId: null,
          itemType: 'user',
          itemId: r.itemId,
          reporterId: actor.userId,
          reason: r.reason,
          note: r.note ?? null,
        })
        .onConflictDoNothing({ target: [reports.itemType, reports.itemId, reports.reporterId] })
        .returning({ id: reports.id });
      if (!made) return err('exists');
      return ok({ id: made.id, hidden: false });
    }

    let communityId: string | null = null;
    let postId: string | null = null;
    let removed = false;
    if (r.itemType === 'post') {
      const [post] = await tx
        .select({ communityId: postsRead.communityId, removedAt: postsRead.removedAt })
        .from(postsRead)
        .where(eq(postsRead.id, r.itemId));
      communityId = post?.communityId ?? null;
      postId = r.itemId;
      removed = post?.removedAt !== null;
    } else {
      const [comment] = await tx
        .select({
          communityId: postsRead.communityId,
          postId: commentsRead.postId,
          removedAt: commentsRead.removedAt,
        })
        .from(commentsRead)
        .innerJoin(postsRead, eq(postsRead.id, commentsRead.postId))
        .where(eq(commentsRead.id, r.itemId));
      communityId = comment?.communityId ?? null;
      postId = comment?.postId ?? null;
      removed = comment?.removedAt !== null;
    }
    if (!communityId || !postId) return err('not_found');

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

    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .where(
        and(
          eq(reports.itemType, r.itemType),
          eq(reports.itemId, r.itemId),
          eq(reports.status, 'open'),
        ),
      );
    const threshold = settings?.reportThreshold ?? 3;
    if (removed || (open?.n ?? 0) < threshold) return ok({ id: inserted.id, hidden: false });
    const change = { removedAt: new Date(), removalReason: HIDDEN_BY_REPORTS };
    if (r.itemType === 'post') await tx.update(posts).set(change).where(eq(posts.id, r.itemId));
    else await tx.update(comments).set(change).where(eq(comments.id, r.itemId));
    await tx.insert(moderationActions).values({
      tenantId,
      communityId,
      actorId: SYSTEM_ACTOR,
      action: 'auto_hide',
      targetType: r.itemType,
      targetId: r.itemId,
      meta: { postId, reports: open?.n ?? 0 },
    });
    return ok({ id: inserted.id, hidden: true });
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
