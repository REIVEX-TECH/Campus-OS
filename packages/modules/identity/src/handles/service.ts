import { eq, sql } from 'drizzle-orm';
import { withActor } from '@campusos/db';
import { getDb } from '@campusos/db/client';
import { nextAvatarSeed } from '../avatar-seed';
import { handleHistory, users } from '../schema/identity';
import {
  canChangeHandle,
  generateHandle,
  nextChangeAllowedAt,
  reservedUntil,
  validateHandleShape,
  type HandleRejection,
} from './handle';

/**
 * Assigning and changing handles.
 *
 * Uniqueness is the database's answer, not this module's: every path here
 * generates or accepts a candidate, attempts the write, and treats a unique
 * violation as "try again". Checking availability first and writing second would
 * be a race, and the race is exactly the case that matters when two people sign
 * in at the same moment.
 */

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION
  );
}

/** How many random handles to try before giving up and letting the error surface. */
const MAX_ATTEMPTS = 8;

/**
 * Give a user a fresh random handle, retrying past collisions.
 *
 * With over a hundred million combinations a collision is already unlikely; the
 * retry exists so that the unlikely case is boring rather than a failed sign in.
 */
export async function assignGeneratedHandle(userId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = generateHandle();
    try {
      await withActor(userId, (tx) =>
        tx.update(users).set({ handle: candidate }).where(eq(users.id, userId)),
      );
      return candidate;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error('could not find a free handle');
}

export type ChangeHandleResult =
  { ok: true; handle: string } | { ok: false; reason: HandleRejection; nextAllowedAt?: Date };

/**
 * Change a user's handle to one they chose.
 *
 * Three things guard this. The shape and reserved words are checked first, so an
 * obviously bad request costs nothing. The cooldown stops churn, which is what
 * makes a handle worth recognising at all. And the previous handle is reserved
 * for a window afterwards, so nobody can pick up a name someone has just left
 * and be mistaken for them.
 */
export async function changeHandle(userId: string, requested: string): Promise<ChangeHandleResult> {
  const shapeProblem = validateHandleShape(requested);
  if (shapeProblem) return { ok: false, reason: shapeProblem };

  const [current] = await withActor(userId, (tx) =>
    tx.select().from(users).where(eq(users.id, userId)),
  );
  if (!current) return { ok: false, reason: 'taken' };

  if (!canChangeHandle(current.handleChangedAt)) {
    return {
      ok: false,
      reason: 'too_soon',
      nextAllowedAt: nextChangeAllowedAt(current.handleChangedAt) ?? undefined,
    };
  }

  if (current.handle.toLowerCase() === requested.toLowerCase()) {
    // Asking for the handle you already hold is a no-op, not a change, so it
    // must not burn the cooldown.
    return { ok: true, handle: current.handle };
  }

  // Someone else's recently released handle is off limits for the reservation
  // window. The lookup is a definer read because history rows belong to their
  // former owner, not to the person asking.
  const reserved = [
    ...(await getDb().execute(
      sql`select * from auth_handle_is_reserved(${requested}, ${userId}::uuid)`,
    )),
  ];
  if ((reserved[0] as { reserved?: boolean } | undefined)?.reserved) {
    return { ok: false, reason: 'taken' };
  }

  const previous = current.handle;
  try {
    await withActor(userId, async (tx) => {
      await tx
        .update(users)
        .set({ handle: requested, handleChangedAt: new Date() })
        .where(eq(users.id, userId));
      await tx.insert(handleHistory).values({
        userId,
        handle: previous,
        reservedUntil: reservedUntil(),
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'taken' };
    throw error;
  }

  return { ok: true, handle: requested };
}

/** Re roll the generated avatar. It carries no meaning, so it is unrestricted. */
export async function rerollAvatar(userId: string): Promise<string> {
  const seed = nextAvatarSeed(userId, Date.now());
  await withActor(userId, (tx) =>
    tx.update(users).set({ avatarSeed: seed }).where(eq(users.id, userId)),
  );
  return seed;
}
