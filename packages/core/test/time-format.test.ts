import { describe, expect, it } from 'vitest';
import { formatHourLabel, formatTime, formatTimeRange } from '../src/time/format';

describe('formatTime in 12 hour mode', () => {
  it('drops the leading zero and names the half of the day', () => {
    expect(formatTime('08:00', '12h')).toBe('8:00 AM');
    expect(formatTime('09:30', '12h')).toBe('9:30 AM');
    expect(formatTime('13:00', '12h')).toBe('1:00 PM');
    expect(formatTime('14:30', '12h')).toBe('2:30 PM');
  });

  it('gets the edges of the day right', () => {
    expect(formatTime('00:00', '12h')).toBe('12:00 AM');
    expect(formatTime('00:30', '12h')).toBe('12:30 AM');
    expect(formatTime('12:00', '12h')).toBe('12:00 PM');
    expect(formatTime('12:30', '12h')).toBe('12:30 PM');
    expect(formatTime('11:59', '12h')).toBe('11:59 AM');
    expect(formatTime('23:59', '12h')).toBe('11:59 PM');
  });

  it('accepts the seconds the database appends', () => {
    expect(formatTime('09:30:00', '12h')).toBe('9:30 AM');
  });
});

describe('formatTime in 24 hour mode', () => {
  it('keeps the padded clock and never adds a period', () => {
    expect(formatTime('08:00', '24h')).toBe('08:00');
    expect(formatTime('13:00', '24h')).toBe('13:00');
    expect(formatTime('00:00', '24h')).toBe('00:00');
    expect(formatTime('23:59:00', '24h')).toBe('23:59');
  });
});

describe('formatHourLabel', () => {
  it('reads as a ruler: no minutes, no leading zero', () => {
    expect([8, 9, 11, 12, 13, 23].map((h) => formatHourLabel(h, '12h'))).toEqual([
      '8 AM',
      '9 AM',
      '11 AM',
      '12 PM',
      '1 PM',
      '11 PM',
    ]);
    expect(formatHourLabel(0, '12h')).toBe('12 AM');
    expect(formatHourLabel(24, '12h')).toBe('12 AM');
  });

  it('is the padded hour in 24 hour mode', () => {
    expect(formatHourLabel(8, '24h')).toBe('08:00');
    expect(formatHourLabel(13, '24h')).toBe('13:00');
  });
});

describe('formatTimeRange', () => {
  it('formats both ends and leaves the word between to the catalogue', () => {
    expect(formatTimeRange('08:00', '09:30', '12h')).toEqual({ start: '8:00 AM', end: '9:30 AM' });
    expect(formatTimeRange('13:00', '14:30', '24h')).toEqual({ start: '13:00', end: '14:30' });
  });
});

describe('malformed input', () => {
  it('throws rather than rendering nonsense', () => {
    expect(() => formatTime('25:00', '12h')).toThrow();
    expect(() => formatTime('nine', '12h')).toThrow();
    expect(() => formatHourLabel(25, '12h')).toThrow();
  });
});
