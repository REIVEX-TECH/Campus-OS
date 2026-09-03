import { describe, expect, it } from 'vitest';
import { nextAvatarSeed } from '@campusos/module-identity/avatar-seed';
import {
  AVATAR_KINDS,
  AVATAR_SEED_PATTERN,
  avatarBackground,
  avatarSrc,
  seedHash,
} from '@/lib/avatar';

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

describe('avatar seeds from the identity module', () => {
  // The route refuses any seed outside its pattern, so a seed the identity
  // module writes but the route will not draw is an avatar that silently 404s
  // to a bare backdrop. A re rolled avatar used to be exactly that: the seed
  // carried a colon. This pins the contract between the two.
  const userId = '5f7a3c2e-9b1d-4e8f-a6c0-1234567890ab';

  it('produces a seed the avatar route will draw', () => {
    expect(nextAvatarSeed(userId, 1_756_800_000_000)).toMatch(AVATAR_SEED_PATTERN);
  });

  it('changes when re rolled at a different moment', () => {
    expect(nextAvatarSeed(userId, 1)).not.toBe(nextAvatarSeed(userId, 2));
  });

  it('documents why the old shape was wrong', () => {
    expect(`${userId}:1756800000000`).not.toMatch(AVATAR_SEED_PATTERN);
  });
});
