import { randomInt } from 'node:crypto';
import { ADJECTIVES, NOUNS, RESERVED_EXACT, RESERVED_SUBSTRINGS } from './words';

/**
 * Anonymous handles: the public half of an identity.
 *
 * The verified email is the private link, used for signing in, tenant
 * eligibility, and moderation accountability. The handle is what everyone else
 * sees. Nothing about it is derived from the person, so it cannot leak who they
 * are.
 *
 * These functions are pure. Uniqueness belongs to the database, which holds the
 * only authoritative answer; the caller generates, tries to insert, and retries
 * on conflict. Checking first and inserting second would be a race.
 */

/** `Adjective_Noun_1234`. The shape a generated handle always takes. */
export const HANDLE_PATTERN = /^[A-Za-z]{2,20}_[A-Za-z]{2,20}_\d{4}$/;

/** What someone may type when choosing their own, which is deliberately wider. */
export const CUSTOM_HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;

export const HANDLE_CHANGE_COOLDOWN_DAYS = 30;
/** How long a released handle stays unavailable to anyone else. */
export const HANDLE_RESERVATION_DAYS = 90;

/** A random handle. Not checked for uniqueness: that is the database's job. */
export function generateHandle(): string {
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)]!;
  const noun = NOUNS[randomInt(NOUNS.length)]!;
  // 1000 to 9999, so every generated handle has the same shape and none reads
  // like a serial number starting at zero.
  return `${adjective}_${noun}_${randomInt(1000, 10000)}`;
}

export type HandleRejection =
  | 'format'
  | 'reserved'
  | 'taken'
  /** Changed too recently. */
  | 'too_soon';

/**
 * Is this a handle someone may choose?
 *
 * Only shape and reserved words are decided here. Whether it is already taken,
 * or reserved by its previous owner, needs the database and is answered by the
 * caller.
 */
export function validateHandleShape(handle: string): HandleRejection | null {
  if (!CUSTOM_HANDLE_PATTERN.test(handle)) return 'format';

  const lowered = handle.toLowerCase();
  // Distinctive terms are refused anywhere in the handle, so `SuperAdmin99`
  // cannot borrow the authority that plain `admin` would.
  if (RESERVED_SUBSTRINGS.some((word) => lowered.includes(word))) return 'reserved';

  // Short ones only count as whole parts: `mod` inside `Modest` is nothing, but
  // `the_mod_1` is someone claiming to be a moderator.
  const parts = [lowered, ...lowered.split('_')];
  if (parts.some((part) => RESERVED_EXACT.includes(part))) return 'reserved';

  return null;
}

/** When a handle changed at `changedAt` may next change. */
export function nextChangeAllowedAt(changedAt: Date | null): Date | null {
  if (!changedAt) return null;
  return new Date(changedAt.getTime() + HANDLE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
}

/** May a handle last changed at `changedAt` be changed now? */
export function canChangeHandle(changedAt: Date | null, now: Date = new Date()): boolean {
  const next = nextChangeAllowedAt(changedAt);
  return next === null || now >= next;
}

/** How long a handle released now stays reserved for its former owner. */
export function reservedUntil(now: Date = new Date()): Date {
  return new Date(now.getTime() + HANDLE_RESERVATION_DAYS * 24 * 60 * 60 * 1000);
}
