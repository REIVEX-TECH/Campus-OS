import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant, withTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { communityPermissions, type Refusal } from './access';
import { moderationActions, postFlairs } from './schema/communities';

/**
 * Post flairs: a community's short labels, each with a colour, that a post
 * wears and a list can filter by. Saved as a whole set, but by id, so a
 * renamed flair keeps the posts that wear it and only a dropped one lets go.
 */

export const flairInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(24),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export const flairsInputSchema = z.array(flairInputSchema).max(20);
export type FlairInput = z.input<typeof flairInputSchema>;

export interface FlairView {
  id: string;
  name: string;
  color: string;
  position: number;
}

const shape = (r: typeof postFlairs.$inferSelect): FlairView => ({
  id: r.id,
  name: r.name,
  color: r.color,
  position: r.position,
});

/** A community's flairs in order. Public. */
export async function listFlairs(tenantId: string, communityId: string): Promise<FlairView[]> {
  return withTenant(tenantId, async (tx) =>
    (
      await tx
        .select()
        .from(postFlairs)
        .where(and(eq(postFlairs.tenantId, tenantId), eq(postFlairs.communityId, communityId)))
        .orderBy(asc(postFlairs.position), asc(postFlairs.name))
    ).map(shape),
  );
}

/** Replace the set: existing ids are updated in place, missing ones dropped, new ones added. Logged. */
export async function setFlairs(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
  input: FlairInput[],
): Promise<Result<FlairView[], Refusal>> {
  const parsed = flairsInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const names = parsed.data.map((f) => f.name.toLowerCase());
  if (new Set(names).size !== names.length) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const perms = await communityPermissions(tx, actor.userId, tenantId, communityId);
    if (!perms.hasAny('communities.manage', 'communities.oversee')) return err('not_allowed');
    const keep = parsed.data.map((f) => f.id).filter((id): id is string => Boolean(id));
    await tx
      .delete(postFlairs)
      .where(
        and(
          eq(postFlairs.communityId, communityId),
          keep.length > 0 ? notInArray(postFlairs.id, keep) : undefined,
        ),
      );
    for (const [i, f] of parsed.data.entries()) {
      if (f.id) {
        await tx
          .update(postFlairs)
          .set({ name: f.name, color: f.color.toLowerCase(), position: i + 1 })
          .where(and(eq(postFlairs.id, f.id), eq(postFlairs.communityId, communityId)));
      } else {
        await tx.insert(postFlairs).values({
          tenantId,
          communityId,
          name: f.name,
          color: f.color.toLowerCase(),
          position: i + 1,
        });
      }
    }
    await tx.insert(moderationActions).values({
      tenantId,
      communityId,
      actorId: actor.userId,
      action: 'flairs.updated',
      targetType: 'community',
      targetId: communityId,
      meta: { count: parsed.data.length },
    });
    const rows = await tx
      .select()
      .from(postFlairs)
      .where(eq(postFlairs.communityId, communityId))
      .orderBy(asc(postFlairs.position));
    return ok(rows.map(shape));
  });
}

/** True when the flair belongs to the community; used before a post wears it. */
export async function flairBelongs(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  communityId: string,
  flairId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: postFlairs.id })
    .from(postFlairs)
    .where(and(eq(postFlairs.id, flairId), eq(postFlairs.communityId, communityId)));
  return rows.length > 0;
}

/** The flairs behind a set of ids, for cards outside their community. */
export async function flairsByIds(
  tenantId: string,
  ids: string[],
): Promise<Map<string, FlairView>> {
  if (ids.length === 0) return new Map();
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.select().from(postFlairs).where(inArray(postFlairs.id, ids));
    return new Map(rows.map((r) => [r.id, shape(r)]));
  });
}
