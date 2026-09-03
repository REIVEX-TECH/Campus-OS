import { describe, expect, it } from 'vitest';
import {
  busyIntervals,
  freeGaps,
  isBusy,
  mergeIntervals,
  totalMinutes,
  type Slot,
} from '../src/domain/intervals';

const m = (h: number, min = 0): number => h * 60 + min;

describe('mergeIntervals', () => {
  it('coalesces overlapping and touching intervals, sorted', () => {
    expect(
      mergeIntervals([
        { start: m(10), end: m(11) },
        { start: m(9), end: m(10) },
        { start: m(10, 30), end: m(12) },
      ]),
    ).toEqual([{ start: m(9), end: m(12) }]);
  });

  it('leaves a real gap alone and drops empty intervals', () => {
    expect(
      mergeIntervals([
        { start: m(9), end: m(10) },
        { start: m(11), end: m(11) },
        { start: m(11), end: m(12) },
      ]),
    ).toEqual([
      { start: m(9), end: m(10) },
      { start: m(11), end: m(12) },
    ]);
  });
});

describe('busyIntervals', () => {
  const slots: Slot[] = [
    { dayOfWeek: 1, startsAt: '09:30', endsAt: '11:00' },
    { dayOfWeek: 1, startsAt: '10:30:00', endsAt: '12:00:00' },
    { dayOfWeek: 2, startsAt: '08:00', endsAt: '09:00' },
  ];

  it('takes only the asked day and merges what overlaps', () => {
    expect(busyIntervals(slots, 1)).toEqual([{ start: m(9, 30), end: m(12) }]);
    expect(busyIntervals(slots, 2)).toEqual([{ start: m(8), end: m(9) }]);
    expect(busyIntervals(slots, 3)).toEqual([]);
  });

  it('clips to a window when asked', () => {
    expect(busyIntervals(slots, 1, { start: m(10), end: m(11) })).toEqual([
      { start: m(10), end: m(11) },
    ]);
  });
});

describe('isBusy', () => {
  const busy = [{ start: m(9, 30), end: m(11) }];

  it('is the half open overlap: touching is free, crossing is busy', () => {
    expect(isBusy(busy, { start: m(8), end: m(9, 30) })).toBe(false);
    expect(isBusy(busy, { start: m(11), end: m(12, 30) })).toBe(false);
    expect(isBusy(busy, { start: m(9), end: m(10) })).toBe(true);
    expect(isBusy(busy, { start: m(10), end: m(10, 30) })).toBe(true);
    expect(isBusy(busy, { start: m(10, 30), end: m(12) })).toBe(true);
    expect(isBusy(busy, { start: m(9, 30), end: m(11) })).toBe(true);
  });
});

describe('freeGaps', () => {
  it('is the complement of the busy stretches inside the window', () => {
    const busy = [
      { start: m(9), end: m(10) },
      { start: m(11), end: m(12) },
    ];
    expect(freeGaps(busy, { start: m(8), end: m(13) })).toEqual([
      { start: m(8), end: m(9) },
      { start: m(10), end: m(11) },
      { start: m(12), end: m(13) },
    ]);
  });

  it('ignores busy time outside the window and reports the whole window when empty', () => {
    expect(freeGaps([{ start: m(6), end: m(7) }], { start: m(8), end: m(9) })).toEqual([
      { start: m(8), end: m(9) },
    ]);
    expect(freeGaps([], { start: m(8), end: m(9) })).toEqual([{ start: m(8), end: m(9) }]);
  });

  it('reports nothing when the window is fully booked', () => {
    expect(freeGaps([{ start: m(7), end: m(13) }], { start: m(8), end: m(12) })).toEqual([]);
  });
});

describe('totalMinutes', () => {
  it('counts overlap once', () => {
    expect(
      totalMinutes([
        { start: m(9), end: m(11) },
        { start: m(10), end: m(12) },
      ]),
    ).toBe(180);
  });
});
