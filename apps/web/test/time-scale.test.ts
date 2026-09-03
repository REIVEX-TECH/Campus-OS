import { describe, expect, it } from 'vitest';
import { assignLanes, bounds, minutes } from '../app/_components/views/time-scale';

describe('minutes', () => {
  it('parses HH:MM and HH:MM:SS to minutes since midnight', () => {
    expect(minutes('08:00')).toBe(480);
    expect(minutes('09:30:00')).toBe(570);
    expect(minutes('00:00')).toBe(0);
  });
});

describe('bounds', () => {
  it('returns the earliest start and latest end', () => {
    expect(
      bounds([
        { startsAt: '09:30', endsAt: '11:00' },
        { startsAt: '08:00', endsAt: '09:30' },
      ]),
    ).toEqual({ start: 480, end: 660 });
  });
  it('is null for no intervals', () => {
    expect(bounds([])).toBeNull();
  });
});

describe('assignLanes', () => {
  it('gives non-overlapping intervals a single full-width lane', () => {
    const out = assignLanes([
      { startsAt: '08:00', endsAt: '09:30' },
      { startsAt: '09:30', endsAt: '11:00' },
      { startsAt: '12:30', endsAt: '14:00' },
    ]);
    expect(out.every((o) => o.lane === 0 && o.lanes === 1)).toBe(true);
  });

  it('splits a pair of overlapping intervals into two lanes', () => {
    const out = assignLanes([
      { startsAt: '08:00', endsAt: '10:00' },
      { startsAt: '09:00', endsAt: '11:00' },
    ]);
    expect(out.map((o) => ({ lane: o.lane, lanes: o.lanes }))).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
    ]);
  });

  it('keeps separate overlap clusters independent', () => {
    // Two overlap (cluster A, 2 lanes), then one standalone (cluster B, 1 lane).
    const out = assignLanes([
      { startsAt: '08:00', endsAt: '10:00' },
      { startsAt: '09:00', endsAt: '11:00' },
      { startsAt: '13:00', endsAt: '14:00' },
    ]);
    const standalone = out.find((o) => o.startsAt === '13:00')!;
    expect(standalone.lanes).toBe(1);
    expect(out.filter((o) => o.startsAt !== '13:00').every((o) => o.lanes === 2)).toBe(true);
  });
});
