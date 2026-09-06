import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isPlatformAdmin } from '@campusos/module-identity/platform';
import {
  resolveSession,
  resolveSessionActor,
  type Actor,
} from '@campusos/module-identity/sessions';

/**
 * Who is signed in, for server components and route handlers.
 *
 * Admin surfaces gate on a permission held in the tenant, resolved on this
 * request through the tenant-access seam; there is no other guard. Reading the
 * actor is always safe on a public page, which is the point: the timetable must
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

// The tenant permission gates (currentPermissions / permitted / requirePermission)
// were removed with Phase 5B: every tenant-admin surface resolves access through
// the tenant-access seam (accessForPage / tenantAccess / tenantWriteContext),
// which applies the platform-grant path uniformly. A direct permission gate here
// would be a bypass of that boundary, so it no longer exists; the
// admin-seam-boundary test also forbids the names from returning.

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
