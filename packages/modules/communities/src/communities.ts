import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant, withTenant, type TenantTransaction } from '@campusos/db';
import { COMMUNITY_ROLES, COMMUNITY_ROLE_KEYS, err, ok, type Result } from '@campusos/core';
import type { PermissionSet } from '@campusos/core';
import {
  canInTenant,
  communityPermissions,
  isBanned,
  isVerifiedMember,
  LIMITS,
  type Refusal,
} from './access';
import { communitySlugFromName } from './domain/slug';
import type { CommunitiesSettings } from './manifest';
import { communities, communityMemberRoles, communityMemberships } from './schema/communities';

/**
 * Communities: creating one, joining and leaving, and the roles a community
 * attaches to its members. Every mutation re-checks its permission inside the
 * transaction; the page that offered the control is never what authorises it.
 */

export interface CommunitySummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconSeed: string;
  bannerSeed: string;
  visibility: string;
  allowAnonymous: boolean;
  allowedKinds: string[];
  approvalStatus: string;
  memberCount: number;
  createdAt: Date;
  archivedAt: Date | null;
}

function summary(row: typeof communities.$inferSelect): CommunitySummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    iconSeed: row.iconSeed,
    bannerSeed: row.bannerSeed,
    visibility: row.visibility,
    allowAnonymous: row.allowAnonymous,
    allowedKinds: row.allowedKinds,
    approvalStatus: row.approvalStatus,
    memberCount: row.memberCount,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  };
}

/**
 * The three community roles for this tenant, created if missing. Idempotent,
 * and run before any community is created so the owner role exists to attach.
 * Roles live in the identity module's tables; this writes them by name, as the
 * migration does for tenants that already existed.
 */
export async function ensureCommunityRoles(tx: TenantTransaction, tenantId: string): Promise<void> {
  for (const key of COMMUNITY_ROLE_KEYS) {
    const definition = COMMUNITY_ROLES[key];
    await tx.execute(sql`
      insert into roles (tenant_id, key, name, is_system)
      values (${tenantId}, ${key}, ${definition.name}, true)
      on conflict (tenant_id, key) do nothing`);
    for (const permission of definition.permissions) {
      await tx.execute(sql`
        insert into role_permissions (role_id, tenant_id, permission)
        select r.id, r.tenant_id, ${permission} from roles r
        where r.tenant_id = ${tenantId} and r.key = ${key}
        on conflict (role_id, permission) do nothing`);
    }
  }
}

async function roleId(
  tx: TenantTransaction,
  tenantId: string,
  key: string,
): Promise<string | null> {
  const rows = [
    ...(await tx.execute(
      sql`select id from roles where tenant_id = ${tenantId} and key = ${key} limit 1`,
    )),
  ] as { id: string }[];
  return rows[0]?.id ?? null;
}

async function attachCommunityRole(
  tx: TenantTransaction,
  input: {
    membershipId: string;
    tenantId: string;
    communityId: string;
    userId: string;
    roleKey: string;
    grantedBy: string | null;
  },
): Promise<boolean> {
  const id = await roleId(tx, input.tenantId, input.roleKey);
  if (!id) return false;
  const inserted = await tx
    .insert(communityMemberRoles)
    .values({
      membershipId: input.membershipId,
      roleId: id,
      tenantId: input.tenantId,
      communityId: input.communityId,
      userId: input.userId,
      grantedBy: input.grantedBy,
    })
    .onConflictDoNothing({
      target: [communityMemberRoles.membershipId, communityMemberRoles.roleId],
    })
    .returning({ roleId: communityMemberRoles.roleId });
  return inserted.length > 0;
}

export const createCommunitySchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(500).default(''),
  allowAnonymous: z.boolean().default(true),
  visibility: z.enum(['public', 'restricted']).default('public'),
  allowedKinds: z
    .array(z.enum(['text', 'link']))
    .min(1)
    .default(['text', 'link']),
});

export type CreateCommunityInput = z.input<typeof createCommunitySchema>;

/**
 * Create a community. A verified member with `communities.create`, not banned
 * tenant wide, at most two a day. The creator joins and becomes its owner in
 * the same transaction. With the tenant's `approval` setting the community
 * waits for a tenant administrator; otherwise it is live at once.
 */
export async function createCommunity(
  actor: { userId: string },
  tenantId: string,
  input: CreateCommunityInput,
  settings: CommunitiesSettings,
): Promise<Result<CommunitySummary, Refusal>> {
  const parsed = createCommunitySchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const slug = communitySlugFromName(parsed.data.name);
  if (!slug) return err('invalid');

  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    if (await isBanned(tx, actor.userId, tenantId, null)) return err('banned');
    if (!(await canInTenant(tx, actor.userId, tenantId, 'communities.create'))) {
      return err('not_allowed');
    }
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(communities)
      .where(
        and(
          eq(communities.tenantId, tenantId),
          eq(communities.createdBy, actor.userId),
          sql`${communities.createdAt} > now() - interval '1 day'`,
        ),
      );
    if ((recent?.n ?? 0) >= LIMITS.communitiesPerDay) return err('rate_limited');

    await ensureCommunityRoles(tx, tenantId);
    const [created] = await tx
      .insert(communities)
      .values({
        tenantId,
        slug,
        name: parsed.data.name,
        description: parsed.data.description,
        iconSeed: randomUUID(),
        bannerSeed: randomUUID(),
        visibility: parsed.data.visibility,
        allowAnonymous: parsed.data.allowAnonymous,
        allowedKinds: parsed.data.allowedKinds,
        approvalStatus: settings.createCommunity === 'approval' ? 'pending' : 'approved',
        memberCount: 1,
        createdBy: actor.userId,
      })
      .onConflictDoNothing({ target: [communities.tenantId, communities.slug] })
      .returning();
    if (!created) return err('exists');

    const [membership] = await tx
      .insert(communityMemberships)
      .values({ tenantId, communityId: created.id, userId: actor.userId })
      .returning({ id: communityMemberships.id });
    await attachCommunityRole(tx, {
      membershipId: membership!.id,
      tenantId,
      communityId: created.id,
      userId: actor.userId,
      roleKey: 'community_owner',
      grantedBy: null,
    });
    return ok(summary(created));
  });
}

/** A live community by slug, or null. Needs no actor: it is what a public page renders. */
export async function communityBySlug(
  tenantId: string,
  slug: string,
): Promise<CommunitySummary | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(communities)
      .where(
        and(
          eq(communities.tenantId, tenantId),
          eq(communities.slug, slug),
          isNull(communities.deletedAt),
        ),
      );
    return row ? summary(row) : null;
  });
}

export async function communityById(
  tenantId: string,
  id: string,
): Promise<CommunitySummary | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(communities)
      .where(
        and(
          eq(communities.tenantId, tenantId),
          eq(communities.id, id),
          isNull(communities.deletedAt),
        ),
      );
    return row ? summary(row) : null;
  });
}

/** Join a public, live community: a verified member, not banned. Idempotent. */
export async function joinCommunity(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
): Promise<Result<{ joined: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [community] = await tx
      .select()
      .from(communities)
      .where(and(eq(communities.id, communityId), isNull(communities.deletedAt)));
    if (!community || community.approvalStatus !== 'approved') return err('not_found');
    if (community.archivedAt) return err('archived');
    if (community.visibility !== 'public') return err('not_allowed');
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    if (await isBanned(tx, actor.userId, tenantId, communityId)) return err('banned');

    const [existing] = await tx
      .select()
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.communityId, communityId),
          eq(communityMemberships.userId, actor.userId),
        ),
      );
    let membershipId: string;
    let joined = false;
    if (!existing) {
      const [inserted] = await tx
        .insert(communityMemberships)
        .values({ tenantId, communityId, userId: actor.userId })
        .returning({ id: communityMemberships.id });
      membershipId = inserted!.id;
      joined = true;
    } else if (existing.leftAt) {
      await tx
        .update(communityMemberships)
        .set({ leftAt: null, joinedAt: new Date() })
        .where(eq(communityMemberships.id, existing.id));
      membershipId = existing.id;
      joined = true;
    } else {
      membershipId = existing.id;
    }
    await attachCommunityRole(tx, {
      membershipId,
      tenantId,
      communityId,
      userId: actor.userId,
      roleKey: 'community_member',
      grantedBy: null,
    });
    if (joined) {
      await tx
        .update(communities)
        .set({ memberCount: sql`${communities.memberCount} + 1` })
        .where(eq(communities.id, communityId));
    }
    return ok({ joined });
  });
}

/** Leave: roles go with the membership. The only owner cannot leave. */
export async function leaveCommunity(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
): Promise<Result<{ left: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [membership] = await tx
      .select()
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.communityId, communityId),
          eq(communityMemberships.userId, actor.userId),
          isNull(communityMemberships.leftAt),
        ),
      );
    if (!membership) return ok({ left: false });
    const perms = await communityPermissions(tx, actor.userId, tenantId, communityId);
    if (perms.has('communities.transfer') && (await ownerCount(tx, tenantId, communityId)) <= 1) {
      return err('last_owner');
    }
    await tx
      .delete(communityMemberRoles)
      .where(eq(communityMemberRoles.membershipId, membership.id));
    await tx
      .update(communityMemberships)
      .set({ leftAt: new Date() })
      .where(eq(communityMemberships.id, membership.id));
    await tx
      .update(communities)
      .set({ memberCount: sql`greatest(${communities.memberCount} - 1, 0)` })
      .where(eq(communities.id, communityId));
    return ok({ left: true });
  });
}

async function ownerCount(
  tx: TenantTransaction,
  tenantId: string,
  communityId: string,
): Promise<number> {
  const rows = [
    ...(await tx.execute(sql`
      select count(*)::int as n
      from community_member_roles cmr
      join roles r on r.id = cmr.role_id
      join community_memberships cm on cm.id = cmr.membership_id and cm.left_at is null
      where cmr.tenant_id = ${tenantId} and cmr.community_id = ${communityId}::uuid
        and r.key = 'community_owner'`)),
  ] as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** The communities this person has joined, newest first. */
export async function myCommunities(
  actor: { userId: string },
  tenantId: string,
): Promise<CommunitySummary[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = await tx
      .select({ community: communities })
      .from(communityMemberships)
      .innerJoin(communities, eq(communities.id, communityMemberships.communityId))
      .where(
        and(
          eq(communityMemberships.tenantId, tenantId),
          eq(communityMemberships.userId, actor.userId),
          isNull(communityMemberships.leftAt),
          isNull(communities.deletedAt),
        ),
      )
      .orderBy(desc(communityMemberships.joinedAt));
    return rows.map((r) => summary(r.community));
  });
}

export type CommunityRoleKey = 'community_member' | 'community_moderator' | 'community_owner';

/**
 * Give a member of this community a community role, or take one away. The
 * actor needs `communities.manage` here (an owner), re-checked inside the
 * transaction; a tenant administrator's `communities.oversee` also allows it.
 * Owner transfer is `grant owner to them, revoke owner from me`; the last
 * owner's role cannot be revoked.
 */
export async function setCommunityRole(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
  memberUserId: string,
  roleKey: CommunityRoleKey,
  action: 'grant' | 'revoke',
): Promise<Result<{ changed: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const perms = await communityPermissions(tx, actor.userId, tenantId, communityId);
    if (!perms.hasAny('communities.manage', 'communities.oversee')) return err('not_allowed');
    if (
      roleKey === 'community_owner' &&
      !perms.hasAny('communities.transfer', 'communities.oversee')
    ) {
      return err('not_allowed');
    }
    const [membership] = await tx
      .select()
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.communityId, communityId),
          eq(communityMemberships.userId, memberUserId),
          isNull(communityMemberships.leftAt),
        ),
      );
    if (!membership) return err('not_found');

    if (action === 'grant') {
      const changed = await attachCommunityRole(tx, {
        membershipId: membership.id,
        tenantId,
        communityId,
        userId: memberUserId,
        roleKey,
        grantedBy: actor.userId,
      });
      return ok({ changed });
    }
    if (roleKey === 'community_owner' && (await ownerCount(tx, tenantId, communityId)) <= 1) {
      return err('last_owner');
    }
    const id = await roleId(tx, tenantId, roleKey);
    if (!id) return err('not_found');
    const deleted = await tx
      .delete(communityMemberRoles)
      .where(
        and(
          eq(communityMemberRoles.membershipId, membership.id),
          eq(communityMemberRoles.roleId, id),
        ),
      )
      .returning({ roleId: communityMemberRoles.roleId });
    return ok({ changed: deleted.length > 0 });
  });
}

/** What this person may do in this community, for a page's gate. */
export async function permissionsIn(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
): Promise<PermissionSet> {
  return withActorInTenant(actor.userId, tenantId, (tx) =>
    communityPermissions(tx, actor.userId, tenantId, communityId),
  );
}
