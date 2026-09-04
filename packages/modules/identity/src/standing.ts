import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { withActor, withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { recordAudit } from './audit';
import { canInTransaction } from './rbac';
import { tenantMemberships, users } from './schema/identity';

/**
 * Standing: whether a person may act in a tenant right now.
 *
 * Separate from their roles, which say what they may do, and from their
 * verification, which says whether the university knows who they are. A
 * restricted person reads everything and writes nothing; a suspended person
 * has no place here at all until it is lifted.
 *
 * Nothing is ever applied quietly. Every standing carries a reason, the
 * administrator who set it and when it ends, and the person is shown all three
 * and may leave one appeal note. A moderation system that lies to the person
 * it is punishing cannot be appealed against, and one that cannot be appealed
 * against never learns it was wrong.
 */

export type Standing = 'active' | 'restricted' | 'suspended';

export interface StandingRecord {
  status: Standing;
  reason: string | null;
  /** Null means until an administrator lifts it. */
  until: Date | null;
  since: Date | null;
  appealNote: string | null;
  appealAt: Date | null;
}

export const GOOD_STANDING: StandingRecord = {
  status: 'active',
  reason: null,
  until: null,
  since: null,
  appealNote: null,
  appealAt: null,
};

export type StandingRefusal =
  'not_allowed' | 'not_found' | 'self' | 'last_admin' | 'invalid' | 'not_restricted';

/** An expiry that has passed is not a standing: the person is in good standing again. */
function effective(row: {
  status: string;
  standingReason: string | null;
  standingUntil: Date | null;
  standingAt: Date | null;
  appealNote: string | null;
  appealAt: Date | null;
}): StandingRecord {
  const lapsed = row.standingUntil !== null && row.standingUntil.getTime() <= Date.now();
  if (row.status === 'active' || lapsed) return GOOD_STANDING;
  return {
    status: row.status === 'suspended' ? 'suspended' : 'restricted',
    reason: row.standingReason,
    until: row.standingUntil,
    since: row.standingAt,
    appealNote: row.appealNote,
    appealAt: row.appealAt,
  };
}

/**
 * How this person stands in this tenant, read as themselves.
 *
 * Good standing for a stranger too: someone with no membership is not under a
 * restriction, they are simply not a member, and the pages that ask this
 * question want to know whether to say something, not who belongs.
 */
export async function standingFor(userId: string, tenantId: string): Promise<StandingRecord> {
  const [row] = await withActor(userId, (tx) =>
    tx
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId))),
  );
  return row ? effective(row) : GOOD_STANDING;
}

/** The same question inside a transaction that is about to rely on the answer. */
export async function standingInTransaction(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
): Promise<StandingRecord> {
  const [row] = await tx
    .select()
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)));
  return row ? effective(row) : GOOD_STANDING;
}

async function isLastActiveAdmin(
  tx: TenantTransaction,
  tenantId: string,
  memberUserId: string,
): Promise<boolean> {
  const rows = [
    ...(await tx.execute(sql`
      select m.user_id from tenant_memberships m
      join membership_roles mr on mr.membership_id = m.id
      join roles r on r.id = mr.role_id
      where m.tenant_id = ${tenantId} and m.status = 'active' and r.key = 'tenant_admin'`)),
  ] as { user_id: string }[];
  return rows.length <= 1 && rows.some((r) => r.user_id === memberUserId);
}

export interface StandingInput {
  status: Exclude<Standing, 'active'>;
  reason: string;
  /** Minutes from now; omit for until an administrator lifts it. */
  minutes?: number;
}

/**
 * Restrict a member to reading, or suspend them outright.
 *
 * `restrict-members`, re-checked inside the transaction. Never oneself, and
 * never the last active administrator: a tenant that locks out the only person
 * who can unlock it needs a platform administrator to put it right.
 */
export async function setStanding(
  actor: { userId: string },
  tenantId: string,
  memberUserId: string,
  input: StandingInput,
): Promise<Result<{ standing: StandingRecord }, StandingRefusal>> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 300) return err('invalid');
  if (input.minutes !== undefined && (input.minutes < 1 || input.minutes > 60 * 24 * 365)) {
    return err('invalid');
  }
  if (memberUserId === actor.userId) return err('self');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTransaction(tx, actor.userId, tenantId, 'restrict-members'))) {
      return err('not_allowed');
    }
    const [membership] = await tx
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, memberUserId)),
      );
    if (!membership) return err('not_found');
    if (await isLastActiveAdmin(tx, tenantId, memberUserId)) return err('last_admin');

    const now = new Date();
    const until = input.minutes ? new Date(now.getTime() + input.minutes * 60_000) : null;
    const [updated] = await tx
      .update(tenantMemberships)
      .set({
        status: input.status,
        standingReason: reason,
        standingUntil: until,
        standingBy: actor.userId,
        standingAt: now,
        // A new decision clears the answer to the old one.
        appealNote: null,
        appealAt: null,
      })
      .where(eq(tenantMemberships.id, membership.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId,
      action: input.status === 'suspended' ? 'member.suspended' : 'member.restricted',
      targetType: 'membership',
      targetId: membership.id,
      meta: {
        targetUserId: memberUserId,
        reason,
        until: until?.toISOString() ?? null,
      },
    });
    return ok({ standing: effective(updated!) });
  });
}

/** Put a member back in good standing. Idempotent. */
export async function liftStanding(
  actor: { userId: string },
  tenantId: string,
  memberUserId: string,
): Promise<Result<{ changed: boolean }, StandingRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTransaction(tx, actor.userId, tenantId, 'restrict-members'))) {
      return err('not_allowed');
    }
    const [membership] = await tx
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, memberUserId)),
      );
    if (!membership) return err('not_found');
    if (membership.status === 'active') return ok({ changed: false });
    await tx
      .update(tenantMemberships)
      .set({
        status: 'active',
        standingReason: null,
        standingUntil: null,
        standingBy: actor.userId,
        standingAt: new Date(),
        appealNote: null,
        appealAt: null,
      })
      .where(eq(tenantMemberships.id, membership.id));
    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId,
      action: 'member.reinstated',
      targetType: 'membership',
      targetId: membership.id,
      meta: { targetUserId: memberUserId },
    });
    return ok({ changed: true });
  });
}

/**
 * The one note a restricted person may leave for the administrators.
 *
 * One, replaceable until it is answered, and cleared when the standing changes:
 * an appeal is about a decision, so it does not outlive the decision it was
 * about. Their own membership row, so it needs no permission.
 */
export async function appeal(
  actor: { userId: string },
  tenantId: string,
  note: string,
): Promise<Result<{ noted: true }, StandingRefusal>> {
  const text = note.trim();
  if (text.length < 3 || text.length > 1000) return err('invalid');
  return withActor(actor.userId, async (tx) => {
    const [membership] = await tx
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, actor.userId)),
      );
    if (!membership) return err('not_found');
    if (effective(membership).status === 'active') return err('not_restricted');
    await tx
      .update(tenantMemberships)
      .set({ appealNote: text, appealAt: new Date() })
      .where(eq(tenantMemberships.id, membership.id));
    return ok({ noted: true as const });
  });
}

export interface StandingEntry {
  userId: string;
  handle: string;
  avatarSeed: string;
  status: Standing;
  reason: string | null;
  until: Date | null;
  since: Date | null;
  appealNote: string | null;
  appealAt: Date | null;
}

/** Who is under a standing here, and what they said about it. For `restrict-members`. */
export async function listStandings(
  actor: { userId: string },
  tenantId: string,
): Promise<Result<StandingEntry[], StandingRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTransaction(tx, actor.userId, tenantId, 'restrict-members'))) {
      return err('not_allowed');
    }
    const rows = await tx
      .select({
        userId: tenantMemberships.userId,
        handle: users.handle,
        avatarSeed: users.avatarSeed,
        status: tenantMemberships.status,
        standingReason: tenantMemberships.standingReason,
        standingUntil: tenantMemberships.standingUntil,
        standingAt: tenantMemberships.standingAt,
        appealNote: tenantMemberships.appealNote,
        appealAt: tenantMemberships.appealAt,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          ne(tenantMemberships.status, 'active'),
          or(
            isNull(tenantMemberships.standingUntil),
            sql`${tenantMemberships.standingUntil} > now()`,
          ),
        ),
      )
      .orderBy(desc(tenantMemberships.standingAt));
    return ok(
      rows.map((r) => {
        const standing = effective(r);
        return {
          userId: r.userId,
          handle: r.handle,
          avatarSeed: r.avatarSeed,
          status: standing.status,
          reason: standing.reason,
          until: standing.until,
          since: standing.since,
          appealNote: standing.appealNote,
          appealAt: standing.appealAt,
        };
      }),
    );
  });
}
