import { and, eq, isNull, lt, notExists, sql } from 'drizzle-orm';
import { withActorInTenant, withTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { canInTenant, type Refusal } from './access';
import { communities, postsRead } from './schema/communities';

/**
 * Archiving: a community nobody has posted in for a long while goes read
 * only. It stays visible, its posts stay, and nothing can be added until the
 * university reopens it. The sweep is a maintenance run (no actor); the
 * toggle is the tenant's, for `communities.oversee`.
 */

/** Archive every live community with no post in the last `months`, created before that window. */
export async function archiveIdle(
  tenantId: string,
  months: number,
): Promise<{ archived: string[] }> {
  const cutoff = new Date(Date.now() - Math.max(1, Math.floor(months)) * 30 * 86_400_000);
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .update(communities)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(communities.tenantId, tenantId),
          isNull(communities.archivedAt),
          isNull(communities.deletedAt),
          lt(communities.createdAt, cutoff),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(postsRead)
              .where(
                and(
                  eq(postsRead.communityId, communities.id),
                  isNull(postsRead.deletedAt),
                  sql`${postsRead.createdAt} >= ${cutoff.toISOString()}::timestamptz`,
                ),
              ),
          ),
        ),
      )
      .returning({ slug: communities.slug });
    return { archived: rows.map((r) => r.slug) };
  });
}

/** Archive or reopen one community. The tenant's call, into the audit log. */
export async function setArchived(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
  archived: boolean,
): Promise<Result<{ archived: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTenant(tx, actor.userId, tenantId, 'communities.oversee'))) {
      return err('not_allowed');
    }
    const rows = await tx
      .update(communities)
      .set({ archivedAt: archived ? new Date() : null })
      .where(
        and(
          eq(communities.id, communityId),
          eq(communities.tenantId, tenantId),
          isNull(communities.deletedAt),
        ),
      )
      .returning({ slug: communities.slug });
    if (rows.length === 0) return err('not_found');
    await tx.execute(sql`
      insert into audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
      values (${actor.userId}::uuid, ${tenantId}, ${archived ? 'communities.archived' : 'communities.reopened'},
              'community', ${communityId}, jsonb_build_object('slug', ${rows[0]!.slug}::text))`);
    return ok({ archived });
  });
}
