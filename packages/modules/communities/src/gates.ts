import { and, eq, sql } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { canInCommunity } from './access';
import { communities, karmaPublic } from './schema/communities';

/**
 * Participation gates: what a community asks for before someone writes in it.
 *
 * A community may ask for karma, or for an account that has existed a while.
 * Account age is age, days since the account was created; nothing measures time
 * spent in the app, because a gate that rewards lingering punishes anyone with
 * less time to spend.
 *
 * The tenant sets a floor and a community may only tighten it. The effective
 * gate is the greater of the two, worked out where the check runs rather than
 * stored, so raising a tenant's floor takes effect everywhere at once instead
 * of needing every community rewritten. A community that sets zero therefore
 * does not drop below what the university asks for.
 *
 * Checked where it is enforced and not where it is offered: inside the same
 * transaction as the write, after the ban and mute checks and before the rate
 * limits. The refusal names which gate stopped them; the numbers are fetched
 * separately, on the failure path only, so an ordinary write pays nothing.
 */

export type GateAction = 'post' | 'comment' | 'join';
export type GateCode = 'gate_karma' | 'gate_account_age';

/** The part of a community's row the gates read. */
export interface CommunityGates {
  minKarmaToPost: number;
  minKarmaToComment: number;
  minKarmaToJoin: number;
  minAccountAgeDays: number;
  requireVerified: boolean;
}

/** The part of the tenant's settings the gates read. */
export interface GateFloor {
  floorMinKarma: number;
  floorAccountAgeDays: number;
  floorRequireVerified: boolean;
}

export interface EffectiveGates {
  minKarma: number;
  minAccountAgeDays: number;
  requireVerified: boolean;
}

/** The greater of what the community asks and what the university requires. */
export function effectiveGates(
  community: CommunityGates,
  floor: GateFloor,
  action: GateAction,
): EffectiveGates {
  const asked =
    action === 'post'
      ? community.minKarmaToPost
      : action === 'comment'
        ? community.minKarmaToComment
        : community.minKarmaToJoin;
  return {
    minKarma: Math.max(asked, floor.floorMinKarma),
    minAccountAgeDays: Math.max(community.minAccountAgeDays, floor.floorAccountAgeDays),
    requireVerified: community.requireVerified || floor.floorRequireVerified,
  };
}

/** Whole days since the account was created, read as themselves. */
async function accountAgeDays(tx: TenantTransaction, userId: string): Promise<number> {
  const rows = [
    ...(await tx.execute(
      sql`select floor(extract(epoch from (now() - created_at)) / 86400)::int as days
          from users where id = ${userId}::uuid`,
    )),
  ] as { days: number | string }[];
  return Number(rows[0]?.days ?? 0);
}

async function publicKarmaOf(
  tx: TenantTransaction,
  tenantId: string,
  userId: string,
): Promise<number> {
  const [row] = await tx
    .select({ karma: karmaPublic.karma })
    .from(karmaPublic)
    .where(and(eq(karmaPublic.tenantId, tenantId), eq(karmaPublic.userId, userId)));
  return row?.karma ?? 0;
}

/**
 * Which gate stops this person here, or null if none does.
 *
 * Karma first, then account age, so someone told to wait is told the thing they
 * cannot fix by waiting first.
 */
export async function checkGate(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
  communityId: string,
  community: CommunityGates,
  floor: GateFloor,
  action: GateAction,
): Promise<GateCode | null> {
  const gates = effectiveGates(community, floor, action);
  // Nothing to ask for: the common case, and it costs no query.
  if (gates.minKarma <= 0 && gates.minAccountAgeDays <= 0) return null;
  // Whoever moderates here is not who this is for. A community that set a
  // karma gate would otherwise lock out the moderators who set it, leaving
  // them unable to post an announcement without lowering it first; and they
  // can lower it at will, so the gate was never a boundary against them.
  if (await canInCommunity(tx, userId, tenantId, communityId, 'communities.moderate')) {
    return null;
  }
  if (gates.minKarma > 0 && (await publicKarmaOf(tx, tenantId, userId)) < gates.minKarma) {
    return 'gate_karma';
  }
  if (gates.minAccountAgeDays > 0 && (await accountAgeDays(tx, userId)) < gates.minAccountAgeDays) {
    return 'gate_account_age';
  }
  return null;
}

/**
 * What the gate asked for and what this person has, for the message.
 *
 * Only ever called after a refusal, so an ordinary write never pays for it.
 * "You need 50 karma to post here, and you have 12" is a better thing to read
 * than "you cannot post here", which is every other refusal in this module.
 */
export async function describeGate(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
  action: GateAction,
  floor: GateFloor,
  code: GateCode,
): Promise<{ need: number; have: number } | null> {
  // As themselves: the account age comes from their own `users` row, which
  // is the only one they may read.
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [community] = await tx.select().from(communities).where(eq(communities.id, communityId));
    if (!community) return null;
    const gates = effectiveGates(community, floor, action);
    return code === 'gate_karma'
      ? { need: gates.minKarma, have: await publicKarmaOf(tx, tenantId, actor.userId) }
      : { need: gates.minAccountAgeDays, have: await accountAgeDays(tx, actor.userId) };
  });
}
