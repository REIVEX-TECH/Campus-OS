import { and, eq } from 'drizzle-orm';
import { withActor, withActorInTenant } from '@campusos/db';
import { recordAudit } from './audit';
import { tenantMemberships } from './schema/identity';

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
 * read the memberships they hold but never write one. The only things that can
 * create or change a membership are this file's domain check, whose inputs are
 * the verified email from the provider and the tenant's own config, and later a
 * tenant admin acting inside their tenant.
 */

export type VerificationMethod = 'domain' | 'admin';

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

/**
 * Give a person their place in a tenant when its policy lets the email decide.
 *
 * Returns null, and writes nothing, unless the tenant joins by domain and the
 * address is on its list. Otherwise the membership is created as a verified
 * student, or an existing unverified one is marked verified. Safe to call on
 * every sign in: a verified membership is left exactly as it is, and two first
 * sign ins racing each other resolve to the one row the unique index allows.
 */
export async function ensureDomainMembership(
  actor: { userId: string; email: string },
  tenant: JoinPolicy,
): Promise<Membership | null> {
  if (tenant.joinMode !== 'domain') return null;
  if (!domainAllowed(actor.email, tenant.allowedEmailDomains)) return null;

  return withActorInTenant(actor.userId, tenant.slug, async (tx) => {
    const own = and(
      eq(tenantMemberships.tenantId, tenant.slug),
      eq(tenantMemberships.userId, actor.userId),
    );
    const [inserted] = await tx
      .insert(tenantMemberships)
      .values({
        tenantId: tenant.slug,
        userId: actor.userId,
        role: 'student',
        status: 'active',
        verifiedAt: new Date(),
        verificationMethod: 'domain',
      })
      .onConflictDoNothing({ target: [tenantMemberships.tenantId, tenantMemberships.userId] })
      .returning();
    if (inserted) {
      await recordAudit(tx, {
        actorUserId: actor.userId,
        tenantId: tenant.slug,
        action: 'membership.joined',
        targetType: 'membership',
        targetId: inserted.id,
        meta: { method: 'domain', role: 'student' },
      });
      return toMembership(inserted);
    }

    const [existing] = await tx.select().from(tenantMemberships).where(own);
    if (!existing) throw new Error('membership vanished between insert and read');
    if (existing.verifiedAt) return toMembership(existing);

    // Status is deliberately left alone: verifying says who someone is, not
    // whether they are welcome, and a suspension outranks it either way.
    const [updated] = await tx
      .update(tenantMemberships)
      .set({ verifiedAt: new Date(), verificationMethod: 'domain' })
      .where(eq(tenantMemberships.id, existing.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId: tenant.slug,
      action: 'membership.verified',
      targetType: 'membership',
      targetId: existing.id,
      meta: { method: 'domain' },
    });
    return toMembership(updated!);
  });
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
