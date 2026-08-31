import { describe, expect, it } from 'vitest';
import { relativeRedirect } from '../lib/redirects';

describe('relativeRedirect', () => {
  it('emits a root-relative Location, never an absolute upstream URL', () => {
    const res = relativeRedirect('/admin/rooms');
    expect(res.status).toBe(303);
    const location = res.headers.get('location');
    expect(location).toBe('/admin/rooms');
    expect(location?.startsWith('/')).toBe(true);
    expect(location).not.toMatch(/^https?:\/\//);
  });

  it('supports a custom status and preserves the query string', () => {
    const res = relativeRedirect('/timetable?x=1', 308);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/timetable?x=1');
  });
});
