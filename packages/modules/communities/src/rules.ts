import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant, withTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { communityPermissions, type Refusal } from './access';
import { communityRules, moderationActions } from './schema/communities';

/**
 * A community's own rules, shown under the platform's. Ordered, titled, with
 * an optional description; replaced as a whole by an owner.
 */

export interface CommunityRule {
  id: string;
  position: number;
  title: string;
  description: string;
}

export const rulesInputSchema = z
  .array(
    z.object({
      title: z.string().trim().min(2).max(100),
      description: z.string().trim().max(500).default(''),
    }),
  )
  .max(20);

export type RulesInput = z.input<typeof rulesInputSchema>;

export async function listRules(tenantId: string, communityId: string): Promise<CommunityRule[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(communityRules)
      .where(eq(communityRules.communityId, communityId))
      .orderBy(asc(communityRules.position));
    return rows.map((r) => ({
      id: r.id,
      position: r.position,
      title: r.title,
      description: r.description,
    }));
  });
}

/** Replace the rules. `communities.manage` here or `communities.oversee`, logged. */
export async function setRules(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
  input: RulesInput,
): Promise<Result<CommunityRule[], Refusal>> {
  const parsed = rulesInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const perms = await communityPermissions(tx, actor.userId, tenantId, communityId);
    if (!perms.hasAny('communities.manage', 'communities.oversee')) return err('not_allowed');
    await tx.delete(communityRules).where(eq(communityRules.communityId, communityId));
    const rows =
      parsed.data.length === 0
        ? []
        : await tx
            .insert(communityRules)
            .values(
              parsed.data.map((r, i) => ({
                tenantId,
                communityId,
                position: i + 1,
                title: r.title,
                description: r.description,
              })),
            )
            .returning();
    await tx.insert(moderationActions).values({
      tenantId,
      communityId,
      actorId: actor.userId,
      action: 'rules.updated',
      targetType: 'community',
      targetId: communityId,
      meta: { count: rows.length },
    });
    return ok(
      rows.map((r) => ({
        id: r.id,
        position: r.position,
        title: r.title,
        description: r.description,
      })),
    );
  });
}
