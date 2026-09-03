import { and, eq } from 'drizzle-orm';
import { withActor, withActorInTenant, type TenantTransaction } from '@campusos/db';
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

/**
 * Create a verified membership, or verify the one that exists. The one writer.
 *
 * Must run in a tenant context. A membership already verified is left exactly
 * as it is; status is never touched, because verifying says who someone is,
 * not whether they are welcome, and a suspension outranks it either way. Two
 * callers racing on a first sign in resolve to the one row the unique index
 * allows. Every change is audited in the caller's transaction.
 */
export async function grantVerified(
  tx: TenantTransaction,
  input: {
    tenantId: string;
    userId: string;
    method: VerificationMethod;
    /** Who caused it: the person themselves at sign in, or an admin. */
    actorUserId: string;
    /** Only for a membership created here. An existing role is never changed. */
    role?: string;
  },
): Promise<{ membership: Membership; created: boolean; alreadyVerified: boolean }> {
  const role = input.role ?? 'student';
  const [inserted] = await tx
    .insert(tenantMemberships)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      role,
      status: 'active',
      verifiedAt: new Date(),
      verificationMethod: input.method,
    })
    .onConflictDoNothing({ target: [tenantMemberships.tenantId, tenantMemberships.userId] })
    .returning();
  if (inserted) {
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      action: 'membership.joined',
      targetType: 'membership',
      targetId: inserted.id,
      meta: { method: input.method, role, targetUserId: input.userId },
    });
    return { membership: toMembership(inserted), created: true, alreadyVerified: false };
  }

  const [existing] = await tx
    .select()
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, input.tenantId),
        eq(tenantMemberships.userId, input.userId),
      ),
    );
  if (!existing) throw new Error('membership vanished between insert and read');
  if (existing.verifiedAt) {
    return { membership: toMembership(existing), created: false, alreadyVerified: true };
  }

  const [updated] = await tx
    .update(tenantMemberships)
    .set({ verifiedAt: new Date(), verificationMethod: input.method })
    .where(eq(tenantMemberships.id, existing.id))
    .returning();
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    tenantId: input.tenantId,
    action: 'membership.verified',
    targetType: 'membership',
    targetId: existing.id,
    meta: { method: input.method, targetUserId: input.userId },
  });
  return { membership: toMembership(updated!), created: false, alreadyVerified: false };
}

/**
 * Give a person their place in a tenant when its policy lets the email decide.
 *
 * Returns null, and writes nothing, unless the tenant joins by domain and the
 * address is on its list. Safe to call on every sign in.
 */
export async function ensureDomainMembership(
  actor: { userId: string; email: string },
  tenant: JoinPolicy,
): Promise<Membership | null> {
  if (tenant.joinMode !== 'domain') return null;
  if (!domainAllowed(actor.email, tenant.allowedEmailDomains)) return null;
  return withActorInTenant(actor.userId, tenant.slug, async (tx) => {
    const granted = await grantVerified(tx, {
      tenantId: tenant.slug,
      userId: actor.userId,
      method: 'domain',
      actorUserId: actor.userId,
    });
    return granted.membership;
  });
}

/**
 * Give a configured administrator their role, on sign in.
 *
 * The list lives in the tenant's config, in code, so granting the role is a
 * reviewed change with a history. This only ever upgrades: a listed address
 * becomes a verified tenant_admin, and an address later removed from the list
 * keeps the role until someone removes it by hand. Anyone not listed is
 * untouched and null is returned.
 */
export async function ensureConfiguredAdmin(
  actor: { userId: string; email: string },
  tenant: AdminPolicy,
): Promise<Membership | null> {
  if (!isConfiguredAdmin(actor.email, tenant.adminEmails)) return null;
  return withActorInTenant(actor.userId, tenant.slug, async (tx) => {
    const granted = await grantVerified(tx, {
      tenantId: tenant.slug,
      userId: actor.userId,
      method: 'config',
      actorUserId: actor.userId,
      role: 'tenant_admin',
    });
    if (granted.membership.role === 'tenant_admin') return granted.membership;

    const [updated] = await tx
      .update(tenantMemberships)
      .set({ role: 'tenant_admin' })
      .where(eq(tenantMemberships.id, granted.membership.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId: tenant.slug,
      action: 'membership.role_granted',
      targetType: 'membership',
      targetId: granted.membership.id,
      meta: { role: 'tenant_admin', source: 'config' },
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
