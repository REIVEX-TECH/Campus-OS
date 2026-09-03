import { describe, expect, it } from 'vitest';
import {
  AVATAR_OPTIONS_PER_PAGE,
  AVATAR_OPTION_MAX,
  avatarOptionPage,
  avatarOptionSeed,
  isAvatarOption,
} from '../src/avatar-seed';

// The shape the avatar route accepts. The web app pins the real contract against
// its own pattern; this is the module's own statement of what it promises.
const DRAWABLE = /^[A-Za-z0-9_.-]+$/;

describe('avatarOptionSeed', () => {
  const userId = '5f7a3c2e-9b1d-4e8f-a6c0-1234567890ab';

  it('is something the avatar route will draw, at every option', () => {
    for (const option of [0, 1, 11, 12, AVATAR_OPTION_MAX]) {
      expect(avatarOptionSeed(userId, option)).toMatch(DRAWABLE);
    }
  });

  it('is one picture per option, and the same one every time', () => {
    expect(avatarOptionSeed(userId, 1)).not.toBe(avatarOptionSeed(userId, 2));
    expect(avatarOptionSeed(userId, 7)).toBe(avatarOptionSeed(userId, 7));
  });

  it('is scoped to the user, so two people never share a picture by accident', () => {
    expect(avatarOptionSeed(userId, 1)).not.toBe(avatarOptionSeed('another-user', 1));
  });
});

describe('the options a picker may offer', () => {
  it('accepts only whole numbers inside the range', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, AVATAR_OPTION_MAX + 1]) {
      expect(isAvatarOption(bad)).toBe(false);
    }
    for (const good of [0, 5, AVATAR_OPTION_MAX]) expect(isAvatarOption(good)).toBe(true);
  });

  it('pages a full grid of distinct options', () => {
    const first = avatarOptionPage(0);
    const second = avatarOptionPage(1);
    expect(first).toHaveLength(AVATAR_OPTIONS_PER_PAGE);
    expect(new Set([...first, ...second]).size).toBe(AVATAR_OPTIONS_PER_PAGE * 2);
    expect(first.every(isAvatarOption)).toBe(true);
  });

  it('wraps rather than running out, so shuffling never dead ends', () => {
    // Past the last page, and behind the first.
    expect(avatarOptionPage(10_000).every(isAvatarOption)).toBe(true);
    expect(avatarOptionPage(-1).every(isAvatarOption)).toBe(true);
    expect(avatarOptionPage(-1)).toEqual(avatarOptionPage(49));
  });
});
