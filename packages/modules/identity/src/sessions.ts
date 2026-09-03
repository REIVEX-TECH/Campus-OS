import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { withActor } from '@campusos/db';
import { getDb } from '@campusos/db/client';
import type { VerifiedIdentity } from '@campusos/core/auth';
import { sessions, users } from './schema/identity';

/**
 * Sign in, sessions, and the lookup that authenticates every request.
 *
 * Sessions are opaque random tokens, not JWTs, so signing out is immediate: the
 * row is revoked and the next request fails. Only the sha256 of a token is
 * stored, so a database dump yields no usable session.
 */

/** Absolute lifetime. A session cannot outlive this however active it is. */
const SESSION_DAYS = 30;
/** How stale `last_used_at` may get before a request pays to refresh it. */
const TOUCH_AFTER_MINUTES = 60;

export interface Actor {
  userId: string;
  handle: string;
  email: string;
}

export interface IssuedSession {
  /** The plaintext token. Returned once, at issue, and never stored. */
  token: string;
  expiresAt: Date;
  actor: Actor;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * A first handle, so a user row can exist before handles are properly generated.
 *
 * Deliberately unmistakable for a chosen name and unique by construction, so it
 * cannot collide while the real generator (adjective, noun, number) is still to
 * come. Nothing is derived from the person's name or email.
 */
function placeholderHandle(userId: string): string {
  return `Member_${userId.replace(/-/g, '').slice(0, 10)}`;
}

/**
 * Find the user behind a verified identity, creating them on first sign in.
 *
 * The row is written under its own actor context because RLS requires a row to
 * claim its own identity to exist: the id is generated first, then used as the
 * context it is inserted under.
 */
export async function findOrCreateUser(identity: VerifiedIdentity): Promise<Actor> {
  // The lookup is by provider subject, which survives an email change, and is
  // done without an actor context, so it goes through the same narrow definer
  // path the session lookup uses rather than widening the own-row policy.
  const existing = [
    ...(await getDb().execute(
      sql`select * from auth_resolve_user_by_subject(${identity.subject})`,
    )),
  ];
  const found = existing[0] as { user_id?: string; handle?: string; email?: string } | undefined;
  if (found?.user_id) {
    const actor = { userId: found.user_id, handle: found.handle!, email: found.email! };
    // An email can change upstream; the subject is what identifies the person.
    if (found.email !== identity.email) {
      await withActor(actor.userId, (tx) =>
        tx.update(users).set({ email: identity.email }).where(eq(users.id, actor.userId)),
      );
      actor.email = identity.email;
    }
    return actor;
  }

  const userId = randomUUID();
  const handle = placeholderHandle(userId);
  await withActor(userId, (tx) =>
    tx.insert(users).values({
      id: userId,
      googleSub: identity.subject,
      email: identity.email,
      emailVerifiedAt: new Date(),
      handle,
      avatarSeed: userId,
    }),
  );
  return { userId, handle, email: identity.email };
}

/** Issue a session for a user. The plaintext token is returned only here. */
export async function issueSession(
  actor: Actor,
  context: { userAgent?: string; ipHash?: string } = {},
): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await withActor(actor.userId, (tx) =>
    tx.insert(sessions).values({
      userId: actor.userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: context.userAgent ?? null,
      ipHash: context.ipHash ?? null,
    }),
  );
  return { token, expiresAt, actor };
}

/**
 * Who is making this request, or null.
 *
 * The token is resolved through `auth_resolve_session`, the one privileged read
 * in the system: resolving a session happens before the user is known, so it
 * cannot satisfy the own-row policy. Everything after it runs under that user's
 * own context.
 */
export async function resolveSession(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const rows = [
    ...(await getDb().execute(sql`select * from auth_resolve_session(${hashToken(token)})`)),
  ];
  const row = rows[0] as { user_id?: string; session_id?: string } | undefined;
  if (!row?.user_id) return null;

  const [user] = await withActor(row.user_id, (tx) =>
    tx.select().from(users).where(eq(users.id, row.user_id!)),
  );
  if (!user || user.status !== 'active') return null;

  await touch(row.user_id, row.session_id!);
  return { userId: user.id, handle: user.handle, email: user.email };
}

/**
 * Record that a session is still in use, at most once an hour. Writing on every
 * request would make each page load a write for no extra information.
 */
async function touch(userId: string, sessionId: string): Promise<void> {
  const cutoff = new Date(Date.now() - TOUCH_AFTER_MINUTES * 60 * 1000);
  await withActor(userId, (tx) =>
    tx
      .update(sessions)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), sql`${sessions.lastUsedAt} < ${cutoff}`)),
  );
}

/** Sign out: the session stops working immediately, everywhere. */
export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  const rows = [
    ...(await getDb().execute(sql`select * from auth_resolve_session(${hashToken(token)})`)),
  ];
  const row = rows[0] as { user_id?: string; session_id?: string } | undefined;
  if (!row?.user_id) return;
  await withActor(row.user_id, (tx) =>
    tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, row.session_id!), isNull(sessions.revokedAt))),
  );
}
