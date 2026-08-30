import { describe, expect, it } from 'vitest';
import { detectConflicts, type ConflictEntry } from '../src/domain/conflicts';

const e = (over: Partial<ConflictEntry> & { id: string }): ConflictEntry => ({
  teacherId: null,
  roomId: null,
  dayOfWeek: 1,
  startsAt: '09:00',
  endsAt: '10:00',
  ...over,
});

describe('detectConflicts', () => {
  it('flags a teacher double-booked with overlap on the same day', () => {
    const conflicts = detectConflicts([
      e({ id: 'a', teacherId: 't1', startsAt: '09:00', endsAt: '10:00' }),
      e({ id: 'b', teacherId: 't1', startsAt: '09:30', endsAt: '10:30' }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ type: 'teacher', a: 'a', b: 'b' });
  });

  it('flags a room double-booked', () => {
    const conflicts = detectConflicts([
      e({ id: 'a', roomId: 'r1' }),
      e({ id: 'b', roomId: 'r1', startsAt: '09:30', endsAt: '10:30' }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe('room');
  });

  it('does not flag entries on different days', () => {
    const conflicts = detectConflicts([
      e({ id: 'a', teacherId: 't1', dayOfWeek: 1 }),
      e({ id: 'b', teacherId: 't1', dayOfWeek: 2 }),
    ]);
    expect(conflicts).toEqual([]);
  });

  it('does not flag mere adjacency', () => {
    const conflicts = detectConflicts([
      e({ id: 'a', teacherId: 't1', startsAt: '09:00', endsAt: '10:00' }),
      e({ id: 'b', teacherId: 't1', startsAt: '10:00', endsAt: '11:00' }),
    ]);
    expect(conflicts).toEqual([]);
  });

  it('flags both teacher and room when both clash', () => {
    const conflicts = detectConflicts([
      e({ id: 'a', teacherId: 't1', roomId: 'r1' }),
      e({ id: 'b', teacherId: 't1', roomId: 'r1', startsAt: '09:30', endsAt: '10:30' }),
    ]);
    expect(conflicts.map((c) => c.type).sort()).toEqual(['room', 'teacher']);
  });
});
