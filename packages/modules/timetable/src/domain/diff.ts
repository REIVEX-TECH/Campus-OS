import { computeContentHash } from './hash';
import type { CurrentEntryRef, DiffPlan, HashedEntry, TimetableEntryInput } from './types';

/**
 * Plan the transition from the current valid entries to an incoming snapshot,
 * diffing by content hash within a scope (e.g. a term). New hashes are inserted,
 * disappeared hashes are closed (valid_to set), matching hashes are untouched.
 * Idempotent: re-running the same snapshot yields empty toInsert/toCloseIds.
 * Duplicate incoming entries (same hash) are inserted once.
 */
export function planTimetableDiff(
  current: readonly CurrentEntryRef[],
  incoming: readonly TimetableEntryInput[],
): DiffPlan {
  const hashed: HashedEntry[] = incoming.map((entry) => ({
    ...entry,
    contentHash: computeContentHash(entry),
  }));

  const currentHashes = new Set(current.map((c) => c.contentHash));
  const incomingHashes = new Set(hashed.map((e) => e.contentHash));

  const seen = new Set<string>();
  const toInsert: HashedEntry[] = [];
  for (const entry of hashed) {
    if (!currentHashes.has(entry.contentHash) && !seen.has(entry.contentHash)) {
      toInsert.push(entry);
    }
    seen.add(entry.contentHash);
  }

  const toCloseIds = current.filter((c) => !incomingHashes.has(c.contentHash)).map((c) => c.id);
  const unchanged = current.filter((c) => incomingHashes.has(c.contentHash)).length;

  return { toInsert, toCloseIds, unchanged };
}
