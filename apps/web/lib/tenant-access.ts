import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { withGrantedTenant, type TenantWriteContext } from '@campusos/db';
import { PermissionSet, type Permission } from '@campusos/core';
import {
  effectivePermissions,
  effectivePermissionsInTransaction,
} from '@campusos/module-identity/rbac';
import { isPlatformAdmin } from '@campusos/module-identity/platform';
import { membershipFor } from '@campusos/module-identity/membership';
import { type Actor } from '@campusos/module-identity/sessions';
import { currentActor, currentPlatformActor } from '@/lib/auth';

/**
 * The single boundary for reaching a tenant's admin surfaces.
 *
 * A request acts in ONE of two contexts, and this decides which, once per
 * request (React `cache`), so a page and its layout agree and stamp one grant
 * use row between them:
 *
 *  - GRANT: the actor is a platform admin with an open grant FOR THIS SLUG.
 *    Precedence is deliberate: opening a grant is an explicit, audited act, so
 *    its presence signals intent and wins even over a membership the same person
 *    holds. Permissions resolve through the grant branch (tenant_admin minus
 *    communities.unmask).
 *  - MEMBER: the actor's own membership in this tenant.
 *
 * There is no silent fallback in either direction. A grant whose tenant is NOT
 * this slug, or an absent/expired/timed-out grant for a platform admin who is not
 * a member here, is a typed redirect to /admin?grant=expired (reopen on purpose),
 * never a quiet drop to the member path. A member with no grant resolves as a member.
 */

export type TenantAccess = { kind: 'grant'; grant: TenantAccessGrant } | { kind: 'member' };

/** The resolved context, exposed for callers that must branch on all cases (the
 * bare /admin entry): 'anon' (no session), 'redirect' (platform admin, no grant
 * for this slug, not a member), or the active context with its permissions. */
export type PageAccess =
  | { kind: 'anon' }
  | { kind: 'redirect' }
  | { kind: 'grant'; actor: Actor; permissions: PermissionSet; grant: TenantAccessGrant }
  | { kind: 'member'; actor: Actor; permissions: PermissionSet };

type Resolved = PageAccess;

export type TenantAccessGrant = {
  grantId: string;
  tenantId: string;
  expiresAt: Date;
  reason: string;
};

/** Our own signal that the open grant is for a different tenant than the URL. */
class GrantTenantMismatch extends Error {}

function isNoOpenGrant(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown };
  return (
    e?.code === '42501' &&
    typeof e.message === 'string' &&
    e.message.includes('no open tenant grant')
  );
}

/** A granted statement that ran past the 10s bound (statement_timeout). Treated
 * like a vanished grant: the request cannot complete under the grant, so it ends
 * at the reopen banner rather than a raw 500. */
function isStatementTimeout(error: unknown): boolean {
  return (error as { code?: unknown })?.code === '57014';
}

/** Enter the actor's open grant, but only accept it for THIS slug. Returns the
 * granted resolution, or null when there is no usable grant for this slug (no
 * open grant, or an open grant for a different tenant). */
async function tryGrant(
  actor: Actor,
  pa: { userId: string; sessionId: string },
  slug: string,
): Promise<Extract<Resolved, { kind: 'grant' }> | null> {
  try {
    return await withGrantedTenant(pa, async (tx, grant) => {
      if (grant.tenantId !== slug) throw new GrantTenantMismatch();
      const perms = await effectivePermissionsInTransaction(tx, pa.userId, slug);
      return {
        kind: 'grant' as const,
        actor,
        permissions: new PermissionSet([...perms]),
        grant: {
          grantId: grant.grantId,
          tenantId: grant.tenantId,
          expiresAt: grant.expiresAt,
          reason: grant.reason,
        },
      };
    });
  } catch (error) {
    // A grant for another tenant, none at all, or one that expired/timed out
    // mid-request all mean "no usable grant for this slug"; the caller turns that
    // into the typed reopen redirect. The mismatch transaction rolls back, so no
    // stray use row.
    if (error instanceof GrantTenantMismatch || isNoOpenGrant(error) || isStatementTimeout(error)) {
      return null;
    }
    throw error;
  }
}

const resolveAccess = cache(async (slug: string): Promise<Resolved> => {
  const actor = await currentActor();
  if (!actor) return { kind: 'anon' };
  const pa = await currentPlatformActor();
  if (pa && (await isPlatformAdmin(actor.userId))) {
    const granted = await tryGrant(actor, pa, slug);
    if (granted) return granted;
    // No grant for this slug: a member here uses their membership; a platform
    // admin who is not a member is sent to open a grant, never dropped silently.
    const member = await membershipFor(actor.userId, slug);
    if (!member) return { kind: 'redirect' };
  }
  const permissions = await effectivePermissions(actor.userId, slug);
  return { kind: 'member', actor, permissions };
});

function grantEndedRedirect(slug: string): never {
  // A platform admin reached a granted surface with no active grant for it: it
  // expired, timed out, or was closed mid-session (the normal entry is opening a
  // grant from /admin, which lands them inside). Send them back with a typed
  // signal so /admin shows a clear "reopen" banner, never a bare 404 or a 500.
  redirect(`/admin?grant=expired&tenant=${encodeURIComponent(slug)}`);
}

/** The resolved access for a slug, all cases exposed. The bare /admin entry uses
 * this to branch (anon to sign in, redirect to reopen, otherwise route by the
 * permission set); most pages use accessForPage instead. Resolved once per
 * request and shared with the layout. */
export async function tenantAccess(slug: string): Promise<PageAccess> {
  return resolveAccess(slug);
}

/**
 * For the admin layout: the active access context (to render the banner), or a
 * redirect/404. Never returns for an actor with no way in.
 */
export async function tenantAccessContext(slug: string): Promise<TenantAccess> {
  const r = await resolveAccess(slug);
  if (r.kind === 'redirect') grantEndedRedirect(slug);
  if (r.kind === 'anon') notFound();
  return r.kind === 'grant' ? { kind: 'grant', grant: r.grant } : { kind: 'member' };
}

/**
 * For an admin mutation (route handler): the actor and the write context to pass
 * into the identity mutation, or null when the caller may not write here.
 *
 * The permission is checked in the resolved context (grant or member); the 0019
 * definer re-checks it and applies the not-self-under-grant containment, so this
 * is the first of two checks. Returning `via: 'grant'` makes the mutation carry
 * the grant use row into the definer; there is no silent member fallback (a
 * platform admin with no grant for this slug, and no membership, is null / 404).
 */
export async function tenantWriteContext(
  slug: string,
  permission: Permission,
): Promise<{ actor: Actor; access: TenantWriteContext } | null> {
  const r = await resolveAccess(slug);
  if (r.kind === 'anon' || r.kind === 'redirect') return null;
  if (!r.permissions.has(permission)) return null;
  if (r.kind === 'grant') {
    const pa = await currentPlatformActor();
    if (!pa) return null; // a grant implies a live session; defensive
    return { actor: r.actor, access: { via: 'grant', sessionId: pa.sessionId } };
  }
  return { actor: r.actor, access: { via: 'member' } };
}

/**
 * For an admin page: the actor and their permissions in the active context, or a
 * 404 (no permission) / redirect (platform admin, no grant for this slug). This
 * replaces requirePermission on every tenant-admin page so the grant path is a
 * boundary, not a per-page convention.
 */
export async function accessForPage(
  slug: string,
  permission: Permission,
): Promise<{ actor: Actor; permissions: PermissionSet; access: TenantAccess }> {
  const r = await resolveAccess(slug);
  if (r.kind === 'redirect') grantEndedRedirect(slug);
  if (r.kind === 'anon') notFound();
  if (!r.permissions.has(permission)) notFound();
  const access: TenantAccess =
    r.kind === 'grant' ? { kind: 'grant', grant: r.grant } : { kind: 'member' };
  return { actor: r.actor, permissions: r.permissions, access };
}
