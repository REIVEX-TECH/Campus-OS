import { createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { effectivePermissions } from '@campusos/module-identity/rbac';
import type { Permission, PermissionSet } from '@campusos/core';
import { resolveSession, type Actor } from '@campusos/module-identity/sessions';
import { clientKey } from './rate-limit';

/**
 * Who is signed in, for server components and route handlers.
 *
 * Admin surfaces gate on a permission held in the tenant, resolved on this
 * request by `requirePermission`; there is no other guard. Reading the actor
 * is always safe on a public page, which is the point: the timetable must
 * keep working signed out.
 */

export const SESSION_COOKIE = 'campusos_session';

/** Cookie options. Kept in one place so the route handlers cannot disagree. */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // Lax rather than Strict: a link from an email or another site should still
    // land the reader on a page that knows them. Sign in itself is a POST from
    // our own origin, so Lax is enough to blunt cross-site submission.
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  };
}

/**
 * The current actor, or null when nobody is signed in.
 *
 * Every call resolves the session against the database rather than trusting
 * anything in the cookie beyond the opaque token, so revoking a session takes
 * effect on the very next request.
 */
export async function currentActor(): Promise<Actor | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(token);
}

/**
 * A coarse, non-identifying fingerprint of the caller, stored with a session so
 * a user can recognise their own devices later. Hashed because CLAUDE.md 8 keeps
 * PII out of storage: this can confirm "same client" without recording who or
 * where they are.
 */
export async function requestFingerprint(): Promise<{ userAgent?: string; ipHash?: string }> {
  const h = await headers();
  const userAgent = h.get('user-agent') ?? undefined;
  // The proxy vouched address, the same one the rate limiter keys on.
  const address = clientKey(h);
  return {
    userAgent,
    ipHash: address !== 'unknown' ? createHash('sha256').update(address).digest('hex') : undefined,
  };
}

/**
 * What the signed in person may do in this tenant, or nothing.
 *
 * Cheap for a stranger: with no session cookie this never reaches the database.
 * The answer comes from a definer function scoped to one user and one tenant, so
 * asking it cannot reveal anyone else's roles.
 */
export async function currentPermissions(slug: string): Promise<PermissionSet | null> {
  const actor = await currentActor();
  if (!actor) return null;
  return effectivePermissions(actor.userId, slug);
}

export interface PermittedActor {
  actor: Actor;
  permissions: PermissionSet;
}

/** The actor if they hold this permission here, else null. */
export async function permitted(
  slug: string,
  permission: Permission,
): Promise<PermittedActor | null> {
  const actor = await currentActor();
  if (!actor) return null;
  const permissions = await effectivePermissions(actor.userId, slug);
  return permissions.has(permission) ? { actor, permissions } : null;
}

/**
 * As above, for a page: anyone without the permission gets a 404 rather than a
 * refusal, so an admin surface never confirms its own existence. Every mutation
 * behind this re-checks inside its own transaction, so this is the first of two
 * checks and never the only one.
 */
export async function requirePermission(
  slug: string,
  permission: Permission,
): Promise<PermittedActor> {
  const allowed = await permitted(slug, permission);
  if (!allowed) notFound();
  return allowed;
}
