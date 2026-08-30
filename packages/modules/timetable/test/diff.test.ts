import { describe, expect, it } from 'vitest';
import { planTimetableDiff } from '../src/domain/diff';
import { computeContentHash } from '../src/domain/hash';
import type { CurrentEntryRef, TimetableEntryInput } from '../src/domain/types';

const mk = (over: Partial<TimetableEntryInput> = {}): TimetableEntryInput => ({
  termId: 't1',
  sectionId: 's1',
  courseId: 'c1',
  teacherId: 'te1',
  roomId: 'r1',
  dayOfWeek: 1,
  startsAt: '09:00',
  endsAt: '10:30',
  kind: 'lecture',
  ...over,
});

const ref = (id: string, e: TimetableEntryInput): CurrentEntryRef => ({
  id,
  contentHash: computeContentHash(e),
});

describe('planTimetableDiff', () => {
  it('inserts new, closes missing, and keeps unchanged', () => {
    const kept = mk();
    const removed = mk({ startsAt: '11:00', endsAt: '12:00' });
    const added = mk({ roomId: 'r2', startsAt: '13:00', endsAt: '14:00' });

    const plan = planTimetableDiff([ref('k', kept), ref('r', removed)], [kept, added]);

    expect(plan.unchanged).toBe(1);
    expect(plan.toCloseIds).toEqual(['r']);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toInsert[0]?.contentHash).toBe(computeContentHash(added));
  });

  it('is idempotent for an identical snapshot', () => {
    const a = mk();
    const b = mk({ startsAt: '11:00', endsAt: '12:00' });
    const plan = planTimetableDiff([ref('0', a), ref('1', b)], [a, b]);

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toCloseIds).toHaveLength(0);
    expect(plan.unchanged).toBe(2);
  });

  it('inserts duplicate incoming entries only once', () => {
    const a = mk();
    const plan = planTimetableDiff([], [a, { ...a }]);
    expect(plan.toInsert).toHaveLength(1);
  });
});
