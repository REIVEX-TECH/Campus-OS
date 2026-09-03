import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { withActor } from '@campusos/db';
import { getDb } from '@campusos/db/client';
import type { VerifiedIdentity } from '@campusos/core/auth';
import { generateHandle } from './handles/handle';
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
  /** Seeds the generated avatar. Re rollable, and carries no meaning. */
  avatarSeed: string;
  /** When the handle last changed, for the cooldown. Null if never. */
  handleChangedAt: Date | null;
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
  const found = existing[0] as
    | {
        user_id?: string;
        handle?: string;
        email?: string;
        avatar_seed?: string;
        handle_changed_at?: Date | null;
      }
    | undefined;
  if (found?.user_id) {
    const actor: Actor = {
      userId: found.user_id,
      handle: found.handle!,
      email: found.email!,
      avatarSeed: found.avatar_seed ?? found.user_id,
      handleChangedAt: found.handle_changed_at ?? null,
    };
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
  // A collision is vanishingly unlikely and the unique index would catch it;
  // the retry that handles it properly lives in assignGeneratedHandle.
  const handle = generateHandle();
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
  return {
    userId,
    handle,
    email: identity.email,
    avatarSeed: userId,
    handleChangedAt: null,
  };
}

/** Issue a session for a user. The plaintext token is returned only here. */
export async function issueSession(
  actor: Actor,
  context: { userAgent?: string } = {},
): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await withActor(actor.userId, async (tx) => {
    await tx.insert(sessions).values({
      userId: actor.userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: context.userAgent ?? null,
    });
    // A sign in is the one moment both timing marks move together. Timing
    // only: nothing about where the request came from is kept.
    await tx
      .update(users)
      .set({ lastLoginAt: now, lastSeenAt: now })
      .where(eq(users.id, actor.userId));
  });
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
  return {
    userId: user.id,
    handle: user.handle,
    email: user.email,
    avatarSeed: user.avatarSeed,
    handleChangedAt: user.handleChangedAt,
  };
}

/**
 * Record that a session is still in use, at most once an hour. Writing on every
 * request would make each page load a write for no extra information.
 */
async function touch(userId: string, sessionId: string): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - TOUCH_AFTER_MINUTES * 60 * 1000);
  await withActor(userId, async (tx) => {
    await tx
      .update(sessions)
      .set({ lastUsedAt: now })
      .where(and(eq(sessions.id, sessionId), lt(sessions.lastUsedAt, cutoff)));
    // The same hourly mark on the person, so "active this week" is one read.
    await tx
      .update(users)
      .set({ lastSeenAt: now })
      .where(and(eq(users.id, userId), or(isNull(users.lastSeenAt), lt(users.lastSeenAt, cutoff))));
  });
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
