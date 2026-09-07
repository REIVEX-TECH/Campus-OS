import { and, desc, eq, sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import type { Refusal } from './access';
import { publicProfiles, userBlocks } from './schema/communities';

/**
 * Blocking is a person's own filter: what a blocked person writes under their
 * handle disappears from the blocker's feeds and threads. It is keyed on the
 * public author, so anonymous items are untouched: filtering them would need
 * the author, and the author of an anonymous item is nobody's to read. The
 * blocked person is told nothing. Rows are the blocker's own under RLS.
 */

export interface BlockedPerson {
  userId: string;
  handle: string;
  avatarSeed: string;
  since: Date;
}

export async function blockUser(
  actor: { userId: string },
  tenantId: string,
  userId: string,
): Promise<Result<{ blocked: true }, Refusal>> {
  if (userId === actor.userId) return err('self');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [person] = await tx
      .select({ id: publicProfiles.userId })
      .from(publicProfiles)
      .where(eq(publicProfiles.userId, userId));
    if (!person) return err('not_found');
    await tx
      .insert(userBlocks)
      .values({ tenantId, blockerId: actor.userId, blockedId: userId })
      .onConflictDoNothing();
    return ok({ blocked: true });
  });
}

export async function unblockUser(
  actor: { userId: string },
  tenantId: string,
  userId: string,
): Promise<Result<{ blocked: false }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    await tx
      .delete(userBlocks)
      .where(
        and(
          eq(userBlocks.tenantId, tenantId),
          eq(userBlocks.blockerId, actor.userId),
          eq(userBlocks.blockedId, userId),
        ),
      );
    return ok({ blocked: false });
  });
}

/**
 * Whether the actor and `otherUserId` are in a block relationship in EITHER
 * direction. Own-row RLS lets the actor see only their own blocks, so the reverse
 * ("did they block me?") is read through the `auth_blocked_between` definer (0012),
 * which is scoped to the caller. Used to refuse a direct-message request or send
 * when either party has blocked the other.
 */
export async function blockedBetween(
  actor: { userId: string },
  tenantId: string,
  otherUserId: string,
): Promise<boolean> {
  if (otherUserId === actor.userId) return false;
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(
        sql`select auth_blocked_between(${tenantId}, ${otherUserId}::uuid) as blocked`,
      )),
    ] as { blocked: boolean }[];
    return row?.blocked === true;
  });
}

/** Who this person has blocked, newest first. */
export async function listBlocked(
  actor: { userId: string },
  tenantId: string,
): Promise<BlockedPerson[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = await tx
      .select({
        userId: userBlocks.blockedId,
        handle: publicProfiles.handle,
        avatarSeed: publicProfiles.avatarSeed,
        since: userBlocks.createdAt,
      })
      .from(userBlocks)
      .innerJoin(publicProfiles, eq(publicProfiles.userId, userBlocks.blockedId))
      .where(and(eq(userBlocks.tenantId, tenantId), eq(userBlocks.blockerId, actor.userId)))
      .orderBy(desc(userBlocks.createdAt));
    return rows.map((r) => ({
      userId: r.userId,
      handle: r.handle ?? '',
      avatarSeed: r.avatarSeed ?? '',
      since: r.since,
    }));
  });
}
