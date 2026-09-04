import { and, eq, sql } from 'drizzle-orm';
import { withActor, withActorInTenant, type TenantTransaction } from '@campusos/db';
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
 * Writes here run in a TENANT context, because the policy (0008) lets a person
 * read the memberships they hold but never write one. There is exactly one
 * writer, `grantVerified`, and three callers: the domain check at sign in, the
 * configured admin list at sign in, and a tenant admin's decision.
 */

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

/** The part of a tenant's config that names its administrators. */
export interface AdminPolicy {
  slug: string;
  adminEmails: readonly string[];
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

/** Whole address match, case insensitive. */
export function isConfiguredAdmin(email: string, adminEmails: readonly string[]): boolean {
  const wanted = email.trim().toLowerCase();
  return wanted.length > 0 && adminEmails.some((a) => a.trim().toLowerCase() === wanted);
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
      fullName: null,
      rollNumber: null,
      note: null,
    })
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

/**
 * Give a configured administrator their role, on sign in.
 *
 * The list lives in the tenant's config, in code, so granting the role is a
 * reviewed change with a history. Only ever an upgrade. The write is done by
 * `auth_grant_configured_admin` (0019), which checks the actor's OWN email
 * against the list it is handed, so it can only promote the caller — the same
 * shape as the platform bootstrap. Anyone not listed is untouched.
 */
export async function ensureConfiguredAdmin(
  actor: { userId: string; email: string },
  tenant: AdminPolicy,
): Promise<Membership | null> {
  if (!isConfiguredAdmin(actor.email, tenant.adminEmails)) return null;
  return withActorInTenant(actor.userId, tenant.slug, async (tx) => {
    await tx.execute(
      sql`select auth_grant_configured_admin(${tenant.slug}, ${pgTextArray(tenant.adminEmails)})`,
    );
    return readMembership(tx, tenant.slug, actor.userId);
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
