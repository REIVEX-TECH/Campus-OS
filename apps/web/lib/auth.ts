import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isPlatformAdmin } from '@campusos/module-identity/platform';
import { effectivePermissions } from '@campusos/module-identity/rbac';
import type { Permission, PermissionSet } from '@campusos/core';
import {
  resolveSession,
  resolveSessionActor,
  type Actor,
} from '@campusos/module-identity/sessions';

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

/** The current session as {userId, sessionId}, for re-entering a platform grant
 * (withGrantedTenant needs the session id). Null if signed out. */
export async function currentPlatformActor(): Promise<{
  userId: string;
  sessionId: string;
} | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSessionActor(token);
}

/**
 * What is kept with a session about the client: the user agent, so a person can
 * recognise their own devices later, and nothing else. Where a request came
 * from is never stored, hashed or otherwise (design doc 3).
 */
export async function requestFingerprint(): Promise<{ userAgent?: string }> {
  const h = await headers();
  return { userAgent: h.get('user-agent') ?? undefined };
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

export interface PlatformAdmin {
  actor: Actor;
}

/**
 * The signed in platform administrator, or null: a `platform_roles` row, read
 * as the person themselves on this request. Never a cookie claim, never the
 * environment; `SUPERADMIN_EMAILS` only decides who may get the row at sign in.
 */
export async function platformAdmin(): Promise<PlatformAdmin | null> {
  const actor = await currentActor();
  if (!actor) return null;
  return (await isPlatformAdmin(actor.userId)) ? { actor } : null;
}

/** As above, for a page: anyone else gets a 404, not a hint. */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await platformAdmin();
  if (!admin) notFound();
  return admin;
}
