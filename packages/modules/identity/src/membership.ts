import { and, eq, sql } from 'drizzle-orm';
import { withActor, withActorInTenant, withTenant, type TenantTransaction } from '@campusos/db';
import { recordAudit } from './audit';
import { tenantMemberships, verificationRequests } from './schema/identity';

/**
 * A person's place in a tenant, and how they got it.
 *
 * Membership is separate from signing in. A user exists above any one
 * university; a membership is the row that says they belong to this one, with
 * what role, and whether the university can trust who they are. "Verified" is
 * that last fact: a time and a method, never a public badge. Public surfaces
 * show only the anonymous handle.
 *
 * Writes never go through the application role: tenant_memberships is written
 * only by the 0019 definers -- the domain self-verify and the student floor at
 * sign in, and a tenant admin's decision -- each of which re-checks its own
 * authority in the database. The application role cannot write the table directly.
 */

// 'config' is historical only: the retired config-admin path (0023) wrote it and
// no live writer emits it any more (0025/0028). Kept so existing rows read back.
export type VerificationMethod = 'domain' | 'admin' | 'config';

export interface Membership {
  id: string;
  tenantId: string;
  /** student | teacher | tenant_admin */
  role: string;
  /** active | invited | suspended */
  status: string;
  verifiedAt: Date | null;
  verificationMethod: VerificationMethod | null;
}

/** The part of a tenant's config that decides who may join it unaided. */
export interface JoinPolicy {
  slug: string;
  joinMode: 'domain' | 'invite';
  allowedEmailDomains: readonly string[];
}

/** The domain of an address, lower cased, or null for anything malformed. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/** Exact match only: a subdomain of the university is not the university. */
export function domainAllowed(email: string, allowed: readonly string[]): boolean {
  const domain = emailDomain(email);
  return domain !== null && allowed.some((d) => d.toLowerCase() === domain);
}

/** Verified, and in good standing. A suspended membership verifies nothing. */
export function isVerified(membership: Membership | null | undefined): boolean {
  return membership?.verifiedAt != null && membership.status === 'active';
}

type Row = typeof tenantMemberships.$inferSelect;

function toMembership(row: Row): Membership {
  return {
    id: row.id,
    tenantId: row.tenantId,
    role: row.role,
    status: row.status,
    verifiedAt: row.verifiedAt ?? null,
    verificationMethod: (row.verificationMethod as VerificationMethod | null) ?? null,
  };
}

/** Close, and purge, any request of theirs still waiting in this tenant. */
export async function supersedePending(
  tx: TenantTransaction,
  input: { tenantId: string; userId: string; actorUserId: string },
): Promise<void> {
  const closed = await tx
    .update(verificationRequests)
    .set({
      status: 'superseded',
      decidedBy: input.actorUserId,
      decidedAt: new Date(),
    })
    // The submitted details are purged by the 0030 trigger as the request leaves
    // 'pending'; nothing to null out on the row itself any more.
    .where(
      and(
        eq(verificationRequests.tenantId, input.tenantId),
        eq(verificationRequests.userId, input.userId),
        eq(verificationRequests.status, 'pending'),
      ),
    )
    .returning({ id: verificationRequests.id });
  for (const row of closed) {
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      action: 'verification.superseded',
      targetType: 'verification_request',
      targetId: row.id,
      meta: { targetUserId: input.userId },
    });
  }
}

/**
 * Give a person their place in a tenant when they sign in on it.
 *
 * Everyone gets a membership and the `student` role, which carries reading
 * and the right to ask for more. Whether the address is on the tenant's domain
 * list decides only whether the membership is verified there and then;
 * posting, commenting, voting and starting a community all wait on
 * verification, not on membership.
 *
 * Before this, an address off the list got nothing at all, which left the
 * person unable to reach the page that would have let them ask to be verified.
 * Safe to call on every sign in.
 */
export async function ensureDomainMembership(
  actor: { userId: string; email: string },
  tenant: JoinPolicy,
): Promise<Membership | null> {
  return withActorInTenant(actor.userId, tenant.slug, async (tx) => {
    // Every write to tenant_memberships now goes through a definer (0019); the
    // application role cannot write the table directly. Domain self-verification
    // and the student floor are two such definers. Calling both is safe: if the
    // address is on the domain the first verifies and the second is a no-op; if
    // not, the first does nothing and the second creates the unverified student.
    if (tenant.joinMode === 'domain' && tenant.allowedEmailDomains.length > 0) {
      await tx.execute(
        sql`select auth_verify_self_by_domain(${tenant.slug}, ${pgTextArray(tenant.allowedEmailDomains)})`,
      );
    }
    await tx.execute(sql`select auth_join_as_student(${tenant.slug})`);
    const membership = await readMembership(tx, tenant.slug, actor.userId);
    // A domain sign-in that verified the person supersedes any request they had
    // pending; verification_requests is not locked, so this stays in code.
    if (membership && isVerified(membership) && membership.verificationMethod === 'domain') {
      await supersedePending(tx, {
        tenantId: tenant.slug,
        userId: actor.userId,
        actorUserId: actor.userId,
      });
    }
    return membership;
  });
}

/** A Postgres `text[]` literal built from a JS array, for a definer argument. */
function pgTextArray(values: readonly string[]) {
  return values.length === 0
    ? sql`array[]::text[]`
    : sql`array[${sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      )}]::text[]`;
}

/** The caller's own membership row inside an open transaction. */
async function readMembership(
  tx: TenantTransaction,
  tenantId: string,
  userId: string,
): Promise<Membership | null> {
  const [row] = await tx
    .select()
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)));
  return row ? toMembership(row) : null;
}

/** A person's own membership in one tenant, or null. Read as themselves. */
export async function membershipFor(userId: string, tenantId: string): Promise<Membership | null> {
  const [row] = await withActor(userId, (tx) =>
    tx
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId))),
  );
  return row ? toMembership(row) : null;
}

export interface MemberPublicFacts {
  /** When they joined this tenant, for a "member since" line, or null if not a member. */
  memberSince: Date | null;
  /** Whether they carry an administrator's reach here — a public "Admin" badge. */
  isAdmin: boolean;
}

/**
 * The public-facing facts about a member of this tenant, for their profile:
 * when they joined, and whether they are an administrator. Nothing sensitive —
 * no name, email or verification status. Runs in the tenant context (the tenant
 * policy admits the membership read), and the admin flag comes from the
 * unforgeable resolver, so a granted admin counts too, not only the seeded one.
 */
export async function memberPublicFacts(
  tenantId: string,
  userId: string,
): Promise<MemberPublicFacts> {
  return withTenant(tenantId, async (tx) => {
    const [membership] = [
      ...(await tx.execute(sql`
        select created_at from tenant_memberships
        where tenant_id = ${tenantId} and user_id = ${userId}::uuid
        limit 1`)),
    ] as { created_at: string | Date }[];
    const admin = [
      ...(await tx.execute(sql`
        select 1 from auth_effective_permissions(${userId}::uuid, ${tenantId})
        where permission = 'manage-members' limit 1`)),
    ];
    return {
      memberSince: membership
        ? membership.created_at instanceof Date
          ? membership.created_at
          : new Date(membership.created_at)
        : null,
      isAdmin: admin.length > 0,
    };
  });
}
