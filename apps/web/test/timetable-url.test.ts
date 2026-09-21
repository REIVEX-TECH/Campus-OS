import { describe, expect, it } from 'vitest';
import {
  buildTimetablePath,
  legacyTimetableRedirect,
  parseTimetableFilters,
} from '@/lib/timetable-url';

describe('buildTimetablePath', () => {
  const base = '/timetable';
  it('builds the full ordered path', () => {
    expect(buildTimetablePath(base, { term: 'T', program: 'P', section: 'S' })).toBe(
      '/timetable/t/T/p/P/s/S',
    );
  });
  it('builds partial prefixes', () => {
    expect(buildTimetablePath(base, {})).toBe('/timetable');
    expect(buildTimetablePath(base, { term: 'T' })).toBe('/timetable/t/T');
    expect(buildTimetablePath(base, { term: 'T', program: 'P' })).toBe('/timetable/t/T/p/P');
  });
  it('drops a child whose parent is missing', () => {
    expect(buildTimetablePath(base, { program: 'P', section: 'S' })).toBe('/timetable');
    expect(buildTimetablePath(base, { term: 'T', section: 'S' })).toBe('/timetable/t/T');
  });
  it('encodes ids and honours the caller base', () => {
    expect(buildTimetablePath('/u/lgu/timetable', { term: 'a/b' })).toBe(
      '/u/lgu/timetable/t/a%2Fb',
    );
  });
});

describe('parseTimetableFilters', () => {
  it('reads the bare picker', () => {
    expect(parseTimetableFilters(undefined)).toEqual({});
    expect(parseTimetableFilters([])).toEqual({});
  });
  it('reads ordered prefixes', () => {
    expect(parseTimetableFilters(['t', 'T'])).toEqual({ term: 'T' });
    expect(parseTimetableFilters(['t', 'T', 'p', 'P'])).toEqual({ term: 'T', program: 'P' });
    expect(parseTimetableFilters(['t', 'T', 'p', 'P', 's', 'S'])).toEqual({
      term: 'T',
      program: 'P',
      section: 'S',
    });
  });
  it('rejects wrong prefix, wrong order, odd length, or empty value', () => {
    expect(parseTimetableFilters(['p', 'P'])).toBeNull(); // program before term
    expect(parseTimetableFilters(['t', 'T', 's', 'S'])).toBeNull(); // section before program
    expect(parseTimetableFilters(['x', 'T'])).toBeNull(); // unknown prefix
    expect(parseTimetableFilters(['t'])).toBeNull(); // odd length
    expect(parseTimetableFilters(['t', ''])).toBeNull(); // empty value
  });
});

describe('legacyTimetableRedirect', () => {
  const sp = (q: string) => new URLSearchParams(q);
  it('maps the full legacy query to the path form (public and dev pathnames)', () => {
    expect(legacyTimetableRedirect('/timetable', sp('term=T&program=P&section=S'))).toBe(
      '/timetable/t/T/p/P/s/S',
    );
    expect(legacyTimetableRedirect('/u/lgu/timetable', sp('term=T&program=P'))).toBe(
      '/u/lgu/timetable/t/T/p/P',
    );
    expect(legacyTimetableRedirect('/timetable', sp('term=T'))).toBe('/timetable/t/T');
  });
  it('collapses orphan params (no term) to the bare picker', () => {
    expect(legacyTimetableRedirect('/timetable', sp('program=P&section=S'))).toBe('/timetable');
  });
  it('does not redirect the bare picker or a non-timetable path', () => {
    expect(legacyTimetableRedirect('/timetable', sp(''))).toBeNull();
    expect(legacyTimetableRedirect('/timetable/t/T', sp('term=X'))).toBeNull(); // already path form
    expect(legacyTimetableRedirect('/teachers', sp('term=T'))).toBeNull();
    expect(legacyTimetableRedirect('/free-rooms', sp('term=T'))).toBeNull();
  });
});
