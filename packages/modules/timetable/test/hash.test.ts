import { describe, expect, it } from 'vitest';
import { computeContentHash } from '../src/domain/hash';
import type { TimetableEntryInput } from '../src/domain/types';

const base: TimetableEntryInput = {
  termId: 't1',
  sectionId: 's1',
  courseId: 'c1',
  teacherId: 'te1',
  roomId: 'r1',
  dayOfWeek: 1,
  startsAt: '09:00',
  endsAt: '10:30',
  kind: 'lecture',
  sourceRef: 'src-1',
};

describe('computeContentHash', () => {
  it('is deterministic for equal input', () => {
    expect(computeContentHash(base)).toBe(computeContentHash({ ...base }));
  });

  it('excludes source_ref', () => {
    expect(computeContentHash({ ...base, sourceRef: 'different' })).toBe(computeContentHash(base));
  });

  it('normalizes time format (HH:mm equals HH:mm:ss)', () => {
    expect(computeContentHash({ ...base, startsAt: '09:00:00' })).toBe(computeContentHash(base));
  });

  it.each<[string, Partial<TimetableEntryInput>]>([
    ['termId', { termId: 'x' }],
    ['sectionId', { sectionId: 'x' }],
    ['courseId', { courseId: 'x' }],
    ['teacherId', { teacherId: 'x' }],
    ['roomId', { roomId: 'x' }],
    ['dayOfWeek', { dayOfWeek: 2 }],
    ['startsAt', { startsAt: '08:00' }],
    ['endsAt', { endsAt: '11:00' }],
    ['kind', { kind: 'lab' }],
  ])('changes when %s changes', (_label, patch) => {
    expect(computeContentHash({ ...base, ...patch })).not.toBe(computeContentHash(base));
  });

  it('distinguishes a null resource from a set one', () => {
    expect(computeContentHash({ ...base, teacherId: null })).not.toBe(computeContentHash(base));
  });
});
