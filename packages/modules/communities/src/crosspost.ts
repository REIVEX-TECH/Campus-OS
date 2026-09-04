import { and, eq, isNull } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';
import { err, type Result } from '@campusos/core';
import type { Refusal } from './access';
import type { CommunitiesSettings } from './manifest';
import { createPostIn } from './posts';
import { communities, communityMemberships, postsRead } from './schema/communities';

/**
 * A crosspost is a new text post in another community that points at the
 * original. It goes through the same gate as any post there (membership,
 * kind, limits, filters), so the target community's rules hold. The source
 * must be one the person can see; a restricted community's post travels only
 * with its members. Crossposting a crosspost points at the original.
 */
export async function crosspost(
  actor: { userId: string },
  tenantId: string,
  postId: string,
  targetCommunityId: string,
  settings: CommunitiesSettings,
): Promise<Result<{ id: string; held: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [source] = await tx
      .select({
        id: postsRead.id,
        title: postsRead.title,
        communityId: postsRead.communityId,
        crosspostOf: postsRead.crosspostOf,
        deletedAt: postsRead.deletedAt,
        removedAt: postsRead.removedAt,
      })
      .from(postsRead)
      .where(eq(postsRead.id, postId));
    if (!source || source.deletedAt || source.removedAt) return err('not_found');
    const [home] = await tx
      .select({ visibility: communities.visibility, deletedAt: communities.deletedAt })
      .from(communities)
      .where(eq(communities.id, source.communityId));
    if (!home || home.deletedAt) return err('not_found');
    if (home.visibility !== 'public') {
      const [membership] = await tx
        .select({ id: communityMemberships.id })
        .from(communityMemberships)
        .where(
          and(
            eq(communityMemberships.communityId, source.communityId),
            eq(communityMemberships.userId, actor.userId),
            isNull(communityMemberships.leftAt),
          ),
        );
      if (!membership) return err('not_found');
    }
    if (source.communityId === targetCommunityId) return err('invalid');
    const original = source.crosspostOf ?? source.id;
    const [dup] = await tx
      .select({ id: postsRead.id })
      .from(postsRead)
      .where(
        and(
          eq(postsRead.communityId, targetCommunityId),
          eq(postsRead.crosspostOf, original),
          isNull(postsRead.deletedAt),
        ),
      );
    if (dup) return err('exists');
    return createPostIn(
      tx,
      actor,
      tenantId,
      targetCommunityId,
      { kind: 'text', title: source.title, body: '', isAnonymous: false, spoiler: false },
      settings,
      { crosspostOf: original },
    );
  });
}
