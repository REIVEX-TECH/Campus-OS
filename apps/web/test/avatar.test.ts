import { describe, expect, it } from 'vitest';
import { AVATAR_KINDS, avatarBackground, avatarSrc, seedHash } from '@/lib/avatar';

describe('avatar seeding', () => {
  it('is deterministic: one entity always resolves to one picture', () => {
    expect(seedHash('teacher-1')).toBe(seedHash('teacher-1'));
    expect(avatarBackground('teacher-1')).toBe(avatarBackground('teacher-1'));
    expect(avatarSrc('person', 'teacher-1')).toBe(avatarSrc('person', 'teacher-1'));
  });

  it('separates different entities', () => {
    expect(seedHash('teacher-1')).not.toBe(seedHash('teacher-2'));
  });

  it('always lands on a real backdrop colour', () => {
    for (const seed of ['a', 'b', 'room-42', 'Nousheen Ilyas', '']) {
      expect(avatarBackground(seed)).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('routes people and places to different pictures for the same seed', () => {
    expect(avatarSrc('person', 'x')).not.toBe(avatarSrc('place', 'x'));
  });

  it('escapes the seed into the url', () => {
    expect(avatarSrc('person', 'a b')).toBe('/api/avatar/person/a%20b');
  });

  it('offers exactly the kinds the renderer knows', () => {
    expect([...AVATAR_KINDS]).toEqual(['person', 'place']);
  });
});
