import { and, eq, sql } from 'drizzle-orm';
import {
  withActor,
  withActorInTenant,
  withTenantMutation,
  type TenantTransaction,
  type TenantWriteContext,
} from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { canInTransaction } from './rbac';
import { tenantMemberships } from './schema/identity';

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
  access?: TenantWriteContext,
): Promise<Result<{ standing: StandingRecord }, StandingRefusal>> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 300) return err('invalid');
  if (input.minutes !== undefined && (input.minutes < 1 || input.minutes > 60 * 24 * 365)) {
    return err('invalid');
  }
  if (memberUserId === actor.userId) return err('self');
  const until = input.minutes ? new Date(Date.now() + input.minutes * 60_000) : null;
  return withTenantMutation(actor.userId, tenantId, access, async (tx) => {
    // The write is a definer (0019): the application role can no longer write
    // tenant_memberships. It re-checks restrict-members, refuses self and the
    // last active administrator, and audits. We map its code and read the row
    // back for the record.
    const [row] = [
      ...(await tx.execute(
        sql`select auth_write_standing(${tenantId}, ${memberUserId}::uuid, ${input.status},
              ${reason}, ${until ? until.toISOString() : null}::timestamptz) as code`,
      )),
    ] as { code: string }[];
    const code = row?.code ?? 'not_allowed';
    if (code !== 'ok') return err(code as StandingRefusal);
    return ok({ standing: await standingInTransaction(tx, memberUserId, tenantId) });
  });
}

/** Put a member back in good standing. Idempotent. */
export async function liftStanding(
  actor: { userId: string },
  tenantId: string,
  memberUserId: string,
  access?: TenantWriteContext,
): Promise<Result<{ changed: boolean }, StandingRefusal>> {
  return withTenantMutation(actor.userId, tenantId, access, async (tx) => {
    const current = await standingInTransaction(tx, memberUserId, tenantId);
    // A stranger's row is good standing too; distinguish "no membership" so the
    // caller still gets not_found, matching the previous behaviour.
    const [membership] = await tx
      .select({ id: tenantMemberships.id, status: tenantMemberships.status })
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, memberUserId)),
      );
    if (!membership) return err('not_found');
    if (current.status === 'active') return ok({ changed: false });
    const [row] = [
      ...(await tx.execute(
        sql`select auth_write_standing(${tenantId}, ${memberUserId}::uuid, 'active', '', null) as code`,
      )),
    ] as { code: string }[];
    const code = row?.code ?? 'not_allowed';
    if (code !== 'ok') return err(code as StandingRefusal);
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
    // Writing the row directly would need a tenant context, and giving a
    // restricted person one would put `status` and `verified_at` within reach:
    // Postgres has no column-scoped policy. `auth_appeal_standing` takes no
    // user id at all, reading the caller from the session, so it can only ever
    // write the caller's own two appeal columns. (0015)
    const [row] = [
      ...(await tx.execute(sql`select auth_appeal_standing(${tenantId}, ${text}) as noted`)),
    ] as { noted: boolean }[];
    if (!row?.noted) return err('not_restricted');
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
    // `users` is readable only to its owner, so another member's handle comes
    // from `public_profiles`, the sanctioned view, exactly as the member list
    // reads it. Joining `users` here returned nothing at all and said nothing.
    const rows = [
      ...(await tx.execute(sql`
        select m.user_id, p.handle, coalesce(p.avatar_seed, m.user_id::text) as avatar_seed,
               m.status, m.standing_reason, m.standing_until, m.standing_at,
               m.appeal_note, m.appeal_at
        from tenant_memberships m
        left join public_profiles p on p.user_id = m.user_id
        where m.tenant_id = ${tenantId}
          and m.status <> 'active'
          and (m.standing_until is null or m.standing_until > now())
        order by m.standing_at desc nulls last`)),
    ].map((row) => {
      const r = row as {
        user_id: string;
        handle: string | null;
        avatar_seed: string;
        status: string;
        standing_reason: string | null;
        standing_until: string | Date | null;
        standing_at: string | Date | null;
        appeal_note: string | null;
        appeal_at: string | Date | null;
      };
      // Raw rows carry their timestamps as text.
      const date = (value: string | Date | null) =>
        value === null ? null : value instanceof Date ? value : new Date(value);
      return {
        userId: r.user_id,
        handle: r.handle ?? '',
        avatarSeed: r.avatar_seed,
        status: r.status,
        standingReason: r.standing_reason,
        standingUntil: date(r.standing_until),
        standingAt: date(r.standing_at),
        appealNote: r.appeal_note,
        appealAt: date(r.appeal_at),
      };
    });
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
