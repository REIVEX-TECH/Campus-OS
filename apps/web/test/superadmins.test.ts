import { describe, expect, it } from 'vitest';
import { parseEmailList } from '@/lib/superadmins';

describe('parseEmailList', () => {
  it('splits on commas, semicolons and whitespace and lowercases', () => {
    expect(parseEmailList('A@x.io, b@y.io;c@z.io\n d@w.io')).toEqual([
      'a@x.io',
      'b@y.io',
      'c@z.io',
      'd@w.io',
    ]);
  });

  it('drops anything that is not an address', () => {
    expect(parseEmailList('nobody, , x')).toEqual([]);
  });

  it('rejects strings that merely contain an @, so no junk entry is matchable', () => {
    // The old filter was `.includes('@')`, which admitted all of these; a bare
    // '@' on the allowlist is a live entry the grant would compare against.
    expect(parseEmailList('@')).toEqual([]);
    expect(parseEmailList('foo@')).toEqual([]);
    expect(parseEmailList('@bar.com')).toEqual([]);
    expect(parseEmailList('foo@bar')).toEqual([]); // no dot in the domain
    expect(parseEmailList('foo@, @, bar@baz, real@example.com')).toEqual(['real@example.com']);
  });

  it('is empty when unset — fail closed, no first-user fallback', () => {
    // The whole platform-admin bootstrap keys on this: an empty or unset list
    // yields no addresses, so nobody is allowlisted, so nobody is promoted. The
    // database definer refuses an empty list too (0016), so the fail-closed
    // property holds at both layers.
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList('')).toEqual([]);
    expect(parseEmailList('   ')).toEqual([]);
  });
});
