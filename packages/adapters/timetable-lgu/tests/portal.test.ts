import { describe, expect, it } from 'vitest';
import { fixtureFor, fixtureName, parseOptions, PORTAL_PATHS } from '../src/portal';

describe('parseOptions', () => {
  it('parses closed, double-quoted options (ajax responses)', () => {
    const html = `<option value="">Select</option><option value="1">BSCS</option><option value="2">BSSE</option>`;
    expect(parseOptions(html)).toEqual([
      { value: '1', label: 'BSCS' },
      { value: '2', label: 'BSSE' },
    ]);
  });

  it('parses unclosed, single-quoted options (semester panel)', () => {
    const html =
      `<select><option>--Select--\n` +
      `<option value='1st Semester Fa-2026 / Fa-2026'> 1st Semester Fa-2026 / Fa-2026\n` +
      `<option value='2nd Semester Fa-2026 / Sp-2026'> 2nd Semester Fa-2026 / Sp-2026\n</select>`;
    const opts = parseOptions(html);
    expect(opts).toHaveLength(2);
    expect(opts[0]).toEqual({
      value: '1st Semester Fa-2026 / Fa-2026',
      label: '1st Semester Fa-2026 / Fa-2026',
    });
    expect(opts[1]?.value).toBe('2nd Semester Fa-2026 / Sp-2026');
  });
});

describe('fixtureFor', () => {
  it('maps endpoint + params to a fixture filename', () => {
    expect(fixtureFor(PORTAL_PATHS.semesterPanel, {})).toBe('semester-panel.html');
    expect(fixtureFor(PORTAL_PATHS.ajax, { semester: 'S' })).toBe(fixtureName.degrees('S'));
    expect(fixtureFor(PORTAL_PATHS.ajax, { semester: 'S', program: '1' })).toBe(
      fixtureName.sections('S', '1'),
    );
    expect(
      fixtureFor(PORTAL_PATHS.sectionTimetable, { semester: 'S', program: '1', section: '2' }),
    ).toBe(fixtureName.timetable('S', '1', '2'));
  });
});
