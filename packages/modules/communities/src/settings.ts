import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { communityPermissions, type Refusal } from './access';
import { toCommunitySummary, type CommunitySummary } from './communities';
import { communities, moderationActions } from './schema/communities';

/**
 * A community's settings, changed by its owner (`communities.manage`) or by a
 * tenant administrator (`communities.oversee`). The slug never changes: it is
 * the URL every link to the community carries.
 */

export const communitySettingsSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(500),
  allowAnonymous: z.boolean(),
  visibility: z.enum(['public', 'restricted']),
  allowedKinds: z.array(z.enum(['text', 'link', 'poll'])).min(1),
  modLogPublic: z.boolean(),
  // Participation gates (§12). Zero is "ask for nothing"; the tenant floor is
  // applied where the check runs, so zero never drops below the university's.
  minKarmaToPost: z.number().int().min(0).max(10_000).default(0),
  minKarmaToComment: z.number().int().min(0).max(10_000).default(0),
  minKarmaToJoin: z.number().int().min(0).max(10_000).default(0),
  minAccountAgeDays: z.number().int().min(0).max(365).default(0),
  requireVerified: z.boolean().default(true),
});

export type CommunitySettingsInput = z.input<typeof communitySettingsSchema>;

export async function updateCommunitySettings(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
  input: CommunitySettingsInput,
): Promise<Result<CommunitySummary, Refusal>> {
  const parsed = communitySettingsSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const s = parsed.data;
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const perms = await communityPermissions(tx, actor.userId, tenantId, communityId);
    if (!perms.hasAny('communities.manage', 'communities.oversee')) return err('not_allowed');
    const [updated] = await tx
      .update(communities)
      .set({
        name: s.name,
        description: s.description,
        allowAnonymous: s.allowAnonymous,
        visibility: s.visibility,
        allowedKinds: s.allowedKinds,
        modLogPublic: s.modLogPublic,
        minKarmaToPost: s.minKarmaToPost,
        minKarmaToComment: s.minKarmaToComment,
        minKarmaToJoin: s.minKarmaToJoin,
        minAccountAgeDays: s.minAccountAgeDays,
        requireVerified: s.requireVerified,
      })
      .where(and(eq(communities.id, communityId), isNull(communities.deletedAt)))
      .returning();
    if (!updated) return err('not_found');
    await tx.insert(moderationActions).values({
      tenantId,
      communityId,
      actorId: actor.userId,
      action: 'settings.updated',
      targetType: 'community',
      targetId: communityId,
      meta: { fields: Object.keys(s) },
    });
    return ok(toCommunitySummary(updated));
  });
}

/** A tenant administrator approves a community that was waiting. */
export async function approveCommunity(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
): Promise<Result<{ approved: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const perms = await communityPermissions(tx, actor.userId, tenantId, communityId);
    if (!perms.has('communities.oversee')) return err('not_allowed');
    const updated = await tx
      .update(communities)
      .set({ approvalStatus: 'approved' })
      .where(
        and(
          eq(communities.id, communityId),
          eq(communities.approvalStatus, 'pending'),
          isNull(communities.deletedAt),
        ),
      )
      .returning({ id: communities.id });
    return ok({ approved: updated.length > 0 });
  });
}
