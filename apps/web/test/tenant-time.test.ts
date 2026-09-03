import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHHMM, tenantNow, toHHMM } from '@/lib/tenant-time';

/**
 * "Free now" must be now in the TENANT's timezone. The server runs in UTC and
 * Lahore is five hours ahead, so a server that used its own clock would be five
 * hours wrong all day and, around midnight, a whole weekday wrong.
 */
describe('tenantNow', () => {
  afterEach(() => vi.useRealTimers());

  it('reports the tenant weekday and minutes, not the server clock', () => {
    // Sunday 2026-09-06 21:30 UTC is Monday 2026-09-07 02:30 in Karachi.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T21:30:00Z'));

    const karachi = tenantNow('Asia/Karachi');
    expect(karachi).toEqual({ dayOfWeek: 1, minutes: 2 * 60 + 30 });

    const utc = tenantNow('UTC');
    expect(utc).toEqual({ dayOfWeek: 7, minutes: 21 * 60 + 30 });
  });

  it('uses ISO weekdays, so Sunday is 7 and Monday is 1', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z')); // a Sunday, everywhere
    expect(tenantNow('UTC').dayOfWeek).toBe(7);
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z')); // the Monday after
    expect(tenantNow('UTC').dayOfWeek).toBe(1);
  });

  it('keeps midnight at zero minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T19:00:00Z')); // 00:00 in Karachi
    expect(tenantNow('Asia/Karachi')).toEqual({ dayOfWeek: 2, minutes: 0 });
  });
});

describe('HH:MM helpers', () => {
  it('round trip', () => {
    expect(toHHMM(parseHHMM('09:30')!)).toBe('09:30');
    expect(toHHMM(0)).toBe('00:00');
    expect(toHHMM(23 * 60 + 59)).toBe('23:59');
  });

  it('refuses anything that is not a 24 hour clock time', () => {
    expect(parseHHMM('9:30')).toBeNull();
    expect(parseHHMM('09:30 AM')).toBeNull();
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM(undefined)).toBeNull();
  });
});
