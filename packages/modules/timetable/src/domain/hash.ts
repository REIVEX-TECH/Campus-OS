import { createHash } from 'node:crypto';
import type { HashedEntry, TimetableEntryInput } from './types';
import { normalizeTime } from './time';

const SEP = '␟'; // unit separator, unlikely to appear in values

/**
 * Deterministic content hash of a slot. See docs/versioning.md for the
 * authoritative field list. Hashed: term, section, course, teacher, room,
 * day_of_week, starts_at, ends_at, kind. EXCLUDED: tenant_id (per-tenant
 * uniqueness is enforced by the partial unique index and the diff is
 * tenant+term scoped), source_ref (provenance), and all temporal columns.
 */
export function computeContentHash(entry: TimetableEntryInput): string {
  const parts = [
    entry.termId,
    entry.sectionId,
    entry.courseId,
    entry.teacherId ?? '',
    entry.roomId ?? '',
    String(entry.dayOfWeek),
    normalizeTime(entry.startsAt),
    normalizeTime(entry.endsAt),
    entry.kind,
  ];
  return createHash('sha256').update(parts.join(SEP)).digest('hex');
}

export function withHash(entry: TimetableEntryInput): HashedEntry {
  return { ...entry, contentHash: computeContentHash(entry) };
}
