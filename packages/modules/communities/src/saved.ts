import { and, desc, eq, isNull } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import type { Refusal } from './access';
import { attachCrossposts, POST, toPostView, type PostView } from './posts';
import {
  commentsRead,
  communities,
  hiddenItems,
  postVotes,
  postsRead,
  publicProfiles,
  savedItems,
} from './schema/communities';

/**
 * A person's own lists: saved and hidden. Both tables show a person only their
 * rows (restrictive policies), so every read here is the viewer's alone.
 */

export type ItemType = 'post' | 'comment';

async function itemExists(
  tx: TenantTransaction,
  itemType: ItemType,
  itemId: string,
): Promise<boolean> {
  const rows =
    itemType === 'post'
      ? await tx.select({ id: postsRead.id }).from(postsRead).where(eq(postsRead.id, itemId))
      : await tx
          .select({ id: commentsRead.id })
          .from(commentsRead)
          .where(eq(commentsRead.id, itemId));
  return rows.length > 0;
}

export async function saveItem(
  actor: { userId: string },
  tenantId: string,
  itemType: ItemType,
  itemId: string,
  on: boolean,
): Promise<Result<{ saved: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await itemExists(tx, itemType, itemId))) return err('not_found');
    if (on) {
      await tx
        .insert(savedItems)
        .values({ tenantId, userId: actor.userId, itemType, itemId })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(savedItems)
        .where(
          and(
            eq(savedItems.userId, actor.userId),
            eq(savedItems.itemType, itemType),
            eq(savedItems.itemId, itemId),
          ),
        );
    }
    return ok({ saved: on });
  });
}

export async function hideItem(
  actor: { userId: string },
  tenantId: string,
  itemType: ItemType,
  itemId: string,
  on: boolean,
): Promise<Result<{ hidden: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await itemExists(tx, itemType, itemId))) return err('not_found');
    if (on) {
      await tx
        .insert(hiddenItems)
        .values({ tenantId, userId: actor.userId, itemType, itemId })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(hiddenItems)
        .where(
          and(
            eq(hiddenItems.userId, actor.userId),
            eq(hiddenItems.itemType, itemType),
            eq(hiddenItems.itemId, itemId),
          ),
        );
    }
    return ok({ hidden: on });
  });
}

/** The viewer's saved posts, newest saved first. */
export async function listSavedPosts(
  actor: { userId: string },
  tenantId: string,
  limit = 50,
): Promise<PostView[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = await tx
      .select({
        post: POST,
        handle: publicProfiles.handle,
        avatarSeed: publicProfiles.avatarSeed,
        myVote: postVotes.value,
        savedAt: savedItems.createdAt,
        communitySlug: communities.slug,
        communityName: communities.name,
      })
      .from(savedItems)
      .innerJoin(postsRead, eq(postsRead.id, savedItems.itemId))
      .leftJoin(communities, eq(communities.id, postsRead.communityId))
      .leftJoin(publicProfiles, eq(publicProfiles.userId, postsRead.publicAuthorId))
      .leftJoin(postVotes, eq(postVotes.postId, postsRead.id))
      .where(
        and(
          eq(savedItems.userId, actor.userId),
          eq(savedItems.itemType, 'post'),
          isNull(postsRead.deletedAt),
        ),
      )
      .orderBy(desc(savedItems.createdAt))
      .limit(limit);
    return attachCrossposts(
      tx,
      rows.map((r) =>
        toPostView(
          r.post,
          r.handle,
          r.avatarSeed,
          { myVote: r.myVote, saved: true },
          { slug: r.communitySlug, name: r.communityName },
        ),
      ),
    );
  });
}
