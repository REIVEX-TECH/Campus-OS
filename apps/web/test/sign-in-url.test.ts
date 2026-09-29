import { describe, expect, it } from 'vitest';
import { isSignInReason, safeReturnPath, signInPath } from '@/lib/sign-in-url';

describe('signInPath', () => {
  it('is the bare page with no options', () => {
    expect(signInPath('/u/lgu')).toBe('/u/lgu/signin');
    expect(signInPath('')).toBe('/signin');
  });

  it('encodes next and reason as query params', () => {
    expect(signInPath('', { next: '/timetable/t/fa/p/cs/s/a' })).toBe(
      '/signin?next=%2Ftimetable%2Ft%2Ffa%2Fp%2Fcs%2Fs%2Fa',
    );
    expect(signInPath('/u/lgu', { next: '/u/lgu/timetable', reason: 'reply' })).toBe(
      '/u/lgu/signin?next=%2Fu%2Flgu%2Ftimetable&reason=reply',
    );
  });

  it('omits a null next', () => {
    expect(signInPath('', { next: null, reason: 'comment' })).toBe('/signin?reason=comment');
  });
});

describe('safeReturnPath', () => {
  it('keeps a same-tenant root-relative path', () => {
    expect(safeReturnPath('/timetable', '')).toBe('/timetable');
    expect(safeReturnPath('/u/lgu/timetable/t/fa', '/u/lgu')).toBe('/u/lgu/timetable/t/fa');
    expect(safeReturnPath('/u/lgu', '/u/lgu')).toBe('/u/lgu');
  });

  it('rejects an empty or missing value', () => {
    expect(safeReturnPath(undefined, '')).toBeNull();
    expect(safeReturnPath(null, '')).toBeNull();
    expect(safeReturnPath('', '')).toBeNull();
  });

  it('rejects anything that could leave the origin', () => {
    expect(safeReturnPath('https://evil.test/x', '')).toBeNull();
    expect(safeReturnPath('//evil.test', '')).toBeNull();
    expect(safeReturnPath('/\\evil.test', '')).toBeNull();
    expect(safeReturnPath('javascript:alert(1)', '')).toBeNull();
    expect(safeReturnPath('timetable', '')).toBeNull(); // not root-relative
  });

  it('rejects another tenant on the path-based fallback', () => {
    expect(safeReturnPath('/u/other/timetable', '/u/lgu')).toBeNull();
    expect(safeReturnPath('/u/lgumore/timetable', '/u/lgu')).toBeNull();
  });

  it('refuses to loop back to the sign-in page', () => {
    expect(safeReturnPath('/signin', '')).toBeNull();
    expect(safeReturnPath('/u/lgu/signin?next=%2Fx', '/u/lgu')).toBeNull();
  });
});

describe('isSignInReason', () => {
  it('accepts known reasons and rejects the rest', () => {
    expect(isSignInReason('reply')).toBe(true);
    expect(isSignInReason('message')).toBe(true);
    expect(isSignInReason('continue')).toBe(false);
    expect(isSignInReason(undefined)).toBe(false);
  });
});
