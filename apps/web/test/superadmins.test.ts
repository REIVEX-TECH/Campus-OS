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

  it('is empty when unset', () => {
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList('')).toEqual([]);
  });
});
